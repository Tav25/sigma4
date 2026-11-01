// Независимое геометрическое ядро. Единицы измерения — миллиметры.
// Three.js не используется.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface TimberElement {
  id: string
  length: number // мм, вдоль локальной оси X
  width: number // мм, толщина (по Z)
  height: number // мм, высота сечения (по Y)
  position: Vec3 // мм, центр элемента
  rotation: Vec3 // радианы
  material: string
}

export interface GeometrySpec {
  size: Vec3 // мм
  center: Vec3 // мм
  rotation: Vec3 // радианы
}

export function createTimberElement(params: {
  length: number
  width: number
  height: number
  position?: Vec3
  rotation?: Vec3
  material?: string
  id?: string
}): TimberElement {
  return {
    id: params.id ?? crypto.randomUUID(),
    length: params.length,
    width: params.width,
    height: params.height,
    position: params.position ?? { x: 0, y: 0, z: 0 },
    rotation: params.rotation ?? { x: 0, y: 0, z: 0 },
    material: params.material ?? 'wood',
  }
}

export function generateTimberGeometry(element: TimberElement): GeometrySpec {
  return {
    size: { x: element.length, y: element.height, z: element.width },
    center: { ...element.position },
    rotation: { ...element.rotation },
  }
}

export function timberVolumeM3(element: TimberElement): number {
  return (element.length * element.width * element.height) / 1e9
}

export const MM_PER_METER = 1000

export function mmToMeters(mm: number): number {
  return mm / MM_PER_METER
}