import * as THREE from 'three'
import {
  dimensionLabelYaw,
  exteriorExtensionFoot,
  formatDimensionNumber,
  type DimensionLayout,
  type DimensionLine,
  type DimensionPoint,
} from './dimension-model'

/**
 * Dimension marks are CAD-like vector geometry, not canvas images.
 * Vector digits remain sharp under oblique views, zoom and rotation.
 * All geometry stays on the XZ plane; no camera-facing billboards.
 */
const GROUND_Y = 0.026
const mm = (number: number) => number / 1000
const point = (p: DimensionPoint) => new THREE.Vector3(mm(p.x), GROUND_Y, mm(p.z))

/** Monoline numerals with normalized X=0..1 and Y=0..1.5. */
const DIGIT_PATHS: Record<string, number[][][]> = {
  '0': [[[0.16, 0], [0.84, 0], [1, 0.16], [1, 1.34], [0.84, 1.5], [0.16, 1.5], [0, 1.34], [0, 0.16], [0.16, 0]]],
  '1': [[[0.16, 1.15], [0.53, 1.5], [0.53, 0]], [[0.16, 0], [0.88, 0]]],
  '2': [[[0, 1.28], [0.18, 1.5], [0.82, 1.5], [1, 1.26], [1, 0.98], [0, 0.13], [0, 0], [1, 0]]],
  '3': [[[0, 1.5], [1, 1.5], [0.45, 0.78], [0.9, 0.78], [1, 0.58], [1, 0.19], [0.82, 0], [0, 0]]],
  '4': [[[0.83, 0], [0.83, 1.5]], [[0, 1.5], [0, 0.54], [1, 0.54]]],
  '5': [[[1, 1.5], [0, 1.5], [0, 0.78], [0.78, 0.78], [1, 0.6], [1, 0.18], [0.83, 0], [0, 0]]],
  '6': [[[0.94, 1.5], [0.2, 0.93], [0, 0.63], [0, 0.17], [0.16, 0], [0.82, 0], [1, 0.17], [1, 0.61], [0.82, 0.78], [0.18, 0.78]]],
  '7': [[[0, 1.5], [1, 1.5], [0.3, 0]]],
  '8': [[[0.18, 0.78], [0, 0.95], [0, 1.3], [0.18, 1.5], [0.82, 1.5], [1, 1.3], [1, 0.95], [0.82, 0.78], [0.18, 0.78], [0, 0.56], [0, 0.2], [0.18, 0], [0.82, 0], [1, 0.2], [1, 0.56], [0.82, 0.78]]],
  '9': [[[1, 0.72], [0.82, 0.72], [0.18, 0.72], [0, 0.9], [0, 1.3], [0.18, 1.5], [0.82, 1.5], [1, 1.3], [1, 0.6], [0.15, 0]]],
}

/** Closed quadrilateral, two triangles: a stroked segment with real width. */
function appendStroke(out: number[], ax: number, ay: number, bx: number, by: number, stroke: number) {
  const dx = bx - ax, dy = by - ay
  const magnitude = Math.hypot(dx, dy)
  if (magnitude < 1e-8) return
  const nx = dy / magnitude * stroke / 2
  const ny = -dx / magnitude * stroke / 2
  out.push(
    ax - nx, ay - ny, 0, bx - nx, by - ny, 0, bx + nx, by + ny, 0,
    ax - nx, ay - ny, 0, bx + nx, by + ny, 0, ax + nx, ay + ny, 0,
  )
}

function numericMesh(valueMm: number, color: number): THREE.Mesh {
  const digits = formatDimensionNumber(valueMm)
  const vertices: number[] = []
  const advance = 0.265
  const digitWidth = 0.20
  const digitHeight = 0.36
  const strokeWidth = 0.024
  for (let i = 0; i < digits.length; i++) {
    const paths = DIGIT_PATHS[digits[i]]
    if (!paths) throw new Error('Unsupported numeric dimension glyph')
    const originX = (i - (digits.length - 1) / 2) * advance - digitWidth / 2
    for (const path of paths) {
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k]
        appendStroke(vertices,
          originX + a[0] * digitWidth, (a[1] / 1.5 - 0.5) * digitHeight,
          originX + b[0] * digitWidth, (b[1] / 1.5 - 0.5) * digitHeight,
          strokeWidth,
        )
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  const material = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 112
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

function appendDimension(group: THREE.Group, line: DimensionLine, layout: DimensionLayout) {
  const a = point(line.dimensionFrom), b = point(line.dimensionTo)
  const axis = b.clone().sub(a).normalize()
  const outward = new THREE.Vector3(-axis.z, 0, axis.x)
  const footA = point(exteriorExtensionFoot(line, layout.bounds, 'from'))
  const footB = point(exteriorExtensionFoot(line, layout.bounds, 'to'))
  const arrowLength = Math.min(0.13, Math.max(0.02, mm(line.valueMm) * 0.22))
  const arrowHalf = Math.min(0.055, arrowLength * 0.46)
  const arrow = (tip: THREE.Vector3, forward: THREE.Vector3) => {
    const base = tip.clone().addScaledVector(forward, arrowLength)
    return [
      tip.clone(), base.clone().addScaledVector(outward, arrowHalf),
      tip.clone(), base.clone().addScaledVector(outward, -arrowHalf),
    ]
  }
  const points = [
    // Both extension lines start OUTSIDE the model's entire XZ footprint.
    footA, a.clone().addScaledVector(a.clone().sub(footA).normalize(), 0.08),
    footB, b.clone().addScaledVector(b.clone().sub(footB).normalize(), 0.08),
    a, b,
    ...arrow(a, axis), ...arrow(b, axis.clone().negate()),
  ]
  const overall = line.kind === 'overall'
  group.add(segments(points, overall ? 0x1562a8 : 0x274559))
  const number = numericMesh(line.valueMm, overall ? 0x134f89 : 0x20374e)
  number.name = 'dimension-number-' + line.id
  const tilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -Math.PI / 2,
  )
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), dimensionLabelYaw(line),
  )
  number.quaternion.copy(yaw.multiply(tilt))
  number.position.copy(a.clone().add(b).multiplyScalar(0.5))
  number.position.addScaledVector(outward, 0.48)
  number.position.y = GROUND_Y + 0.005
  group.add(number)
}

/** Render-only measurements; canonical JSON is not changed. */
export function makeDimensionGroup(layout: DimensionLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-planar-dimensions'
  for (const line of layout.lines) appendDimension(group, line, layout)
  return group
}

/** World origin is independent of the dimension annotation layer. */
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
      for (const material of materials) material.dispose()
    }
  })
}
