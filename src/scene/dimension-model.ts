import type { Wall } from '../core/project'
import type { TimberElement } from '../core/timber'
import { calculateWorldBounds } from './view-bounds'

/** Coordinates remain world millimetres, not view-relative pixel positions. */
export interface DimensionPoint { x: number; y: number; z: number }
export interface DimensionLine {
  id: string
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
const asPoint = (x: number, z: number): DimensionPoint => ({ x, y: 0, z })

/** Millimetres by project convention; visibly render only digits. */
export function formatDimensionNumber(valueMm: number): string {
  if (!Number.isFinite(valueMm) || valueMm < 0) throw new Error('Invalid dimension value')
  return String(Math.round(valueMm))
}

/** Angle about global Y: local text baseline tracks a wall's length axis. */
export function dimensionLabelYaw(line: DimensionLine): number {
  const dx = line.dimensionTo.x - line.dimensionFrom.x
  const dz = line.dimensionTo.z - line.dimensionFrom.z
  if (Math.hypot(dx, dz) < 1e-6) return 0
  return Math.atan2(-dz, dx)
}

/**
 * Extension lines begin just OUTSIDE the entire assembly, never in front of
 * the studs or through an opening. Authoritative from/to endpoints are kept
 * for measurements and are not modified by this visual-only clipping.
 */
export function exteriorExtensionFoot(
  line: DimensionLine, bounds: DimensionLayout['bounds'], end: 'from' | 'to',
): DimensionPoint {
  const source = end === 'from' ? line.from : line.to
  const isAlongX = Math.abs(line.dimensionTo.x - line.dimensionFrom.x) >
    Math.abs(line.dimensionTo.z - line.dimensionFrom.z)
  const exteriorOffsetMm = 100
  if (isAlongX) {
    const outsideZ = line.dimensionFrom.z >= bounds.maxZ
      ? bounds.maxZ + exteriorOffsetMm : bounds.minZ - exteriorOffsetMm
    return asPoint(source.x, outsideZ)
  }
  const outsideX = line.dimensionFrom.x >= bounds.maxX
    ? bounds.maxX + exteriorOffsetMm : bounds.minX - exteriorOffsetMm
  return asPoint(outsideX, source.z)
}

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
  const offset = 650
  const step = 250
  const lines: DimensionLine[] = walls.map((wall, index) => {
    const alongX = wall.orientation === 'x'
    const from = asPoint(wall.origin.x, wall.origin.z)
    const to = asPoint(alongX ? wall.origin.x + wall.lengthMm : wall.origin.x,
      alongX ? wall.origin.z : wall.origin.z - wall.lengthMm)
    const level = offset + index * step
    const dimensionFrom = alongX
      ? asPoint(from.x, bounds.maxZ + level)
      : asPoint(bounds.maxX + level, from.z)
    const dimensionTo = alongX
      ? asPoint(to.x, bounds.maxZ + level)
      : asPoint(bounds.maxX + level, to.z)
    return {
      id: 'wall-dim-' + wall.wallId,
      kind: 'wall' as const,
      valueMm: wall.lengthMm,
      from, to, dimensionFrom, dimensionTo,
    }
  })
  // Keep total dimension lines outside every per-wall annotation.
  const totalOffset = offset + walls.length * step + 320
  lines.push({
    id: 'overall-dimension-x', kind: 'overall',
    valueMm: overallXmm,
    from: asPoint(bounds.minX, bounds.maxZ),
    to: asPoint(bounds.maxX, bounds.maxZ),
    dimensionFrom: asPoint(bounds.minX, bounds.maxZ + totalOffset),
    dimensionTo: asPoint(bounds.maxX, bounds.maxZ + totalOffset),
  })
  lines.push({
    id: 'overall-dimension-z', kind: 'overall',
    valueMm: overallZmm,
    from: asPoint(bounds.maxX, bounds.maxZ),
    to: asPoint(bounds.maxX, bounds.minZ),
    dimensionFrom: asPoint(bounds.maxX + totalOffset, bounds.maxZ),
    dimensionTo: asPoint(bounds.maxX + totalOffset, bounds.minZ),
  })
  return { lines, bounds, overallXmm, overallZmm }
}
