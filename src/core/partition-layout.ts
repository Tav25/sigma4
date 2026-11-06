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
 * Larry Haun's three-stud channel, viewed in a horizontal stud-level cut.
 *
 * Two full-depth upright studs frame the incoming partition. Between their
 * inner edges a third *flatwise* upright stud provides a continuous nailing
 * surface flush with the INSIDE face of the exterior wall.
 *
 * A vertical stud's TimberElement position.x is the centre of its 45-mm
 * footprint; a flatwise stud uses roll=90, so sectionMm.height is its span
 * ALONG the host wall and sectionMm.width is its in-wall depth. Its x anchor
 * is therefore the left edge, not the centre. This geometry is rebuilt from
 * canonical wall / plan sources and must not be stored as authoring data.
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
    if (!branchStud) {
      throw new Error('У перегородки отсутствует торцевая стойка в узле примыкания')
    }

    const connect = (a: TimberElement, b: TimberElement): void => {
      if (!a.connectionIds.includes(b.elementId)) a.connectionIds.push(b.elementId)
      if (!b.connectionIds.includes(a.elementId)) b.connectionIds.push(a.elementId)
    }

    if (!isPartitionWall(wall.wallId)) {
      // The partition depth is the clear opening between the two 45-mm
      // exterior studs. E.g. partition 100 mm: stud centres u ±72.5 mm.
      // The flat nailer spans exactly this opening and is 45 mm deep;
      // it faces the partition at the inner face of the exterior wall.
      const clearWidth = branch.sectionMm.height
      const halfGap = clearWidth / 2
      const halfStud = width / 2
      const leftU = u - halfGap - halfStud
      const rightU = u + halfGap + halfStud
      const windowStart = leftU - halfStud
      const windowEnd = rightU + halfStud
      if (windowStart < 0 || windowEnd > wall.lengthMm) {
        throw new Error('Трёхстоечный узел выходит за край наружной стены')
      }
      // Only remove standard layout studs, whose bodies would otherwise
      // pierce the two new uprights or the flat nailer. Preserve all special
      // studs (door framing, corners, prior receivers) and reject collisions.
      const intersects = (a0: number, a1: number, b0: number, b1: number) =>
        Math.min(a1, b1) - Math.max(a0, b0) > 0.0001
      const isOrdinaryStud = (element: TimberElement) =>
        element.wallId === wall.wallId &&
        element.role === 'stud' &&
        element.elementId.startsWith(wall.wallId + ':stud-')
      const occupied = elements.filter(element =>
        element.wallId === wall.wallId &&
        (element.role === 'stud' || element.role === 'king-stud' ||
          element.role === 'jack-stud' || element.role === 'corner-backing'))
      for (const member of occupied) {
        const rolled = member.orientation.mode === 'y' && Math.abs(member.orientation.roll) === 90
        const begin = rolled
          ? member.position.x + (member.orientation.roll > 0 ? 0 : -member.sectionMm.height)
          : member.position.x - member.sectionMm.width / 2
        const end = rolled
          ? member.position.x + (member.orientation.roll > 0 ? member.sectionMm.height : 0)
          : member.position.x + member.sectionMm.width / 2
        if (!intersects(begin, end, windowStart, windowEnd)) continue
        if (!isOrdinaryStud(member)) {
          throw new Error('Трёхстоечный узел пересекает существующие элементы каркаса')
        }
        const index = elements.indexOf(member)
        if (index >= 0) elements.splice(index, 1)
      }

      const baseId = wall.wallId + ':partition-backing-' + side.wallId +
        (atStart ? '-start' : '-end')
      const upright = (suffix: string, positionU: number): TimberElement => ({
        elementId: baseId + '-' + suffix,
        wallId: wall.wallId,
        role: 'stud',
        lengthMm: studLength,
        sectionMm: { ...wall.sectionMm },
        position: { x: positionU, y: width, z: -height / 2 },
        orientation: { mode: 'y', angle: 0, roll: 0 },
        connectionIds: [],
        generated: true,
      })
      const left = upright('left', leftU)
      const right = upright('right', rightU)
      const flat: TimberElement = {
        elementId: baseId + '-flat',
        wallId: wall.wallId,
        role: 'stud',
        lengthMm: studLength,
        sectionMm: { width, height: clearWidth },
        // For mode=y, roll=90 maps local section HEIGHT to host +X and
        // local section WIDTH to -Z. The resulting cross-section fills
        // u±halfGap and sits in the innermost 45 mm of the host.
        position: { x: u - halfGap, y: width, z: -height / 2 + width / 2 },
        orientation: { mode: 'y', angle: 0, roll: 90 },
        connectionIds: [],
        generated: true,
      }
      elements.push(left, right, flat)
      connect(left, flat)
      connect(right, flat)
      connect(flat, branchStud)
      continue
    }

    // For interior T/X nodes, the canonical graph already splits the through
    // wall. Reuse its end stud rather than inserting duplicate solids.
    const support = elements
      .filter(element => element.wallId === wall.wallId &&
        (element.role === 'stud' || element.role === 'king-stud'))
      .sort((a, b) => Math.abs(a.position.x - u) - Math.abs(b.position.x - u))[0]
    if (!support || Math.abs(support.position.x - u) > width + 0.001) {
      throw new Error('У внутреннего Т-узла отсутствует опорная стойка')
    }
    connect(support, branchStud)
  }
}
