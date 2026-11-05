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
  const u = wallOrientation === '-x' ? {x:-1,z:0}
    : wallOrientation === '+z' ? {x:0,z:1}
      : wallOrientation === 'z' ? {x:0,z:-1} : {x:1,z:0}
  return {
    x: o.x + u.x * uMm - u.z * normalMm,
    y: o.y + vMm,
    z: o.z + u.z * uMm + u.x * normalMm,
  }
}

export function openingWorldToLocalU(
  opening: SceneOpening3D, worldPointMeters: { x: number; z: number },
): number {
  const u = opening.wallOrientation === '-x' ? {x:-1,z:0}
    : opening.wallOrientation === '+z' ? {x:0,z:1}
      : opening.wallOrientation === 'z' ? {x:0,z:-1} : {x:1,z:0}
  return ((worldPointMeters.x * 1000 - opening.wallOrigin.x) * u.x +
    (worldPointMeters.z * 1000 - opening.wallOrigin.z) * u.z) / 1000
}

export function openingYaw(opening: SceneOpening3D): number {
  return opening.wallOrientation === 'z' ? Math.PI / 2
    : opening.wallOrientation === '-x' ? Math.PI
      : opening.wallOrientation === '+z' ? -Math.PI / 2 : 0
}
