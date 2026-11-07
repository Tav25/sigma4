import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { calculateWorldBounds } from './view-bounds'
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

describe('S05.8 actual mesh bounds', () => {
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
    expect(actual.min.z).toBeCloseTo(-3.145, 6)
    expect(actual.max.y).toBeCloseTo(2.7, 6)
  })

})
