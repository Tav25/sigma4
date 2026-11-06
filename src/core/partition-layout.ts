import { planBounds, pointOnPlanSegment, samePlanPoint, type FloorPlan, type PlanPoint } from './floor-plan'
import { graphView } from './plan-graph'
import type { TimberElement, Wall } from './project'

export interface PartitionHost {
  wallId: string
  start: PlanPoint
  end: PlanPoint
  insetMm: number
}

export interface PartitionSide extends PartitionHost {
  label: string
  endInsetMm: number
  thicknessMm: number
  startHost?: PartitionHost
  endHost?: PartitionHost
}

export const PARTITION_MIN_DEPTH = 89
export const isPartitionWall = (wallId: string) => wallId.startsWith('partition-')
const alongX = (side: { start: PlanPoint; end: PlanPoint }) => side.start.zMm === side.end.zMm

export function partitionSides(plan: FloorPlan, exterior: PartitionHost[], depth: number): PartitionSide[] {
  const sides = graphView(plan).interiorWalls.map(wall => ({
    ...wall, wallId: 'partition-' + wall.id, label: 'Перегородка ' + wall.id, insetMm: 0, endInsetMm: 0,
  }))
  function joint(side: PartitionSide, point: PlanPoint) {
    const outside = exterior.find(host => pointOnPlanSegment(point, host.start, host.end))
    if (outside) return { trim: depth, host: outside }
    const neighbours = sides.filter(other => other !== side && pointOnPlanSegment(point, other.start, other.end))
    const perpendicular = neighbours.filter(other => alongX(other) !== alongX(side))
    if (!perpendicular.length) return { trim: 0 }

    // SIGMA4's canonical graph splits continuous walls at every intersection.
    // A former "through" wall is therefore TWO collinear edge modules, each
    // ending at this same node. Resolve the node topology, not just whether
    // another segment happens to contain the endpoint in its interior.
    const incident = [side, ...neighbours]
    const xArms = incident.filter(member => alongX(member))
    const zArms = incident.filter(member => !alongX(member))
    // With four arms, X is the deterministic through-axis and both Z arms
    // terminate at its outer faces. With three arms the two collinear arms
    // are the through-wall. This avoids perpendicular stud/plate collisions.
    const throughX = xArms.length >= 2
    const throughZ = zArms.length >= 2 && !throughX
    if (throughX || throughZ) {
      const sideThrough = throughX ? alongX(side) : !alongX(side)
      if (sideThrough) return { trim: 0 }
      const carriers = perpendicular.slice().sort((a, b) => a.wallId.localeCompare(b.wallId))
      return { trim: carriers[0].thicknessMm / 2, host: carriers[0] }
    }

    // A simple L corner keeps the existing, proven end-to-end joint layout.
    const through = perpendicular.find(other => !samePlanPoint(point, other.start) && !samePlanPoint(point, other.end))
    if (through) return { trim: through.thicknessMm / 2, host: through }
    const host = perpendicular[0]
    return { trim: !alongX(side) ? host.thicknessMm / 2 : -host.thicknessMm / 2 }
  }
  return sides.map(side => {
    const start = joint(side, side.start), end = joint(side, side.end)
    return { ...side, insetMm: start.trim, endInsetMm: end.trim, startHost: start.host, endHost: end.host }
  })
}

export function sideOffset(side: PartitionHost, point: PlanPoint): number {
  return alongX(side)
    ? (point.xMm - side.start.xMm) * Math.sign(side.end.xMm - side.start.xMm)
    : (point.zMm - side.start.zMm) * Math.sign(side.end.zMm - side.start.zMm)
}

export function partitionAttachments(side: PartitionSide) {
  const ends = [[side.start, side.startHost], [side.end, side.endHost]] as const
  return ends.flatMap(([point, host], index) => host
    ? [{ host, positionUmm: sideOffset(host, point), atStart: index === 0 }]
    : [])
}

export function partitionInside(plan: FloorPlan, side: PartitionSide, depth: number): boolean {
  const { minX, maxX, minZ, maxZ } = planBounds(plan.exterior)
  const horizontal = alongX(side)
  const normal = horizontal ? side.start.zMm : side.start.xMm
  const half = side.thicknessMm / 2
  return horizontal
    ? normal - half >= minZ + depth && normal + half <= maxZ - depth
    : normal - half >= minX + depth && normal + half <= maxX - depth
}

/**
 * Materialise the exterior T receiver in the host wall, not in the free
 * 2D graph. Looking from above, two cross-depth studs (the orange pieces)
 * sit behind the interior partition's end stud (green). Together they
 * provide two distinct fastening surfaces inside the partition footprint.
 *
 * Existing regular studs in the same footprint are REPLACED, not overlapped;
 * this is essential when the junction falls on a standard 600 mm spacing.
 * Source walls and JSON graph nodes are never mutated.
 */
export function addPartitionBacking(elements: TimberElement[], walls: readonly Wall[], side: PartitionSide): void {
  for (const { host, positionUmm, atStart } of partitionAttachments(side)) {
    const wall = walls.find(item => item.wallId === host.wallId)
    const branch = walls.find(item => item.wallId === side.wallId)
    if (!wall || !branch) continue

    const { width, height } = wall.sectionMm
    const u = positionUmm - sideOffset(host, { xMm: wall.origin.x, zMm: wall.origin.z })
    const studLength = wall.heightMm - width * (isPartitionWall(wall.wallId) ? 2 : 3)
    const branchEndU = atStart ? branch.sectionMm.width / 2 : branch.lengthMm - branch.sectionMm.width / 2
    const branchStud = elements.find(element =>
      element.wallId === side.wallId && element.role === 'stud' &&
      Math.abs(element.position.x - branchEndU) < 0.001)

    const connect = (support: TimberElement): void => {
      if (!branchStud) return
      if (!support.connectionIds.includes(branchStud.elementId)) support.connectionIds.push(branchStud.elementId)
      if (!branchStud.connectionIds.includes(support.elementId)) branchStud.connectionIds.push(support.elementId)
    }

    if (!isPartitionWall(wall.wallId)) {
      // Two 45-mm studs, in plan, run across the exterior wall's 145-mm
      // cavity. They sit under opposite halves of the partition end face.
      // Maintain non-overlapping full-depth studs; for wider partitions
      // the centre of the end member may remain unsupported (engineering
      // verification remains explicitly NOT EVALUATED).
      const offset = Math.max(width / 2, (side.thicknessMm - width) / 2)
      const receivers = [u - offset, u + offset]
      const supports: TimberElement[] = []
      for (const [index, target] of receivers.entries()) {
        if (target - width / 2 < 0 || target + width / 2 > wall.lengthMm)
          throw new Error('Закладная примыкания выходит за длину наружной стены')
        const ordinary = elements.filter(element =>
          element.wallId === wall.wallId && element.role === 'stud' &&
          Math.abs(element.position.x - target) < width - 0.001)
        // The generated normal-spacing studs may be replaced only within
        // their own host wall. Never cut a door's king/jack stud or another
        // junction's backing.
        let reused = ordinary.find(element => Math.abs(element.position.x - target) < 0.001)
        if (!reused) {
          for (const member of ordinary) {
            if (member.elementId.includes(':partition-backing-'))
              throw new Error('Пересекаются закладные соседних перегородок')
            const at = elements.indexOf(member)
            if (at >= 0) elements.splice(at, 1)
          }
          if (elements.some(element => element.wallId === wall.wallId &&
            (element.role === 'king-stud' || element.role === 'jack-stud' ||
              element.role === 'corner-backing' ||
              element.elementId.includes(':partition-backing-')) &&
            Math.abs(element.position.x - target) < width - 0.001))
            throw new Error('Закладная примыкания пересекает другую конструктивную деталь')
          reused = {
            elementId: wall.wallId + ':partition-backing-' + side.wallId +
              (atStart ? '-start' : '-end') + '-' + (index + 1),
            wallId: wall.wallId,
            role: 'stud',
            lengthMm: studLength,
            sectionMm: { ...wall.sectionMm },
            position: { x: target, y: width, z: -height / 2 },
            orientation: { mode: 'y', angle: 0, roll: 0 },
            connectionIds: [],
            generated: true,
          }
          elements.push(reused)
        }
        supports.push(reused)
      }
      supports.forEach(connect)
      continue
    }

    // Internal T/X node: the through-axis already has end studs on BOTH
    // collinear pieces. Use the existing stud as the receiving/blocking
    // member; another one in the same place would penetrate timber.
    const support = elements
      .filter(element => element.wallId === wall.wallId &&
        (element.role === 'stud' || element.role === 'king-stud'))
      .sort((a, b) => Math.abs(a.position.x - u) - Math.abs(b.position.x - u))[0]
    if (!support || Math.abs(support.position.x - u) > width + 0.001)
      throw new Error('У внутреннего Т-узла отсутствует опорная стойка')
    connect(support)
  }
}
