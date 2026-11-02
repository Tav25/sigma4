import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { calculateWorldBounds, topViewDistance } from './view-bounds'
import { createProjectFromCurrentState } from '../core/project-store'
import { createProjectStore } from '../core/ProjectStore'
import { rightCornerOrigin } from '../core/corner'
import { projectToScene } from './project-to-scene'
import { boxCenterWorld, generateTimberGeometry, mmToMeters } from '../core/timber'

const elementsWithCorner = () => {
  const store = createProjectStore(createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600, openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  }))
  const front = store.getSnapshot().building.walls[0]
  expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: {
    ...front, wallId: 'wall-002', lengthMm: 3000, orientation: 'z',
    origin: rightCornerOrigin(front, front), openings: [],
  } } }).success).toBe(true)
  return projectToScene(store.getSnapshot()).elements
}

describe('S05.8 actual mesh bounds and top camera', () => {
  it('matches a union of real rotated Three.js mesh boxes', () => {
    const elements = elementsWithCorner()
    expect(elements).toHaveLength(46)
    const expected = new THREE.Box3()
    for (const el of elements) {
      const spec = generateTimberGeometry(el)
      const c = boxCenterWorld(el)
      const geometry = new THREE.BoxGeometry(
        mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z),
      )
      const mesh = new THREE.Mesh(geometry)
      mesh.position.set(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
      mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
      expected.union(new THREE.Box3().setFromObject(mesh))
      geometry.dispose()
    }
    const actual = calculateWorldBounds(elements)
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 6)
      expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 6)
    }
    expect(actual.max.x).toBeCloseTo(6, 6)
    expect(actual.min.z).toBeCloseTo(-3.0725, 6)
    expect(actual.max.y).toBeCloseTo(2.7, 6)
  })

  it('frames the full 6x3m L-corner from above at wide and narrow aspect ratios', () => {
    const bounds = calculateWorldBounds(elementsWithCorner())
    const size = bounds.getSize(new THREE.Vector3())
    for (const aspect of [16 / 9, 9 / 16]) {
      const nearOrthoFov = 1
      const distance = topViewDistance(bounds, nearOrthoFov, aspect)
      const nearestSurface = distance - size.y / 2
      const tanSmall = Math.tan(THREE.MathUtils.degToRad(nearOrthoFov / 2))
      expect(nearestSurface * tanSmall).toBeGreaterThan(size.z / 2)
      expect(nearestSurface * tanSmall * aspect).toBeGreaterThan(size.x / 2)
      // Maximum parallax scaling from the nearest to farthest horizontal
      // section of the frame must stay under 2% at the extremities.
      expect((distance + size.y / 2) / nearestSurface).toBeLessThan(1.02)
    }
  })

  it('rejects invalid camera input', () => {
    const bounds = calculateWorldBounds(elementsWithCorner())
    expect(() => topViewDistance(bounds, 0, 1)).toThrow()
    expect(() => topViewDistance(bounds, 60, 0)).toThrow()
    expect(() => topViewDistance(new THREE.Box3(), 60, 1)).toThrow()
  })
})
