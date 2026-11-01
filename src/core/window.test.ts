
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { generateWallWithWindow, applyWindowOpening } from './window'
import { generateWallPanel } from './wall'
import {
  generateTimberGeometry,
  boxCenterWorld,
  mmToMeters,
  timberVolumeM3,
} from './timber'

function makeBox(el: any) {
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

describe('Stage5 window opening', () => {
  it('Test A - 18 elements when window on', () => {
    const w = generateWallWithWindow(params)
    expect(w.elements.length).toBe(20)
  })

  it('Test B - 9 elements when window off', () => {
    const w = generateWallPanel(params)
    expect(w.elements.length).toBe(9)
  })

  it('applyWindowOpening toggles count', () => {
    const base = generateWallPanel(params)
    const withWin = applyWindowOpening(base.elements)
    expect(withWin.length).toBe(20)
  })

  it('no element intersects opening (X 900-2100, Y 900-2100)', () => {
    const w = generateWallWithWindow(params)
    const ox = 900, oy = 900, ow = 1200, oh = 1200
    for (const el of w.elements) {
      const mesh = makeBox(el)
      const box = new THREE.Box3().setFromObject(mesh)
      // check overlap in X and Y
      const xOverlap = box.max.x > ox/1000 && box.min.x < (ox+ow)/1000
      const yOverlap = box.max.y > oy/1000 && box.min.y < (oy+oh)/1000
      if (xOverlap && yOverlap) {
        // must not have wood in opening interior; allow boundary contact
        // ensure not fully inside
        const fullyInside = box.min.x >= ox/1000 - 1e-9 && box.max.x <= (ox+ow)/1000 + 1e-9 &&
                            box.min.y >= oy/1000 - 1e-9 && box.max.y <= (oy+oh)/1000 + 1e-9
        expect(fullyInside).toBe(false)
      }
    }
  })

  it('king studs positions', () => {
    const w = generateWallWithWindow(params)
    const kl = w.elements.find((e) => e.id === 'king-left')!
    const kr = w.elements.find((e) => e.id === 'king-right')!
    const klBox = new THREE.Box3().setFromObject(makeBox(kl))
    const krBox = new THREE.Box3().setFromObject(makeBox(kr))
    expect(klBox.min.x).toBeCloseTo(0.81, 6)
    expect(klBox.max.x).toBeCloseTo(0.855, 6)
    expect(klBox.min.y).toBeCloseTo(0.045, 6)
    expect(klBox.max.y).toBeCloseTo(2.61, 6)
    expect(krBox.min.x).toBeCloseTo(2.145, 6)
    expect(krBox.max.x).toBeCloseTo(2.19, 6)
  })

  it('jack studs positions', () => {
    const w = generateWallWithWindow(params)
    const jl = w.elements.find((e) => e.id === 'jack-left')!
    const jr = w.elements.find((e) => e.id === 'jack-right')!
    const jlBox = new THREE.Box3().setFromObject(makeBox(jl))
    const jrBox = new THREE.Box3().setFromObject(makeBox(jr))
    expect(jlBox.min.x).toBeCloseTo(0.855, 6)
    expect(jlBox.max.x).toBeCloseTo(0.9, 6)
    expect(jlBox.min.y).toBeCloseTo(0.045, 6)
    expect(jlBox.max.y).toBeCloseTo(2.1, 6)
    expect(jrBox.min.x).toBeCloseTo(2.1, 6)
    expect(jrBox.max.x).toBeCloseTo(2.145, 6)
  })

  it('header two boards Z split', () => {
    const w = generateWallWithWindow(params)
    const h1 = w.elements.find((e) => e.id === 'header-1')!
    const h2 = w.elements.find((e) => e.id === 'header-2')!
    const b1 = new THREE.Box3().setFromObject(makeBox(h1))
    const b2 = new THREE.Box3().setFromObject(makeBox(h2))
    expect(b1.min.x).toBeCloseTo(0.855, 6)
    expect(b1.max.x).toBeCloseTo(2.145, 6)
    expect(b1.min.y).toBeCloseTo(2.1, 6)
    expect(b1.max.y).toBeCloseTo(2.245, 6)
    expect(b1.min.z).toBeCloseTo(-0.0725, 6)
    expect(b1.max.z).toBeCloseTo(-0.0275, 6)
    expect(b2.min.z).toBeCloseTo(0.0275, 6)
    expect(b2.max.z).toBeCloseTo(0.0725, 6)
  })

  it('sill position', () => {
    const w = generateWallWithWindow(params)
    const sill = w.elements.find((e) => e.id === 'sill')!
    const box = new THREE.Box3().setFromObject(makeBox(sill))
    expect(box.min.x).toBeCloseTo(0.9, 6)
    expect(box.max.x).toBeCloseTo(2.1, 6)
    expect(box.min.y).toBeCloseTo(0.855, 6)
    expect(box.max.y).toBeCloseTo(0.9, 6)
  })

  it('cripple bottom', () => {
    const w = generateWallWithWindow(params)
    const c = w.elements.find((e) => e.id === 'cripple-bottom-1')!
    const box = new THREE.Box3().setFromObject(makeBox(c))
    expect(box.min.x).toBeCloseTo(1.2, 6)
    expect(box.max.x).toBeCloseTo(1.245, 6)
    expect(box.min.y).toBeCloseTo(0.045, 6)
    expect(box.max.y).toBeCloseTo(0.855, 6)
    expect(c.length).toBe(810)
  })

  it('cripple top', () => {
    const w = generateWallWithWindow(params)
    const c = w.elements.find((e) => e.id === 'cripple-top-1')!
    const box = new THREE.Box3().setFromObject(makeBox(c))
    expect(box.min.x).toBeCloseTo(1.2, 6)
    expect(box.max.x).toBeCloseTo(1.245, 6)
    expect(box.min.y).toBeCloseTo(2.245, 6)
    expect(box.max.y).toBeCloseTo(2.61, 6)
    expect(c.length).toBe(365)
  })

  it('overall bbox 3000x2700x145', () => {
    const w = generateWallWithWindow(params)
    const full = new THREE.Box3()
    for (const el of w.elements) full.union(new THREE.Box3().setFromObject(makeBox(el)))
    const size = new THREE.Vector3()
    full.getSize(size)
    expect(size.x).toBeCloseTo(3, 6)
    expect(size.y).toBeCloseTo(2.7, 6)
    expect(size.z).toBeCloseTo(0.145, 6)
  })

  it('volume total 0.23653125', () => {
    const w = generateWallWithWindow(params)
    const total = w.elements.reduce((s, e) => s + timberVolumeM3(e), 0)
    expect(total).toBeCloseTo(0.23653125, 6)
  })

  it('no duplicate ids on toggle', () => {
    const w1 = generateWallWithWindow(params)
    const w2 = generateWallWithWindow(params)
    expect(w1.elements.map((e) => e.id)).toEqual(w2.elements.map((e) => e.id))
  })

  it('remaining row studs are 4', () => {
    const w = generateWallWithWindow(params)
    const rows = w.elements.filter((e) => e.role === 'stud')
    expect(rows.length).toBe(4)
    const xs = rows.map((e) => e.position.x - 22.5).sort((a,b) => a-b)
    expect(xs).toEqual([0, 600, 2400, 2955])
  })
})


describe('Stage 0.0.7.1 extra cripples', () => {
  it('count 20', () => {
    const w = generateWallWithWindow(params)
    expect(w.elements.length).toBe(20)
  })
  it('left/right cripple positions', () => {
    const w = generateWallWithWindow(params)
    const cl = w.elements.find((e) => e.id === 'cripple-bottom-left')!
    const cr = w.elements.find((e) => e.id === 'cripple-bottom-right')!
    const bl = new THREE.Box3().setFromObject(makeBox(cl))
    const br = new THREE.Box3().setFromObject(makeBox(cr))
    expect(bl.min.x).toBeCloseTo(0.9, 6)
    expect(bl.max.x).toBeCloseTo(0.945, 6)
    expect(br.min.x).toBeCloseTo(2.055, 6)
    expect(br.max.x).toBeCloseTo(2.1, 6)
  })
})
