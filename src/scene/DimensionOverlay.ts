import * as THREE from 'three'
import type { DimensionLayout, DimensionLine, DimensionPoint } from './dimension-model'

const mm = (number: number) => number / 1000
const point = (p: DimensionPoint) => new THREE.Vector3(mm(p.x), mm(p.y), mm(p.z))

function labelSprite(value: string, color = '#182d43'): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 144
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable for dimension labels')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.roundRect(3, 4, 762, 134, 20)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.font = 'bold 47px Arial, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(value, 384, 74, 716)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.1, 0.40, 1)
  sprite.renderOrder = 110
  return sprite
}

function lineSegments(points: THREE.Vector3[], color: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false })
  const line = new THREE.LineSegments(geometry, material)
  line.renderOrder = 105
  return line
}

function appendLine(group: THREE.Group, dim: DimensionLine) {
  const a = point(dim.from), b = point(dim.to)
  const da = point(dim.dimensionFrom), db = point(dim.dimensionTo)
  const direction = db.clone().sub(da).normalize()
  const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
  const ext = 0.14
  const arrowLength = 0.17
  const arrowHalf = 0.085
  const arrow = (at: THREE.Vector3, forward: THREE.Vector3) => {
    const tipBack = at.clone().addScaledVector(forward, arrowLength)
    return [
      at.clone(), tipBack.clone().addScaledVector(perpendicular, arrowHalf),
      at.clone(), tipBack.addScaledVector(perpendicular, -arrowHalf),
    ]
  }
  // Always use world-space endpoints derived from the model. No viewport
  // offsets or camera-centering corrections are applied to the coordinates.
  const points = [
    a, da.clone().addScaledVector(da.clone().sub(a).normalize(), ext),
    b, db.clone().addScaledVector(db.clone().sub(b).normalize(), ext),
    da, db,
    ...arrow(da, direction), ...arrow(db, direction.clone().negate()),
  ]
  group.add(lineSegments(points, dim.kind === 'overall' ? 0x1562a8 : 0x274559))
  const title = dim.label + ': ' + Math.round(dim.valueMm) + ' мм'
  const sprite = labelSprite(title, dim.kind === 'overall' ? '#1562a8' : '#274559')
  sprite.name = 'dimension-label-' + dim.id
  sprite.position.copy(da.clone().add(db).multiplyScalar(0.5))
  sprite.position.y += 0.32
  group.add(sprite)
}

/** This is a render-only object; JSON never includes dimension geometry. */
export function makeDimensionGroup(layout: DimensionLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-dimensions'
  for (const line of layout.lines) appendLine(group, line)
  return group
}

/** The global origin is NOT the centre of the camera or of the wall. */
export function makeOriginGroup(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-world-origin'
  const axes: { axis: 'X' | 'Y' | 'Z'; end: THREE.Vector3; color: number }[] = [
    { axis: 'X', end: new THREE.Vector3(0.85, 0, 0), color: 0xdf3030 },
    { axis: 'Y', end: new THREE.Vector3(0, 0.85, 0), color: 0x279453 },
    { axis: 'Z', end: new THREE.Vector3(0, 0, 0.85), color: 0x365cc4 },
  ]
  for (const axis of axes) {
    const arrow = new THREE.ArrowHelper(axis.end.clone().normalize(),
      new THREE.Vector3(0, 0.03, 0), axis.end.length(), axis.color, 0.16, 0.08)
    arrow.renderOrder = 102
    group.add(arrow)
    const label = labelSprite(axis.axis)
    label.scale.set(0.45, 0.24, 1)
    label.position.copy(axis.end).add(new THREE.Vector3(0, 0.18, 0))
    group.add(label)
  }
  const pointMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }),
  )
  pointMarker.position.set(0, 0.03, 0)
  group.add(pointMarker)
  const label = labelSprite('0, 0, 0')
  label.position.set(-0.48, 0.27, 0.25)
  label.scale.set(0.96, 0.22, 1)
  group.add(label)
  return group
}

export function disposeDimensionGroup(group: THREE.Group): void {
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line ||
      object instanceof THREE.LineSegments) {
      object.geometry.dispose()
    }
    if (object instanceof THREE.Sprite) {
      const mat = object.material as THREE.SpriteMaterial
      mat.map?.dispose()
      mat.dispose()
    } else if (object instanceof THREE.Mesh || object instanceof THREE.Line ||
      object instanceof THREE.LineSegments) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    }
  })
}
