
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  createTimberElement,
  generateTimberGeometry,
  boxCenterWorld,
  longitudinalEndPoint,
  timberVolumeM3,
  mmToMeters,
  orientationQuaternion,
  type OrientationMode,
} from './timber'

function makeBox(el: ReturnType<typeof createTimberElement>) {
  const spec = generateTimberGeometry(el)
  const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
  const mesh = new THREE.Mesh(geo)
  const c = boxCenterWorld(el)
  mesh.position.set(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
  const q = spec.quaternion
  mesh.quaternion.set(q.x, q.y, q.z, q.w)
  return { mesh, spec }
}

describe('Stage1 geometry', () => {
  it('length/height/thickness in meters', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(mmToMeters(el.length)).toBe(3)
    expect(mmToMeters(el.height)).toBe(0.145)
    expect(mmToMeters(el.width)).toBe(0.045)
  })

  it('volume 0.019575', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(timberVolumeM3(el)).toBeCloseTo(0.019575, 6)
  })

  it('bottom at Y=0 for ref origin', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 } })
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.y).toBeCloseTo(0, 6)
  })
})

describe('Test A - horizontal X', () => {
  it('bbox X 0-3000, Y 0-145, Z -22.5..22.5', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'x', angle: 0, roll: 0 } })
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(3, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.145, 6)
    expect(box.min.z).toBeCloseTo(-0.0225, 6)
    expect(box.max.z).toBeCloseTo(0.0225, 6)
  })
})

describe('Test B - vertical Y', () => {
  it('longitudinal end point (0,3000,0), ref unchanged, volume same', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'y', angle: 0, roll: 0 } })
    const ep = longitudinalEndPoint(el)
    expect(ep.x).toBeCloseTo(0, 6)
    expect(ep.y).toBeCloseTo(3000, 6)
    expect(ep.z).toBeCloseTo(0, 6)
    expect(el.position.x).toBe(0)
    expect(el.position.y).toBe(0)
    expect(el.position.z).toBe(0)
    expect(timberVolumeM3(el)).toBeCloseTo(0.019575, 6)
    // start end face at Y=0: min Y of bbox should be 0
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(3, 6)
  })
})

describe('Test C - horizontal along Z', () => {
  it('longitudinal end point (0,0,3000), volume same', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'z', angle: 0, roll: 0 } })
    const ep = longitudinalEndPoint(el)
    expect(ep.x).toBeCloseTo(0, 6)
    expect(ep.y).toBeCloseTo(0, 6)
    expect(ep.z).toBeCloseTo(3000, 6)
    expect(timberVolumeM3(el)).toBeCloseTo(0.019575, 6)
  })
})

describe('Test D - slope 30', () => {
  it('end point (2598.076, 1500, 0)', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'slope', angle: 30, roll: 0 } })
    const ep = longitudinalEndPoint(el)
    expect(ep.x).toBeCloseTo(2598.076, 2)
    expect(ep.y).toBeCloseTo(1500, 6)
    expect(ep.z).toBeCloseTo(0, 6)
  })
})

describe('Test E - sequential rotations restore', () => {
  it('X->Y->Z->slope->X restores geometry', () => {
    const base = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'x', angle: 0, roll: 0 } })
    const modes: OrientationMode[] = ['y', 'z', 'slope', 'x']
    let el = base
    for (const m of modes) {
      el = createTimberElement({ ...el, orientation: { mode: m, angle: m === 'slope' ? 30 : 0, roll: 0 } })
    }
    const ep = longitudinalEndPoint(el)
    expect(ep.x).toBeCloseTo(3000, 6)
    expect(ep.y).toBeCloseTo(0, 6)
    expect(ep.z).toBeCloseTo(0, 6)
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(3, 6)
  })
})

describe('Test Zh - volume invariant', () => {
  it('volume stays 0.019575 in all modes', () => {
    for (const m of ['x', 'y', 'z', 'slope'] as OrientationMode[]) {
      const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: m, angle: 30, roll: 0 } })
      expect(timberVolumeM3(el)).toBeCloseTo(0.019575, 6)
    }
  })
})

describe('Test D-move - displacement', () => {
  it('all vertices shift by vector, sizes unchanged', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 1000, y: 500, z: 2000 }, orientation: { mode: 'x', angle: 0, roll: 0 } })
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(1, 6)
    expect(box.max.x).toBeCloseTo(4, 6)
    expect(box.min.y).toBeCloseTo(0.5, 6)
    expect(box.max.y).toBeCloseTo(0.645, 6)
    expect(box.min.z).toBeCloseTo(1.9775, 6)
    expect(box.max.z).toBeCloseTo(2.0225, 6)
  })
})

describe('Test G - no duplicate id on changes', () => {
  it('id stable across param changes', () => {
    const el1 = createTimberElement({ length: 3000, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'x', angle: 0, roll: 0 }, id: 'fixed-id' })
    const el2 = createTimberElement({ length: 4500, width: 45, height: 145, position: { x: 100, y: 0, z: 0 }, orientation: { mode: 'y', angle: 0, roll: 0 }, id: 'fixed-id' })
    expect(el1.id).toBe(el2.id)
  })
})

describe('4500 bbox (stage1)', () => {
  it('prints bbox for length 4500', () => {
    const el = createTimberElement({ length: 4500, width: 45, height: 145, position: { x: 0, y: 0, z: 0 }, orientation: { mode: 'x', angle: 0, roll: 0 } })
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    console.log('BBOX4500 min:', box.min.x, box.min.y, box.min.z)
    console.log('BBOX4500 max:', box.max.x, box.max.y, box.max.z)
    console.log('BBOX4500 size:', box.max.x-box.min.x, box.max.y-box.min.y, box.max.z-box.min.z)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(4.5, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.145, 6)
    expect(box.min.z).toBeCloseTo(-0.0225, 6)
    expect(box.max.z).toBeCloseTo(0.0225, 6)
  })
})

describe('orthonormality', () => {
  it('quaternion has unit length', () => {
    for (const m of ['x','y','z','slope'] as OrientationMode[]) {
      const q = orientationQuaternion({ mode: m, angle: 30, roll: 0 })
      const len = Math.sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w)
      expect(len).toBeCloseTo(1, 6)
    }
  })
})
