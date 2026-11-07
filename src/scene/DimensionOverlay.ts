import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import fontData from 'three/examples/fonts/helvetiker_regular.typeface.json'
import {
  dimensionLabelYaw,
  exteriorExtensionFoot,
  formatDimensionNumber,
  type DimensionLayout,
  type DimensionLine,
  type DimensionPoint,
} from './dimension-model'

/** All annotation vertices are on the same horizontal drawing plane. */
const GROUND_Y = 0.026
const toMeters = (number: number) => number / 1000
const point = (p: DimensionPoint) =>
  new THREE.Vector3(toMeters(p.x), GROUND_Y, toMeters(p.z))

/** True vector glyph outlines (no raster texture or improvised digit strokes).
 * 0.18 m height is 50% of S06.5.2's 0.36 m glyph size. */
const VECTOR_DIGIT_SIZE = 0.18
const font = new FontLoader().parse(fontData)

/** Reusable glyphs for dimension and room-area annotations.
 * No textures, DOM labels or non-deterministic canvas font metrics.
 */
export function makePlanarVectorText(
  characters: string, color: number, size = VECTOR_DIGIT_SIZE,
): THREE.Mesh {
  const shapes = font.generateShapes(characters, size)
  const geometry = new THREE.ShapeGeometry(shapes, 4)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (bounds) {
    geometry.translate(
      -(bounds.min.x + bounds.max.x) / 2,
      -(bounds.min.y + bounds.max.y) / 2,
      0,
    )
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: false, side: THREE.DoubleSide,
    // Respect timber depth: ground-plan numbers must not render THROUGH studs.
    depthWrite: false, depthTest: true,
  }))
  mesh.renderOrder = 112
  return mesh
}
function numericMesh(valueMm: number, color: number): THREE.Mesh {
  return makePlanarVectorText(formatDimensionNumber(valueMm), color)
}

/** Dimension strokes and extension lines: always on XZ, never through boards. */
function segmentLines(points: THREE.Vector3[], color: number): THREE.LineSegments {
  const mesh = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, depthTest: true, depthWrite: false }),
  )
  mesh.renderOrder = 107
  return mesh
}

/** Solid CAD dimension arrowheads, lying exactly on the dimension line. */
function arrowTriangles(a: THREE.Vector3, b: THREE.Vector3,
  axis: THREE.Vector3, normal: THREE.Vector3, color: number,
  length: number, halfWidth: number): THREE.Mesh {
  const vertices: number[] = []
  for (const [tip, inward] of [[a, axis], [b, axis.clone().negate()]] as const) {
    const base = tip.clone().addScaledVector(inward, length)
    const left = base.clone().addScaledVector(normal, halfWidth)
    const right = base.clone().addScaledVector(normal, -halfWidth)
    for (const point of [tip, left, right]) vertices.push(point.x, point.y, point.z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  const arrows = new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, depthTest: true, depthWrite: false,
    }))
  arrows.name = 'dimension-arrows'
  arrows.renderOrder = 109
  return arrows
}

function appendDimension(group: THREE.Group, line: DimensionLine, layout: DimensionLayout) {
  const a = point(line.dimensionFrom)
  const b = point(line.dimensionTo)
  const axis = b.clone().sub(a).normalize()
  const isAlongX = Math.abs(axis.x) > Math.abs(axis.z)
  // Always move away from timber, not toward the inside of the L.
  const side = isAlongX
    ? Math.sign(line.dimensionFrom.z - line.extensionFrom.z) || 1
    : Math.sign(line.dimensionFrom.x - line.extensionFrom.x) || 1
  const outward = isAlongX
    ? new THREE.Vector3(0, 0, side)
    : new THREE.Vector3(side, 0, 0)
  const normal = new THREE.Vector3(-axis.z, 0, axis.x)
  const footA = point(exteriorExtensionFoot(line, layout.bounds, 'from'))
  const footB = point(exteriorExtensionFoot(line, layout.bounds, 'to'))
  const color = line.kind === 'overall' ? 0x1562a8 : 0x274559
  const cap = 0.075
  group.add(segmentLines([
    footA, a.clone().addScaledVector(outward, cap),
    footB, b.clone().addScaledVector(outward, cap),
    a, b,
  ], color))
  const length = Math.min(0.125, Math.max(0.017, toMeters(line.valueMm) * 0.24))
  group.add(arrowTriangles(a, b, axis, normal, color, length, length * 0.23))

  const number = numericMesh(line.valueMm, color)
  number.name = 'dimension-number-' + line.id
  const tilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -Math.PI / 2,
  )
  const baseYaw = dimensionLabelYaw(line)
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), baseYaw,
  )
  number.quaternion.copy(yaw.multiply(tilt))
  number.userData.dimensionBaseYaw = baseYaw
  number.position.copy(a.clone().add(b).multiplyScalar(0.5))
  number.position.addScaledVector(outward, 0.16)
  number.position.y = GROUND_Y + 0.005
  group.add(number)
}

/**
 * Keep technical numbers readable while orbiting the camera. The only
 * possible additional rotation is 180 degrees around vertical Y: the
 * text never stops being parallel to the wall's X / Z direction.
 */
export function orientDimensionNumbers(group: THREE.Group, camera: THREE.Camera) {
  const worldUp = new THREE.Vector3(0, 0, -1)
  const direction = new THREE.Vector3()
  for (const item of group.children) {
    if (!item.name.startsWith('dimension-number-')) continue
    const baseYaw = item.userData.dimensionBaseYaw as number
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2,
    )
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), baseYaw,
    )
    // The planar glyph's upper edge must point toward the viewing side.
    // In overhead mode the camera has no useful horizontal direction, so
    // retain the project's natural +X/-Z annotation orientation.
    const worldDirection = worldUp.clone().applyQuaternion(yaw)
    // Use the CAMERA'S forward vector, not camera-to-label position:
    // in top view the latter points sideways for off-centre dimensions
    // and incorrectly mirrors '6000' into '0009'.
    camera.getWorldDirection(direction).multiplyScalar(-1).setY(0)
    const flip = direction.lengthSq() > 0.04 &&
      worldDirection.dot(direction.normalize()) < -0.01
    if (flip) yaw.multiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), Math.PI,
    ))
    item.quaternion.copy(yaw.multiply(tilt))
  }
}

/** Renderer-only graphics: the canonical JSON stays unchanged. */
export function makeDimensionGroup(layout: DimensionLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sigma4-planar-dimensions'
  for (const line of layout.lines) appendDimension(group, line, layout)
  return group
}

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
    new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: true }),
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
