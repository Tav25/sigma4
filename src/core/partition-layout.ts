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
    if (!perpendicular.length || neighbours.some(other => alongX(other) === alongX(side))) return { trim: 0 }
    const through = perpendicular.find(other => !samePlanPoint(point, other.start) && !samePlanPoint(point, other.end))
    if (through) return { trim: through.thicknessMm / 2, host: through }
    const host = perpendicular[0]
    return { trim: perpendicular.length > 1 || !alongX(side) ? host.thicknessMm / 2 : -host.thicknessMm / 2 }
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

export function addPartitionBacking(elements: TimberElement[], walls: readonly Wall[], side: PartitionSide): void {
  for (const { host, positionUmm, atStart } of partitionAttachments(side)) {
    const wall = walls.find(item => item.wallId === host.wallId)
    if (!wall) continue
    const u = positionUmm - sideOffset(host, { xMm: wall.origin.x, zMm: wall.origin.z })
    const { width, height } = wall.sectionMm
    const studLength = wall.heightMm - width * (isPartitionWall(wall.wallId) ? 2 : 3)
    const existing = elements.find(element =>
      element.wallId === wall.wallId && (element.role === 'stud' || element.role === 'king-stud') &&
      Math.abs(element.position.x - u) < (side.thicknessMm + width) / 2)
    const backing = existing ?? {
      elementId: wall.wallId + ':partition-backing-' + side.wallId + (atStart ? '-start' : '-end'),
      wallId: wall.wallId, role: 'stud' as const, lengthMm: studLength,
      sectionMm: { ...wall.sectionMm }, position: { x: u, y: width, z: -height / 2 },
      orientation: { mode: 'y' as const, angle: 0, roll: 0 }, connectionIds: [], generated: true,
    }
    if (!existing) elements.push(backing)
    const branch = walls.find(item => item.wallId === side.wallId)
    const branchStud = elements.find(element => element.wallId === side.wallId && element.role === 'stud' &&
      element.position.x === (atStart ? width / 2 : (branch?.lengthMm ?? 0) - width / 2))
    if (branchStud) {
      backing.connectionIds.push(branchStud.elementId)
      branchStud.connectionIds.push(backing.elementId)
    }
  }
}
