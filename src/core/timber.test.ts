import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  createTimberElement,
  generateTimberGeometry,
  timberVolumeM3,
  mmToMeters,
} from './timber'

describe('TimberElement geometry', () => {
  it('length in meters is 3', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(mmToMeters(el.length)).toBe(3)
  })

  it('height in meters is 0.145', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(mmToMeters(el.height)).toBe(0.145)
  })

  it('thickness in meters is 0.045', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(mmToMeters(el.width)).toBe(0.045)
  })

  it('X from 0 to 3000 mm, Y from 0 to 145 mm, Z from -22.5 to +22.5 mm', () => {
    const el = createTimberElement({
      length: 3000,
      width: 45,
      height: 145,
      position: { x: 1500, y: 72.5, z: 0 },
    })
    const spec = generateTimberGeometry(el)
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z)),
    )
    mesh.position.set(mmToMeters(spec.center.x), mmToMeters(spec.center.y), mmToMeters(spec.center.z))
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(3, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.145, 6)
    expect(box.min.z).toBeCloseTo(-0.0225, 6)
    expect(box.max.z).toBeCloseTo(0.0225, 6)
  })

  it('bounding box size 3000x145x45 mm', () => {
    const el = createTimberElement({
      length: 3000,
      width: 45,
      height: 145,
      position: { x: 1500, y: 72.5, z: 0 },
    })
    const spec = generateTimberGeometry(el)
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z)),
    )
    mesh.position.set(mmToMeters(spec.center.x), mmToMeters(spec.center.y), mmToMeters(spec.center.z))
    const box = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    box.getSize(size)
    expect(size.x).toBeCloseTo(3, 6)
    expect(size.y).toBeCloseTo(0.145, 6)
    expect(size.z).toBeCloseTo(0.045, 6)
  })

  it('volume is 0.019575 m3', () => {
    const el = createTimberElement({ length: 3000, width: 45, height: 145 })
    expect(timberVolumeM3(el)).toBeCloseTo(0.019575, 6)
  })

  it('changing length to 4500 keeps X start 0 and volume 0.0293625', () => {
    const el = createTimberElement({
      length: 4500,
      width: 45,
      height: 145,
      position: { x: 2250, y: 72.5, z: 0 },
    })
    const spec = generateTimberGeometry(el)
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z)),
    )
    mesh.position.set(mmToMeters(spec.center.x), mmToMeters(spec.center.y), mmToMeters(spec.center.z))
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(4.5, 6)
    expect(timberVolumeM3(el)).toBeCloseTo(0.0293625, 6)
  })
})
describe('BoundingBox 4500', () => {
  it('prints bbox for length 4500', () => {
    const el = createTimberElement({
      length: 4500,
      width: 45,
      height: 145,
      position: { x: 2250, y: 72.5, z: 0 },
    })
    const spec = generateTimberGeometry(el)
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z)),
    )
    mesh.position.set(mmToMeters(spec.center.x), mmToMeters(spec.center.y), mmToMeters(spec.center.z))
    const box = new THREE.Box3().setFromObject(mesh)
    console.log('BBOX4500 min:', box.min.x, box.min.y, box.min.z)
    console.log('BBOX4500 max:', box.max.x, box.max.y, box.max.z)
    const size = new THREE.Vector3()
    box.getSize(size)
    console.log('BBOX4500 size:', size.x, size.y, size.z)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(4.5, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.145, 6)
    expect(box.min.z).toBeCloseTo(-0.0225, 6)
    expect(box.max.z).toBeCloseTo(0.0225, 6)
  })
})