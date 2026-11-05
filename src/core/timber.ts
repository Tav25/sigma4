
export interface Vec3 {
  x: number
  y: number
  z: number
}

export type OrientationMode = 'x' | 'y' | 'z' | 'slope'

export interface Orientation {
  mode: OrientationMode
  angle: number
  roll: number
}

export interface TimberElement {
  id: string
  role: string
  length: number
  width: number
  height: number
  position: Vec3
  orientation: Orientation
  material: string
  /** Scene-only ownership from canonical assembly; never stored redundantly. */
  wallId?: string
  // Derived from a wall in the scene; the saved assembly keeps local positions.
  wallTransform?: { origin: Vec3; orientation: 'x' | 'z' | '-x' | '+z' }
}

export interface GeometrySpec {
  size: Vec3
  centerOffset: Vec3
  reference: Vec3
  quaternion: { x: number; y: number; z: number; w: number }
}

export function createTimberElement(params: {
  role?: string
  length: number
  width: number
  height: number
  position?: Vec3
  orientation?: Orientation
  material?: string
  id?: string
}): TimberElement {
  return {
    id: params.id ?? crypto.randomUUID(),
    role: params.role ?? 'element',
    length: params.length,
    width: params.width,
    height: params.height,
    position: params.position ?? { x: 0, y: 0, z: 0 },
    orientation: params.orientation ?? { mode: 'x', angle: 0, roll: 0 },
    material: params.material ?? 'wood',
  }
}

export function orientationQuaternion(o: Orientation): { x: number; y: number; z: number; w: number } {
  const halfDeg = (deg: number) => (deg * Math.PI) / 180 / 2
  // base mode quaternion (maps local U to world direction)
  let base: { x: number; y: number; z: number; w: number }
  switch (o.mode) {
    case 'x':
      base = { x: 0, y: 0, z: 0, w: 1 }
      break
    case 'y':
      // U->Y, V->Z, W->X  (cyclic)
      base = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }
      break
    case 'z':
      // U->Z, V->Y, W->-X
      base = { x: 0, y: -Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) }
      break
    case 'slope': {
      const h = halfDeg(o.angle)
      base = { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }
      break
    }
  }
  // roll around local X (longitudinal axis): q_roll = (sin(r/2),0,0,cos(r/2))
  const rollHalf = (o.roll * Math.PI) / 180 / 2
  const qRoll = { x: Math.sin(rollHalf), y: 0, z: 0, w: Math.cos(rollHalf) }
  // total = base * qRoll  (apply roll first in local, then base)
  return {
    x: base.w * qRoll.x + base.x * qRoll.w + base.y * qRoll.z - base.z * qRoll.y,
    y: base.w * qRoll.y - base.x * qRoll.z + base.y * qRoll.w + base.z * qRoll.x,
    z: base.w * qRoll.z + base.x * qRoll.y - base.y * qRoll.x + base.z * qRoll.w,
    w: base.w * qRoll.w - base.x * qRoll.x - base.y * qRoll.y - base.z * qRoll.z,
  }
}

export function rotateVectorByQuaternion(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = q
  const t = {
    x: 2 * (qy * v.z - qz * v.y),
    y: 2 * (qz * v.x - qx * v.z),
    z: 2 * (qx * v.y - qy * v.x),
  }
  return {
    x: v.x + qw * t.x + (qy * t.z - qz * t.y),
    y: v.y + qw * t.y + (qz * t.x - qx * t.z),
    z: v.z + qw * t.z + (qx * t.y - qy * t.x),
  }
}

export function generateTimberGeometry(element: TimberElement): GeometrySpec {
  const local = orientationQuaternion(element.orientation)
  // A right-hand wall goes into the room along -Z: local +X rotates +90° around Y.
  const direction = element.wallTransform?.orientation
  const yaw = direction === 'z' ? Math.PI / 2
    : direction === '-x' ? Math.PI
    : direction === '+z' ? -Math.PI / 2 : 0
  const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
  const q = {
    x: rotation.w * local.x + rotation.x * local.w + rotation.y * local.z - rotation.z * local.y,
    y: rotation.w * local.y - rotation.x * local.z + rotation.y * local.w + rotation.z * local.x,
    z: rotation.w * local.z + rotation.x * local.y - rotation.y * local.x + rotation.z * local.w,
    w: rotation.w * local.w - rotation.x * local.x - rotation.y * local.y - rotation.z * local.z,
  }
  const origin = element.wallTransform?.origin ?? { x: 0, y: 0, z: 0 }
  const relative = rotateVectorByQuaternion(element.position, rotation)
  return {
    size: { x: element.length, y: element.height, z: element.width },
    centerOffset: { x: element.length / 2, y: element.height / 2, z: 0 },
    reference: { x: origin.x + relative.x, y: origin.y + relative.y, z: origin.z + relative.z },
    quaternion: q,
  }
}

export function boxCenterWorld(element: TimberElement): Vec3 {
  const spec = generateTimberGeometry(element)
  const rotated = rotateVectorByQuaternion(spec.centerOffset, spec.quaternion)
  return {
    x: spec.reference.x + rotated.x,
    y: spec.reference.y + rotated.y,
    z: spec.reference.z + rotated.z,
  }
}

export function longitudinalEndPoint(element: TimberElement): Vec3 {
  const spec = generateTimberGeometry(element)
  const rotated = rotateVectorByQuaternion({ x: element.length, y: 0, z: 0 }, spec.quaternion)
  return {
    x: spec.reference.x + rotated.x,
    y: spec.reference.y + rotated.y,
    z: spec.reference.z + rotated.z,
  }
}

export function toWorldPoint(element: TimberElement, local: Vec3): Vec3 {
  const spec = generateTimberGeometry(element)
  const rotated = rotateVectorByQuaternion(local, spec.quaternion)
  return {
    x: spec.reference.x + rotated.x,
    y: spec.reference.y + rotated.y,
    z: spec.reference.z + rotated.z,
  }
}

export function timberVolumeM3(element: TimberElement): number {
  return (element.length * element.width * element.height) / 1e9
}

export const MM_PER_METER = 1000

export function mmToMeters(mm: number): number {
  return mm / MM_PER_METER
}
