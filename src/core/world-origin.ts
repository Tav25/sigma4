import type { Vector3, Wall } from './project'

/**
 * Wall origin is the center plane of the timber thickness. For the first
 * +X wall, the physical outside face is at origin.z + section.height/2.
 * The room lies toward -Z; the outside lower-left corner is this point.
 */
export function firstWallExteriorLowerLeft(wall: Wall): Vector3 {
  if (wall.orientation !== 'x') {
    throw new Error('Exterior zero requires the first wall along +X')
  }
  return {
    x: wall.origin.x,
    y: wall.origin.y,
    z: wall.origin.z + wall.sectionMm.height / 2,
  }
}

/**
 * Rebase ALL walls together as a rigid translation. Joined and independent
 * wall layouts retain their relative positions and opening coordinates.
 * Caller regenerates/validates the resulting canonical project.
 */
export function translateWallsToExteriorZero(walls: Wall[]): string[] {
  const first = walls[0]
  if (!first) throw new Error('No walls to align')
  const corner = firstWallExteriorLowerLeft(first)
  if (![corner.x, corner.y, corner.z].every(Number.isFinite)) {
    throw new Error('Invalid wall origin')
  }
  for (const wall of walls) {
    wall.origin = {
      x: wall.origin.x - corner.x,
      y: wall.origin.y - corner.y,
      z: wall.origin.z - corner.z,
    }
  }
  return walls.map(wall => wall.wallId)
}
