import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildDimensionLayout, type DimensionLayout } from './dimension-model'
import { makeDimensionGroup, makeOriginGroup, orientDimensionNumbers, disposeDimensionGroup } from './DimensionOverlay'
import { createProjectFromCurrentState, buildProjectSnapshot } from '../core/project-store'
import { rightCornerOrigin } from '../core/corner'
import { projectToScene } from './project-to-scene'

function layout(): DimensionLayout {
  const project = createProjectFromCurrentState({
    projectId: 'dimension-glyphs-regression', length: 6000, height: 2700,
    spacing: 600, openings: [],
  })
  const front = project.building.walls[0]
  project.building.walls.push({
    ...front, wallId: 'wall-002', orientation: 'z',
    lengthMm: 3000, origin: rightCornerOrigin(front, front), openings: [],
  })
  const rebuilt = buildProjectSnapshot(project)
  return buildDimensionLayout(rebuilt.building.walls, projectToScene(rebuilt).elements)
}

describe('S06.5.3 planar drawing legibility', () => {
  it('uses correct vector font glyphs sized 50% smaller, without raster textures', () => {
    const group = makeDimensionGroup(layout())
    const digits = group.getObjectByName('dimension-number-wall-dim-wall-001') as THREE.Mesh
    expect(digits).toBeInstanceOf(THREE.Mesh)
    expect(digits.geometry).toBeInstanceOf(THREE.ShapeGeometry)
    const geometry = digits.geometry as THREE.ShapeGeometry
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!
    // Previous 0.36m custom glyphs, new technical font <= 0.18m high.
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(0.08)
    expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(0.185)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(20)
    const mat = digits.material as THREE.MeshBasicMaterial
    expect(mat.map).toBeNull()
    expect(digits.name).toBe('dimension-number-wall-dim-wall-001')
    disposeDimensionGroup(group)
  })

  it('occludes ground-plane annotations behind timber using the real depth buffer', () => {
    const group = makeDimensionGroup(layout())
    const marks = group.children.filter(obj =>
      obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments)
    // Annotations may render later for layer ordering, but MUST obey the
    // depth buffer of the physically placed timber on the scene.
    expect(marks.length).toBeGreaterThan(10)
    for (const mark of marks) {
      const material = mark.material as THREE.Material
      expect(material.depthTest, mark.name).toBe(true)
      expect(material.depthWrite, mark.name).toBe(false)
    }
    const origin = makeOriginGroup()
    const core = origin.children.find(obj => obj instanceof THREE.Mesh) as THREE.Mesh
    expect((core.material as THREE.Material).depthTest).toBe(true)
    disposeDimensionGroup(group)
    disposeDimensionGroup(origin)
  })

  it('keeps both arrows and extension lines exactly in the XZ plane', () => {
    const dim = layout()
    const group = makeDimensionGroup(dim)
    const arrows = group.children.filter(obj => obj.name === 'dimension-arrows')
    expect(arrows).toHaveLength(dim.lines.length)
    for (const arrow of arrows) {
      const positions = (arrow as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute
      expect(positions.count).toBe(6) // two solid triangles
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(0.026, 6)
    }
    const lines = group.children.filter(obj => obj instanceof THREE.LineSegments)
    expect(lines).toHaveLength(dim.lines.length)
    for (const line of lines) {
      const positions = (line as THREE.LineSegments).geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(0.026, 6)
    }
    disposeDimensionGroup(group)
  })

  it('aligns digits with their wall both before and after orbiting the camera', () => {
    const group = makeDimensionGroup(layout())
    const a = group.getObjectByName('dimension-number-wall-dim-wall-001') as THREE.Mesh
    const b = group.getObjectByName('dimension-number-wall-dim-wall-002') as THREE.Mesh
    const camera = new THREE.PerspectiveCamera()
    for (const position of [[-8, 8, -8], [8, 8, 8], [-8, 8, 8]] as const) {
      camera.position.set(position[0], position[1], position[2])
      camera.lookAt(0, 0, 0)
      orientDimensionNumbers(group, camera)
      const directionA = new THREE.Vector3(1, 0, 0).applyQuaternion(a.quaternion)
      const directionB = new THREE.Vector3(1, 0, 0).applyQuaternion(b.quaternion)
      expect(Math.abs(directionA.x)).toBeCloseTo(1, 6)
      expect(Math.abs(directionA.z)).toBeLessThan(1e-6)
      expect(Math.abs(directionB.z)).toBeCloseTo(1, 6)
      expect(Math.abs(directionB.x)).toBeLessThan(1e-6)
    }
    // Top view: camera is vertically above target. Text must never flip
    // solely because the label is off-centre; 6000 must read left-to-right.
    camera.up.set(0, 0, -1)
    camera.position.set(3, 100, -3)
    camera.lookAt(3, 0, -3)
    orientDimensionNumbers(group, camera)
    const topBaselineX = new THREE.Vector3(1, 0, 0).applyQuaternion(a.quaternion)
    expect(topBaselineX.x).toBeGreaterThan(0.99)
    const topBaselineZ = new THREE.Vector3(1, 0, 0).applyQuaternion(b.quaternion)
    expect(topBaselineZ.z).toBeLessThan(-0.99)
    disposeDimensionGroup(group)
  })

  it('places all annotations on negative outer sides, never inside construction', () => {
    const dim = layout()
    for (const line of dim.lines) {
      const alongX = Math.abs(line.dimensionTo.x - line.dimensionFrom.x) >
        Math.abs(line.dimensionTo.z - line.dimensionFrom.z)
      if (alongX) {
        expect(line.dimensionFrom.z).toBeLessThan(dim.bounds.minZ)
        expect(line.dimensionTo.z).toBeLessThan(dim.bounds.minZ)
      } else {
        expect(line.dimensionFrom.x).toBeLessThan(dim.bounds.minX)
        expect(line.dimensionTo.x).toBeLessThan(dim.bounds.minX)
      }
    }
    const group = makeDimensionGroup(dim)
    const all = group.children.filter(obj => obj instanceof THREE.LineSegments)
    expect(all).toHaveLength(dim.lines.length)
    disposeDimensionGroup(group)
  })
})
