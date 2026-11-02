import * as THREE from 'three'
import { formatDimensionNumber, type DimensionLayout, type DimensionLine, type DimensionPoint } from './dimension-model'

/** Everything dimension-related lies on the horizontal XZ drawing plane. */
const GROUND_Y = 0.025
const mm = (value: number) => value / 1000
const planar = (p: DimensionPoint) => new THREE.Vector3(mm(p.x), GROUND_Y, mm(p.z))

/** Actual typography on a flat plane, not a billboard or a floating label. */
function numericLabel(valueMm: number, color: string): THREE.Mesh {
  const digits = formatDimensionNumber(valueMm)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable for dimension numbers')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = 'bold 85px Arial, sans-serif'
  context.fillStyle = color
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(digits, 256, 64, 495)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({
    map: texture, side: THREE.DoubleSide, transparent: true,
    depthWrite: false, depthTest: false,
  })
  const length = Math.max(0.58, digits.length * 0.16)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.28), material)
  // Local XY -> world XZ, facing the top (+Y) view. No camera billboarding.
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 111
  return mesh
}

function segments(points: THREE.Vector3[], color: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({
    color, depthTest: false, depthWrite: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.renderOrder = 107
  return lines
}

function appendDimension(group: THREE.Group, dim: DimensionLine) {
  const start = planar(dim.from)
  const end = planar(dim.to)
  const a = planar(dim.dimensionFrom)
  const b = planar(dim.dimensionTo)
  const axis = b.clone().sub(a).normalize()
  const normal = new THREE.Vector3(-axis.z, 0, axis.x)
  // Short dimensions (e.g. 145-mm stud depth) must not have opposing
  // arrowheads longer than the dimension itself.
  const arrowLength = Math.min(0.13, Math.max(0.02, mm(dim.valueMm) * 0.22))
  const arrowHalf = Math.min(0.055, arrowLength * 0.46)
  const arrow = (tip: THREE.Vector3, toward: THREE.Vector3) => {
    const base = tip.clone().addScaledVector(toward, arrowLength)
    return [
      tip.clone(), base.clone().addScaledVector(normal, arrowHalf),
      tip.clone(), base.clone().addScaledVector(normal, -arrowHalf),
    ]
  }
  const points = [
    start, a.clone().addScaledVector(a.clone().sub(start).normalize(), 0.09),
    end, b.clone().addScaledVector(b.clone().sub(end).normalize(), 0.09),
    a, b,
    ...arrow(a, axis), ...arrow(b, axis.clone().negate()),
  ]
  group.add(segments(points, dim.kind === 'overall' ? 0x1562a8 : 0x274559))
  const number = numericLabel(dim.valueMm, dim.kind === 'overall' ? '#1562a8' : '#274559')
  number.name = 'dimension-number-' + dim.id
  number.position.copy(a.clone().add(b).multiplyScalar(0.5))
  // Put digits next to, not across, the dimension stroke on the same plane.
  number.position.addScaledVector(normal, 0.38)
  number.position.y = GROUND_Y + 0.004
  group.add(number)
}

/** Derived visualization only: no canonical JSON mutation. */
export function makeDimensionGroup(layout: DimensionLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-planar-dimensions'
  for (const dim of layout.lines) appendDimension(group, dim)
  return group
}

/** World-origin geometry is separate from engineering dimensions. */
export function makeOriginGroup(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-world-origin'
  const axes = [
    { end: new THREE.Vector3(0.7, 0, 0), color: 0xdf3030 },
    { end: new THREE.Vector3(0, 0.7, 0), color: 0x279453 },
    { end: new THREE.Vector3(0, 0, 0.7), color: 0x365cc4 },
  ]
  for (const axis of axes) {
    group.add(new THREE.ArrowHelper(
      axis.end.clone().normalize(), new THREE.Vector3(0, 0.025, 0),
      axis.end.length(), axis.color, 0.11, 0.05,
    ))
  }
  const origin = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }),
  )
  origin.position.set(0, 0.025, 0)
  group.add(origin)
  return group
}

export function disposeDimensionGroup(group: THREE.Group): void {
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line ||
      object instanceof THREE.LineSegments) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose()
        material.dispose()
      }
    }
  })
}
