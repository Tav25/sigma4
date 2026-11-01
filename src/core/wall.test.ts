
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { generateWallPanel } from './wall'
import {
  generateTimberGeometry,
  boxCenterWorld,
  mmToMeters,
  timberVolumeM3,
  longitudinalEndPoint,
} from './timber'

function makeBox(el: ReturnType<typeof generateWallPanel>['elements'][number]) {
  const spec = generateTimberGeometry(el)
  const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
  const mesh = new THREE.Mesh(geo)
  const c = boxCenterWorld(el)
  mesh.position.set(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
  const q = spec.quaternion
  mesh.quaternion.set(q.x, q.y, q.z, q.w)
  return mesh
}

const params = { length: 3000, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 }

describe('Stage4 wall panel', () => {
  it('Test A - exactly 9 elements', () => {
    const w = generateWallPanel(params)
    expect(w.elements.length).toBe(9)
  })

  it('stud count 6', () => {
    const w = generateWallPanel(params)
    const studs = w.elements.filter((e) => e.role === 'stud')
    expect(studs.length).toBe(6)
  })

  it('Test B - all studs vertical length 2565', () => {
    const w = generateWallPanel(params)
    const studs = w.elements.filter((e) => e.role === 'stud')
    for (const s of studs) {
      expect(s.length).toBe(2565)
      const ep = longitudinalEndPoint(s)
      expect(ep.x).toBeCloseTo(s.position.x, 6)
      expect(ep.z).toBeCloseTo(s.position.z, 6)
    }
  })

  it('Test V - bottom plate Y 0-45', () => {
    const w = generateWallPanel(params)
    const el = w.elements.find((e) => e.id === 'plate-bottom-1')!
    const box = new THREE.Box3().setFromObject(makeBox(el))
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.045, 6)
  })

  it('Test G - top plate 1 Y 2610-2655', () => {
    const w = generateWallPanel(params)
    const el = w.elements.find((e) => e.id === 'plate-top-1')!
    const box = new THREE.Box3().setFromObject(makeBox(el))
    expect(box.min.y).toBeCloseTo(2.61, 6)
    expect(box.max.y).toBeCloseTo(2.655, 6)
  })

  it('Test D - top plate 2 Y 2655-2700', () => {
    const w = generateWallPanel(params)
    const el = w.elements.find((e) => e.id === 'plate-top-2')!
    const box = new THREE.Box3().setFromObject(makeBox(el))
    expect(box.min.y).toBeCloseTo(2.655, 6)
    expect(box.max.y).toBeCloseTo(2.7, 6)
  })

  it('Test E - contact surfaces', () => {
    const w = generateWallPanel(params)
    const plate = w.elements.find((e) => e.id === 'plate-bottom-1')!
    const stud = w.elements.find((e) => e.id === 'stud-01')!
    const pb = new THREE.Box3().setFromObject(makeBox(plate))
    const sb = new THREE.Box3().setFromObject(makeBox(stud))
    expect(pb.max.y).toBeCloseTo(0.045, 6)
    expect(sb.min.y).toBeCloseTo(0.045, 6)
  })

  it('Test Z - section orientation', () => {
    const w = generateWallPanel(params)
    const plate = w.elements.find((e) => e.id === 'plate-bottom-1')!
    const stud = w.elements.find((e) => e.id === 'stud-01')!
    expect(plate.orientation.roll).toBe(90)
    expect(stud.orientation.roll).toBe(0)
  })

  it('Test I - volumes', () => {
    const w = generateWallPanel(params)
    const bottom = w.elements.find((e) => e.id === 'plate-bottom-1')!
    const tops = w.elements.filter((e) => e.role === 'top-plate')
    const studs = w.elements.filter((e) => e.role === 'stud')
    expect(timberVolumeM3(bottom)).toBeCloseTo(0.019575, 6)
    const topVol = tops.reduce((s, e) => s + timberVolumeM3(e), 0)
    expect(topVol).toBeCloseTo(0.03915, 6)
    const studVol = studs.reduce((s, e) => s + timberVolumeM3(e), 0)
    expect(studVol).toBeCloseTo(0.10041975, 6)
    const total = w.elements.reduce((s, e) => s + timberVolumeM3(e), 0)
    expect(total).toBeCloseTo(0.15914475, 6)
  })

  it('Test Zh - overall bbox 3000x2700x145', () => {
    const w = generateWallPanel(params)
    const full = new THREE.Box3()
    for (const el of w.elements) {
      const mesh = makeBox(el)
      full.union(new THREE.Box3().setFromObject(mesh))
    }
    const size = new THREE.Vector3()
    full.getSize(size)
    expect(size.x).toBeCloseTo(3, 6)
    expect(size.y).toBeCloseTo(2.7, 6)
    expect(size.z).toBeCloseTo(0.145, 6)
    expect(full.min.x).toBeCloseTo(0, 6)
    expect(full.min.y).toBeCloseTo(0, 6)
    expect(full.min.z).toBeCloseTo(-0.0725, 6)
  })

  it('Test K - changing length/height rebuilds, no dupes', () => {
    const w1 = generateWallPanel({ ...params, length: 4000, height: 3000 })
    const w2 = generateWallPanel({ ...params, length: 4000, height: 3000 })
    expect(w1.elements.length).toBe(w2.elements.length)
    // stud count recalculated: last at length-45
    const studs = w1.elements.filter((e) => e.role === 'stud')
    const lastStud = studs[studs.length - 1]
    const lastBox = new THREE.Box3().setFromObject(makeBox(lastStud))
    expect(lastBox.max.x).toBeCloseTo(4, 6)
  })

  it('stud positions along X', () => {
    const w = generateWallPanel(params)
    const studs = w.elements.filter((e) => e.role === 'stud').sort((a,b) => a.position.x - b.position.x)
    const starts = studs.map((s) => s.position.x - 22.5)
    expect(starts).toEqual([0, 600, 1200, 1800, 2400, 2955])
  })
})


describe('Stage4.2 stud placement', () => {
  it('L=2000: 5 studs at expected positions', () => {
    const w = generateWallPanel({ length: 2000, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 })
    expect(w.elements.length).toBe(8)
    const studs = w.elements.filter((e) => e.role === 'stud').sort((a,b) => a.position.x - b.position.x)
    expect(studs.length).toBe(5)
    const starts = studs.map((st) => st.position.x - 22.5)
    expect(starts).toEqual([0, 600, 1200, 1577.5, 1955])
    // all within bounds
    for (const st of studs) {
      const box = new THREE.Box3().setFromObject(makeBox(st))
      expect(box.min.x).toBeGreaterThanOrEqual(-1e-9)
      expect(box.max.x).toBeLessThanOrEqual(2 + 1e-9)
    }
  })

  it('L=1500: 4 studs at expected positions', () => {
    const w = generateWallPanel({ length: 1500, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 })
    expect(w.elements.length).toBe(7)
    const studs = w.elements.filter((e) => e.role === 'stud').sort((a,b) => a.position.x - b.position.x)
    expect(studs.length).toBe(4)
    const starts = studs.map((st) => st.position.x - 22.5)
    expect(starts).toEqual([0, 600, 1027.5, 1455])
  })

  it('L=3000: 6 studs expected', () => {
    const w = generateWallPanel(params)
    const studs = w.elements.filter((e) => e.role === 'stud').sort((a,b) => a.position.x - b.position.x)
    const starts = studs.map((st) => st.position.x - 22.5)
    expect(starts).toEqual([0, 600, 1200, 1800, 2400, 2955])
  })

  it('sequential 3000->2000->1500->3000 restores', () => {
    const w1 = generateWallPanel({ ...params, length: 3000 })
    const w2 = generateWallPanel({ ...params, length: 2000 })
    const w3 = generateWallPanel({ ...params, length: 1500 })
    const w4 = generateWallPanel({ ...params, length: 3000 })
    expect(w2.elements.length).toBe(8)
    expect(w3.elements.length).toBe(7)
    expect(w1.elements.length).toBe(w4.elements.length)
    expect(w1.elements.map((e) => e.id)).toEqual(w4.elements.map((e) => e.id))
  })

  it('volumes table', () => {
    const v3000 = generateWallPanel({ ...params, length: 3000 }).elements.reduce((s,e) => s + timberVolumeM3(e), 0)
    const v2000 = generateWallPanel({ ...params, length: 2000 }).elements.reduce((s,e) => s + timberVolumeM3(e), 0)
    const v1500 = generateWallPanel({ ...params, length: 1500 }).elements.reduce((s,e) => s + timberVolumeM3(e), 0)
    expect(v3000).toBeCloseTo(0.15914475, 6)
    expect(v2000).toBeCloseTo(0.122833125, 6)
    expect(v1500).toBeCloseTo(0.096309, 6)
  })

  it('throws on too short wall', () => {
    expect(() => generateWallPanel({ ...params, length: 45 })).toThrow()
  })

  it('Y/Z invariants on length change', () => {
    const w = generateWallPanel({ ...params, length: 2000 })
    const stud = w.elements.find((e) => e.role === 'stud')!
    expect(stud.length).toBe(2565)
    const box = new THREE.Box3().setFromObject(makeBox(stud))
    expect(box.max.y - box.min.y).toBeCloseTo(2.565, 6)
    expect(box.max.z - box.min.z).toBeCloseTo(0.145, 6)
  })
})
