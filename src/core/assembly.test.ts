
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createMiniAssembly } from './assembly'
import {
  generateTimberGeometry,
  boxCenterWorld,
  mmToMeters,
  timberVolumeM3,
  longitudinalEndPoint,
  orientationQuaternion,
} from './timber'

function makeBox(el: ReturnType<typeof createMiniAssembly>['elements'][number]) {
  const spec = generateTimberGeometry(el)
  const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
  const mesh = new THREE.Mesh(geo)
  const c = boxCenterWorld(el)
  mesh.position.set(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
  const q = spec.quaternion
  mesh.quaternion.set(q.x, q.y, q.z, q.w)
  return { mesh, spec }
}

describe('Stage3 assembly', () => {
  it('Test A - exactly 3 elements', () => {
    const a = createMiniAssembly()
    expect(a.elements.length).toBe(3)
  })

  it('Test B - bottom plate bbox 3000x45x145', () => {
    const a = createMiniAssembly()
    const el = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(3, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.045, 6)
    expect(box.min.z).toBeCloseTo(-0.0725, 6)
    expect(box.max.z).toBeCloseTo(0.0725, 6)
  })

  it('Test V - left stud bbox', () => {
    const a = createMiniAssembly()
    const el = a.elements.find((e) => e.id === 'stud-left')!
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(0.045, 6)
    expect(box.min.y).toBeCloseTo(0.045, 6)
    expect(box.max.y).toBeCloseTo(2.61, 6)
    expect(box.min.z).toBeCloseTo(-0.0725, 6)
    expect(box.max.z).toBeCloseTo(0.0725, 6)
  })

  it('Test G - right stud bbox', () => {
    const a = createMiniAssembly()
    const el = a.elements.find((e) => e.id === 'stud-right')!
    const { mesh } = makeBox(el)
    const box = new THREE.Box3().setFromObject(mesh)
    expect(box.min.x).toBeCloseTo(2.955, 6)
    expect(box.max.x).toBeCloseTo(3, 6)
    expect(box.min.y).toBeCloseTo(0.045, 6)
    expect(box.max.y).toBeCloseTo(2.61, 6)
    expect(box.min.z).toBeCloseTo(-0.0725, 6)
    expect(box.max.z).toBeCloseTo(0.0725, 6)
  })

  it('Test D - contact: plate top Y=45, studs bottom Y=45', () => {
    const a = createMiniAssembly()
    const plate = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const studL = a.elements.find((e) => e.id === 'stud-left')!
    const studR = a.elements.find((e) => e.id === 'stud-right')!
    const plateBox = new THREE.Box3().setFromObject(makeBox(plate).mesh)
    const studLBox = new THREE.Box3().setFromObject(makeBox(studL).mesh)
    const studRBox = new THREE.Box3().setFromObject(makeBox(studR).mesh)
    expect(plateBox.max.y).toBeCloseTo(0.045, 6)
    expect(studLBox.min.y).toBeCloseTo(0.045, 6)
    expect(studRBox.min.y).toBeCloseTo(0.045, 6)
  })

  it('Test E - studs vertical (longitudinal along Y)', () => {
    const a = createMiniAssembly()
    for (const id of ['stud-left', 'stud-right']) {
      const el = a.elements.find((e) => e.id === id)!
      const ep = longitudinalEndPoint(el)
      // end point should be ref + 2565 along Y
      expect(ep.x).toBeCloseTo(el.position.x, 6)
      expect(ep.y).toBeCloseTo(el.position.y + 2565, 6)
      expect(ep.z).toBeCloseTo(el.position.z, 6)
    }
  })

  it('Test Zh - plate horizontal (longitudinal along X)', () => {
    const a = createMiniAssembly()
    const el = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const ep = longitudinalEndPoint(el)
    expect(ep.x).toBeCloseTo(el.position.x + 3000, 6)
    expect(ep.y).toBeCloseTo(el.position.y, 6)
    expect(ep.z).toBeCloseTo(el.position.z, 6)
  })

  it('Test Z - roll: plate height Y=45, stud X=45 Z=145', () => {
    const a = createMiniAssembly()
    const plate = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const stud = a.elements.find((e) => e.id === 'stud-left')!
    expect(plate.orientation.roll).toBe(90)
    expect(stud.orientation.roll).toBe(0)
    // plate bbox height Y=45 already in Test B
    // stud: width X=45, depth Z=145
    const { mesh } = makeBox(stud)
    const box = new THREE.Box3().setFromObject(mesh)
    const sx = box.max.x - box.min.x
    const sz = box.max.z - box.min.z
    expect(sx).toBeCloseTo(0.045, 6)
    expect(sz).toBeCloseTo(0.145, 6)
  })

  it('Test I - volumes', () => {
    const a = createMiniAssembly()
    const plate = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const stud = a.elements.find((e) => e.id === 'stud-left')!
    expect(timberVolumeM3(plate)).toBeCloseTo(0.019575, 6)
    expect(timberVolumeM3(stud)).toBeCloseTo(0.016736625, 6)
    const total = a.elements.reduce((s, e) => s + timberVolumeM3(e), 0)
    expect(total).toBeCloseTo(0.05304825, 6)
    const twoStuds = timberVolumeM3(stud) * 2
    expect(twoStuds).toBeCloseTo(0.03347325, 6)
  })

  it('Test K - orthonormal quaternion for plate', () => {
    const a = createMiniAssembly()
    const plate = a.elements.find((e) => e.id === 'plate-bottom-1')!
    const q = orientationQuaternion(plate.orientation)
    const len = Math.sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w)
    expect(len).toBeCloseTo(1, 6)
  })
})
