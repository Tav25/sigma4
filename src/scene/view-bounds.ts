import * as THREE from 'three'
import { boxCenterWorld, generateTimberGeometry, mmToMeters, type TimberElement } from '../core/timber'

/** World AABB in metres, incorporating the orientation of every timber mesh. */
export function calculateWorldBounds(elements: TimberElement[]): THREE.Box3 {
  const bounds = new THREE.Box3()
  for (const el of elements) {
    const spec = generateTimberGeometry(el)
    const center = boxCenterWorld(el)
    const half = new THREE.Vector3(
      mmToMeters(spec.size.x) / 2, mmToMeters(spec.size.y) / 2, mmToMeters(spec.size.z) / 2,
    )
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z)),
      new THREE.Quaternion(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w),
      new THREE.Vector3(1, 1, 1),
    )
    bounds.union(new THREE.Box3(half.clone().negate(), half).applyMatrix4(matrix))
  }
  return bounds
}

