import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { rightCornerOrigin } from './corner'
import { validateProject } from './frame-validator'
import { boxCenterWorld, generateTimberGeometry, mmToMeters } from './timber'
import { projectToScene } from '../scene/project-to-scene'

function createCornerStore() {
  const doc = createProjectFromCurrentState({
    projectId: 'user-json-4-california-corner',
    length: 6000, height: 2700, spacing: 600,
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  })
  const store = createProjectStore(doc)
  const front = store.getSnapshot().building.walls[0]
  expect(store.dispatch({ type: 'ADD_WALL', payload: {
    wall: { ...front, wallId: 'wall-002', orientation: 'z',
      origin: rightCornerOrigin(front, front), lengthMm: 3000, openings: [] },
  } }).success).toBe(true)
  return store
}

function actualBounds(store: ReturnType<typeof createCornerStore>, id: string) {
  const el = projectToScene(store.getSnapshot()).elements.find(e => e.id === id)!
  expect(el).toBeDefined()
  const spec = generateTimberGeometry(el)
  const geometry = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
  const mesh = new THREE.Mesh(geometry)
  const center = boxCenterWorld(el)
  mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
  mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
  const box = new THREE.Box3().setFromObject(mesh)
  geometry.dispose()
  return box
}

describe('S05.6 California insulated three-stud corner: true top section', () => {
  it('places third board flat: 145 mm along X and 45 mm across Z', () => {
    const store = createCornerStore()
    const element = store.getSnapshot().assembly.elements.find(e => e.elementId === 'warm-corner-stud')!
    expect(element.orientation).toEqual({ mode: 'y', angle: 0, roll: 90 })
    expect(element.sectionMm).toEqual({ width: 45, height: 145 })
    const box = actualBounds(store, 'warm-corner-stud')
    expect(box.min.x).toBeCloseTo(5.810, 6)
    expect(box.max.x).toBeCloseTo(5.955, 6)
    expect(box.min.z).toBeCloseTo(-0.145, 6)
    expect(box.max.z).toBeCloseTo(-0.100, 6)
    expect(box.min.y).toBeCloseTo(0.045, 6)
    expect(box.max.y).toBeCloseTo(2.610, 6)
  })

  it('no intersection between three studs; room for insulation behind the flat nailer', () => {
    const store = createCornerStore()
    const inside = actualBounds(store, 'warm-corner-stud')
    const facade = actualBounds(store, 'stud-11')
    const side = actualBounds(store, 'wall-002:stud-01')
    expect(inside.max.x).toBeCloseTo(facade.min.x, 6)
    expect(inside.min.z).toBeCloseTo(side.max.z, 6)
    for (const [a,b] of [[inside,facade],[inside,side],[facade,side]]) {
      const bb = a.clone().intersect(b)
      const dimension = bb.getSize(new THREE.Vector3())
      expect(bb.isEmpty() || Math.min(dimension.x, dimension.y, dimension.z) < 0.000001).toBe(true)
    }
    // An arbitrary physical point in the 100mm-deep corner pocket is free.
    const pocket = new THREE.Vector3(5.890, 1.2, -0.0525)
    for (const b of [inside,facade,side]) expect(b.containsPoint(pocket)).toBe(false)
    expect(facade.max.z - inside.max.z).toBeCloseTo(0.1, 6)
  })

  it('rejects the old protruding nailer geometry instead of trusting saved valid:true', () => {
    const snapshot = createCornerStore().getSnapshot()
    const old = JSON.parse(JSON.stringify(snapshot))
    const nailer = old.assembly.elements.find((e: { elementId: string }) => e.elementId === 'warm-corner-stud')
    nailer.position.x = 5882.5
    expect(validateProject(old).issues.map(i => i.code)).toContain('ELEMENT_OUT_OF_WALL_BOUNDS')
    expect(validateProject(snapshot).valid).toBe(true)
  })

  it('rebuilds an old saved JSON containing a wrongly oriented nailer', () => {
    const source = createCornerStore()
    const old = JSON.parse(source.exportJson())
    const inner = old.assembly.elements.find((e: {elementId:string}) => e.elementId === 'warm-corner-stud')
    inner.position.x = 5932.5
    inner.position.z = -72.5
    inner.orientation.roll = 0
    const target = createProjectStore(createProjectFromCurrentState({
      length: 6000, height: 2700, spacing: 600, openings: [], projectId: 'import-test',
    }))
    expect(target.importJson(JSON.stringify(old)).success).toBe(true)
    const after = target.getSnapshot()
    expect(after.assembly.elements.find(e => e.elementId === 'warm-corner-stud')?.orientation.roll).toBe(90)
    expect(actualBounds(target, 'warm-corner-stud').min.x).toBeCloseTo(5.81, 6)
    expect(after.building.openings.map(o => [o.id,o.positionUmm])).toEqual([['W01',900],['W02',3300]])
  })

  it('moves correct rolled board with wall length and restores it with one Undo', () => {
    const store = createCornerStore()
    expect(store.dispatch({
      type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 6500 },
    }).success).toBe(true)
    expect(actualBounds(store, 'warm-corner-stud').min.x).toBeCloseTo(6.31, 6)
    expect(store.getSnapshot().building.walls[1].origin.x).toBe(6500)
    expect(store.undo().success).toBe(true)
    expect(actualBounds(store, 'warm-corner-stud').min.x).toBeCloseTo(5.81, 6)
    expect(store.getSnapshot().building.walls[1].origin.x).toBe(6000)
  })

  it('has no positive-volume board intersections across the complete 46-member assembly', () => {
    const store = createCornerStore()
    const ids = store.getSnapshot().assembly.elements.map(e => e.elementId)
    expect(ids).toHaveLength(46)
    expect(new Set(ids).size).toBe(ids.length)
    const boxes = ids.map(id => actualBounds(store, id))
    // Three.js world-space Box3, independent of the validation equations.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const intersection = boxes[i].clone().intersect(boxes[j])
        if (intersection.isEmpty()) continue
        const depth = intersection.getSize(new THREE.Vector3())
        const volumeIsPositive = depth.x > 0.00001 &&
          depth.y > 0.00001 && depth.z > 0.00001 // 0.01 mm tolerance
        expect(volumeIsPositive, 'Boards overlap: ' + ids[i] + ' / ' + ids[j]).toBe(false)
      }
    }
  })

  it('rejects a 10mm corner intersection, a 10mm gap and a wrongly rotated board', () => {
    const source = createCornerStore().getSnapshot()
    for (const corrupt of [
      (e: { position: { x: number; z: number }; orientation: { roll: number } }) => { e.position.x += 10 },
      (e: { position: { x: number; z: number }; orientation: { roll: number } }) => { e.position.x -= 10 },
      (e: { position: { x: number; z: number }; orientation: { roll: number } }) => { e.position.z += 10 },
      (e: { position: { x: number; z: number }; orientation: { roll: number } }) => { e.orientation.roll = 0 },
    ]) {
      const mutated = JSON.parse(JSON.stringify(source))
      const board = mutated.assembly.elements.find((e: { elementId: string }) => e.elementId === 'warm-corner-stud')
      corrupt(board)
      mutated.validation.valid = true
      const result = validateProject(mutated)
      expect(result.valid).toBe(false)
      expect(result.issues.map(issue => issue.code)).toContain('CALIFORNIA_CORNER_INVALID_CONTACT')
    }
    expect(validateProject(source).valid).toBe(true)
  })

  it('repairs stale generated geometry on JSON import, preserving authored wall and windows', () => {
    const original = createCornerStore()
    const before = original.getSnapshot()
    const stale = JSON.parse(original.exportJson())
    stale.validation.valid = true
    const staleBacking = stale.assembly.elements.find((e: { elementId: string }) => e.elementId === 'warm-corner-stud')
    staleBacking.position.x += 10
    expect(validateProject(stale).valid).toBe(false)

    const imported = createProjectStore(createProjectFromCurrentState({
      projectId: 'roundtrip-destination',
      length: 6000, height: 2700, spacing: 600, openings: [],
    }))
    expect(imported.importJson(JSON.stringify(stale)).success).toBe(true)
    const result = imported.getSnapshot()
    expect(result.building).toEqual(before.building)
    expect(result.assembly).toEqual(before.assembly)
    expect(result.validation.valid).toBe(true)
    expect(imported.exportJson()).toBe(original.exportJson())
  })

  it('retains corner contacts during undo/redo of a facade-length edit', () => {
    const store = createCornerStore()
    const baseline = store.exportJson()
    expect(store.dispatch({ type: 'SET_WALL_LENGTH', payload: {
      wallId: 'wall-001', lengthMm: 6500,
    } }).success).toBe(true)
    const changed = store.exportJson()
    expect(validateProject(store.getSnapshot()).valid).toBe(true)
    expect(actualBounds(store, 'warm-corner-stud').max.x).toBeCloseTo(6.455, 6)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(baseline)
    expect(store.redo().success).toBe(true)
    expect(store.exportJson()).toBe(changed)
    expect(validateProject(store.getSnapshot()).valid).toBe(true)
  })
})
