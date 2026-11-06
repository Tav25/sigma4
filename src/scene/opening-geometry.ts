import type { SceneOpening3D } from './project-to-scene'
import { wallLocalToWorld, wallYaw } from '../core/world-origin'

/**
 * One mapping from wall-local U,V,normal coordinates (millimetres) to world.
 * +U goes toward +X on a facade, or -Z on a right-oriented wall.
 * +normal points toward the opening's outside face.
 */
export function openingLocalToWorld(
  opening: SceneOpening3D, uMm: number, vMm: number, normalMm = 0,
) {
  return wallLocalToWorld(opening.wallOrigin, opening.wallOrientation, opening.reversed, uMm, vMm, normalMm)
}

export function openingWorldToLocalU(
  opening: SceneOpening3D, worldPointMeters: { x: number; z: number },
): number {
  const distance = opening.wallOrientation === 'z'
    ? opening.wallOrigin.z / 1000 - worldPointMeters.z
    : worldPointMeters.x - opening.wallOrigin.x / 1000
  return opening.reversed ? -distance : distance
}

export function openingYaw(opening: SceneOpening3D): number {
  return wallYaw(opening.wallOrientation, opening.reversed)
}
