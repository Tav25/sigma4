import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProjectFromCurrentState } from '../core/project-store'
import { createProjectStore } from '../core/ProjectStore'
import { boxCenterWorld, generateTimberGeometry, mmToMeters, type TimberElement } from '../core/timber'
import { projectToScene } from './project-to-scene'

function worldBounds(el: TimberElement): THREE.Box3 {
  const g = generateTimberGeometry(el)
  const geometry = new THREE.BoxGeometry(mmToMeters(g.size.x), mmToMeters(g.size.y), mmToMeters(g.size.z))
  const mesh = new THREE.Mesh(geometry)
  const center = boxCenterWorld(el)
  mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
  mesh.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w)
  const box = new THREE.Box3().setFromObject(mesh)
  geometry.dispose()
  return box
}

function example(withDoor: boolean) {
  return createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600,
    projectId: 's03-geometry', projectName: 'Геометрия',
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 4380, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      ...(withDoor ? [{ id: 'D01', type: 'door' as const, positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 }] : []),
    ],
  })
}

describe('S03: physical boards from canonical JSON', () => {
  it('projects each assembly element once, with exact dimensions and position', () => {
    const doc = example(true)
    expect(doc.validation.valid).toBe(true)
    const scene = projectToScene(doc)
    expect(scene.elements.length).toBe(doc.assembly.elements.length)
    expect(new Set(scene.elements.map(e => e.id)).size).toBe(scene.elements.length)
    expect(scene.openings.find(o => o.id === 'D01')).toEqual({
      id: 'D01', type: 'door', positionXmm: 2700,
      widthMm: 900, heightMm: 2100, sillHeightMm: 0,
    })
    for (const source of doc.assembly.elements) {
      const actual = scene.elements.find(e => e.id === source.elementId)
      expect(actual).toBeDefined()
      expect(actual?.position).toEqual(source.position)
      expect(actual?.length).toBe(source.lengthMm)
      expect(actual?.width).toBe(source.sectionMm.width)
      expect(actual?.height).toBe(source.sectionMm.height)
      expect(actual?.orientation).toEqual(source.orientation)
    }
  })

  it('measures bottom plate, two top plates and first stud in actual world XYZ', () => {
    const doc = createProjectFromCurrentState({
      length: 6000, height: 2700, spacing: 600, openings: [], projectId: 's03-empty',
    })
    const all = projectToScene(doc).elements
    const bottom = worldBounds(all.find(e => e.id === 'plate-bottom-1')!)
    expect(bottom.min.x).toBeCloseTo(0, 6)
    expect(bottom.max.x).toBeCloseTo(6, 6)
    expect(bottom.min.y).toBeCloseTo(0, 6)
    expect(bottom.max.y).toBeCloseTo(0.045, 6)
    expect(bottom.min.z).toBeCloseTo(-0.0725, 6)
    expect(bottom.max.z).toBeCloseTo(0.0725, 6)
    const top1 = worldBounds(all.find(e => e.id === 'plate-top-1')!)
    const top2 = worldBounds(all.find(e => e.id === 'plate-top-2')!)
    expect(top1.min.y).toBeCloseTo(2.61, 6)
    expect(top1.max.y).toBeCloseTo(2.655, 6)
    expect(top2.min.y).toBeCloseTo(2.655, 6)
    expect(top2.max.y).toBeCloseTo(2.7, 6)
    const stud = worldBounds(all.find(e => e.id === 'stud-01')!)
    expect(stud.min.x).toBeCloseTo(0, 6)
    expect(stud.max.x).toBeCloseTo(0.045, 6)
    expect(stud.min.y).toBeCloseTo(0.045, 6)
    expect(stud.max.y).toBeCloseTo(2.61, 6)
    expect(stud.min.z).toBeCloseTo(-0.0725, 6)
    expect(stud.max.z).toBeCloseTo(0.0725, 6)
  })

  it('door physically splits the bottom plate and has a correctly located header', () => {
    const all = projectToScene(example(true)).elements
    const left = worldBounds(all.find(e => e.id === 'plate-bottom-left')!)
    const right = worldBounds(all.find(e => e.id === 'plate-bottom-right')!)
    expect(left.min.x).toBeCloseTo(0, 6)
    expect(left.max.x).toBeCloseTo(2.7, 6)
    expect(right.min.x).toBeCloseTo(3.6, 6)
    expect(right.max.x).toBeCloseTo(6, 6)
    expect(all.some(e => e.id === 'plate-bottom-1')).toBe(false)
    const header = worldBounds(all.find(e => e.id === 'D01-header-1')!)
    expect(header.min.x).toBeCloseTo(2.655, 6)
    expect(header.max.x).toBeCloseTo(3.645, 6)
    expect(header.min.y).toBeCloseTo(2.1, 6)
    expect(header.max.y).toBeCloseTo(2.245, 6)
    for (const stud of all.filter(e => e.role === 'stud')) {
      const b = worldBounds(stud)
      const overlapX = Math.min(b.max.x, 3.6) - Math.max(b.min.x, 2.7)
      const overlapY = Math.min(b.max.y, 2.1) - Math.max(b.min.y, 0)
      expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false)
    }
  })

  it('moving a door in JSON updates real board geometry and undo restores it', () => {
    const store = createProjectStore(example(true))
    const moved = store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'D01', positionUmm: 3000 } })
    expect(moved.success).toBe(true)
    const current = projectToScene(store.getSnapshot())
    expect(current.openings.find(o => o.id === 'D01')?.positionXmm).toBe(3000)
    expect(worldBounds(current.elements.find(e => e.id === 'plate-bottom-left')!).max.x).toBeCloseTo(3, 6)
    expect(worldBounds(current.elements.find(e => e.id === 'plate-bottom-right')!).min.x).toBeCloseTo(3.9, 6)
    const exported = JSON.parse(store.exportJson())
    expect(exported.building.openings.find((o: { id: string }) => o.id === 'D01').positionUmm).toBe(3000)
    expect(store.undo().success).toBe(true)
    const restored = projectToScene(store.getSnapshot())
    expect(restored.openings.find(o => o.id === 'D01')?.positionXmm).toBe(2700)
    expect(worldBounds(restored.elements.find(e => e.id === 'plate-bottom-left')!).max.x).toBeCloseTo(2.7, 6)
  })

  it('visual projection cannot mutate the stored source document', () => {
    const doc = example(true)
    const rendered = projectToScene(doc)
    rendered.elements[0].position.x = 999999
    rendered.elements[0].orientation.roll = 11
    rendered.openings[0].positionXmm = -1
    expect(doc.assembly.elements[0].position.x).not.toBe(999999)
    expect(doc.assembly.elements[0].orientation.roll).not.toBe(11)
    expect(doc.building.openings[0].positionUmm).toBe(900)
  })
})
