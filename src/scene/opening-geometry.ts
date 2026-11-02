import type { SceneOpening3D } from './project-to-scene'

/**
 * One mapping from wall-local U,V,normal coordinates (millimetres) to world.
 * +U goes toward +X on a facade, or -Z on a right-oriented wall.
 * +normal points toward the opening's outside face.
 */
export function openingLocalToWorld(
  opening: SceneOpening3D, uMm: number, vMm: number, normalMm = 0,
) {
  const { wallOrigin: o, wallOrientation } = opening
  return wallOrientation === 'z'
    ? { x: o.x + normalMm, y: o.y + vMm, z: o.z - uMm }
    : { x: o.x + uMm, y: o.y + vMm, z: o.z + normalMm }
}

export function openingWorldToLocalU(
  opening: SceneOpening3D, worldPointMeters: { x: number; z: number },
): number {
  return opening.wallOrientation === 'z'
    ? opening.wallOrigin.z / 1000 - worldPointMeters.z
    : worldPointMeters.x - opening.wallOrigin.x / 1000
}

export function openingYaw(opening: SceneOpening3D): number {
  return opening.wallOrientation === 'z' ? Math.PI / 2 : 0
}
