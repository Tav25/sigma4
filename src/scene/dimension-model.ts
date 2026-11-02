import type { Wall } from '../core/project'
import type { TimberElement } from '../core/timber'
import { calculateWorldBounds } from './view-bounds'

/** Coordinates remain world millimetres, not view-relative pixel positions. */
export interface DimensionPoint { x: number; y: number; z: number }
export interface DimensionLine {
  id: string
  label: string
  kind: 'wall' | 'overall'
  valueMm: number
  /** True measured endpoints on a nominal wall or exterior bounding edge. */
  from: DimensionPoint
  to: DimensionPoint
  /** Where the arrow and extension line should be drawn. */
  dimensionFrom: DimensionPoint
  dimensionTo: DimensionPoint
}
export interface DimensionLayout {
  lines: DimensionLine[]
  /** Real AABB of *rotated*, *placed* timber geometry in world millimetres. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  overallXmm: number
  overallZmm: number
}
const asPoint = (x: number, y: number, z: number): DimensionPoint => ({ x, y, z })

/**
 * Dimension source: wall model for authored lengths, actual assembly mesh AABB
 * for exterior sizes. Never infer outer dimensions by summing wall lengths:
 * California corners and overlapping top plates require actual geometry.
 */
export function buildDimensionLayout(walls: readonly Wall[], elements: TimberElement[]): DimensionLayout {
  const aabb = calculateWorldBounds(elements)
  if (!walls.length || aabb.isEmpty()) {
    return { lines: [], bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      overallXmm: 0, overallZmm: 0 }
  }
  const bounds = {
    minX: aabb.min.x * 1000, maxX: aabb.max.x * 1000,
    minZ: aabb.min.z * 1000, maxZ: aabb.max.z * 1000,
  }
  const overallXmm = bounds.maxX - bounds.minX
  const overallZmm = bounds.maxZ - bounds.minZ
  const offset = 450
  const step = 250
  const lines: DimensionLine[] = walls.map((wall, index) => {
    const alongX = wall.orientation === 'x'
    const from = asPoint(wall.origin.x, wall.origin.y, wall.origin.z)
    const to = asPoint(alongX ? wall.origin.x + wall.lengthMm : wall.origin.x,
      wall.origin.y, alongX ? wall.origin.z : wall.origin.z - wall.lengthMm)
    const level = offset + index * step
    const dimensionFrom = alongX
      ? asPoint(from.x, from.y + 28, bounds.maxZ + level)
      : asPoint(bounds.maxX + level, from.y + 28, from.z)
    const dimensionTo = alongX
      ? asPoint(to.x, to.y + 28, bounds.maxZ + level)
      : asPoint(bounds.maxX + level, to.y + 28, to.z)
    return {
      id: 'wall-dim-' + wall.wallId,
      label: 'Стена ' + (index + 1),
      kind: 'wall' as const,
      valueMm: wall.lengthMm,
      from, to, dimensionFrom, dimensionTo,
    }
  })
  // Keep total dimension lines outside every per-wall annotation.
  const totalOffset = offset + walls.length * step + 320
  lines.push({
    id: 'overall-dimension-x', label: 'Габарит X', kind: 'overall',
    valueMm: overallXmm,
    from: asPoint(bounds.minX, 0, bounds.maxZ),
    to: asPoint(bounds.maxX, 0, bounds.maxZ),
    dimensionFrom: asPoint(bounds.minX, 30, bounds.maxZ + totalOffset),
    dimensionTo: asPoint(bounds.maxX, 30, bounds.maxZ + totalOffset),
  })
  lines.push({
    id: 'overall-dimension-z', label: 'Габарит Z', kind: 'overall',
    valueMm: overallZmm,
    from: asPoint(bounds.maxX, 0, bounds.maxZ),
    to: asPoint(bounds.maxX, 0, bounds.minZ),
    dimensionFrom: asPoint(bounds.maxX + totalOffset, 30, bounds.maxZ),
    dimensionTo: asPoint(bounds.maxX + totalOffset, 30, bounds.minZ),
  })
  return { lines, bounds, overallXmm, overallZmm }
}
