import type { Wall } from '../core/project'
import type { TimberElement } from '../core/timber'
import { wallEnd } from '../core/wall-topology'
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
  /** Extension starts just outside this specific wall's timber footprint. */
  extensionFrom: DimensionPoint
  extensionTo: DimensionPoint
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
  const radians = Math.atan2(-dz, dx)
  return radians === 0 ? 0 : radians // normalize negative zero for stable output
}

/**
 * Extension lines start just outside their OWN wall's actual frame.
 * Geometry is a derived annotation only; original measured endpoints and
 * canonical source coordinates are never altered.
 */
export function exteriorExtensionFoot(
  line: DimensionLine, _bounds: DimensionLayout['bounds'], end: 'from' | 'to',
): DimensionPoint {
  return end === 'from' ? line.extensionFrom : line.extensionTo
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
  // A wall dimension stays CLOSE to that wall, independent from the extent
  // of adjacent/remote walls. For SIGMA4 orientations the outside is +Z
  // for X facades and +X for -Z side walls (the open sides of the L).
  const WALL_OFFSET_MM = 220
  const OVERALL_OFFSET_MM = 460
  const EXTENSION_START_MM = 45
  const lines: DimensionLine[] = walls.map((wall) => {
    const alongX = wall.orientation === 'x'
    const from = asPoint(wall.origin.x, wall.origin.z)
    const to = wallEnd(wall)
    const ownElements = elements.filter(element => element.wallId === wall.wallId)
    const ownAabb = calculateWorldBounds(ownElements)
    const outside = wall.reversed ? -1 : 1
    const face = ownAabb[outside < 0 ? 'min' : 'max']
    const coordinate = ownAabb.isEmpty()
      ? (alongX ? wall.origin.z : wall.origin.x) + outside * wall.sectionMm.height / 2
      : (alongX ? face.z : face.x) * 1000
    const dimCoordinate = coordinate + outside * WALL_OFFSET_MM
    const footCoordinate = coordinate + outside * EXTENSION_START_MM
    return {
      id: 'wall-dim-' + wall.wallId,
      kind: 'wall' as const,
      valueMm: wall.lengthMm,
      from, to,
      dimensionFrom: alongX ? asPoint(from.x, dimCoordinate) : asPoint(dimCoordinate, from.z),
      dimensionTo: alongX ? asPoint(to.x, dimCoordinate) : asPoint(dimCoordinate, to.z),
      extensionFrom: alongX ? asPoint(from.x, footCoordinate) : asPoint(footCoordinate, from.z),
      extensionTo: alongX ? asPoint(to.x, footCoordinate) : asPoint(footCoordinate, to.z),
    }
  })
  // The overall dimension is still measured against the actual exterior
  // timber bounds, but it also stays near the facade instead of spanning the
  // entire inside of an L-shaped construction.
  lines.push({
    id: 'overall-dimension-x', kind: 'overall',
    valueMm: overallXmm,
    from: asPoint(bounds.minX, bounds.maxZ),
    to: asPoint(bounds.maxX, bounds.maxZ),
    dimensionFrom: asPoint(bounds.minX, bounds.maxZ + OVERALL_OFFSET_MM),
    dimensionTo: asPoint(bounds.maxX, bounds.maxZ + OVERALL_OFFSET_MM),
    extensionFrom: asPoint(bounds.minX, bounds.maxZ + EXTENSION_START_MM),
    extensionTo: asPoint(bounds.maxX, bounds.maxZ + EXTENSION_START_MM),
  })
  lines.push({
    id: 'overall-dimension-z', kind: 'overall',
    valueMm: overallZmm,
    from: asPoint(bounds.maxX, bounds.maxZ),
    to: asPoint(bounds.maxX, bounds.minZ),
    dimensionFrom: asPoint(bounds.maxX + OVERALL_OFFSET_MM, bounds.maxZ),
    dimensionTo: asPoint(bounds.maxX + OVERALL_OFFSET_MM, bounds.minZ),
    extensionFrom: asPoint(bounds.maxX + EXTENSION_START_MM, bounds.maxZ),
    extensionTo: asPoint(bounds.maxX + EXTENSION_START_MM, bounds.minZ),
  })
  return { lines, bounds, overallXmm, overallZmm }
}
