import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { boxCenterWorld, generateTimberGeometry, mmToMeters } from './timber'
import { projectToScene } from '../scene/project-to-scene'

function makeStore() {
  return createProjectStore(createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600, projectId: 'two-walls',
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  }))
}

function wallTwo() {
  return {
    wallId: 'wall-002', lengthMm: 3000, heightMm: 2700, thicknessMm: 145, studSpacingMm: 600,
    sectionMm: { width: 45, height: 145 }, orientation: 'z' as const,
    origin: { x: 6000, y: 0, z: -145 }, openings: [],
  }
}

function boxAt(id: string, store: ReturnType<typeof makeStore>) {
  const element = projectToScene(store.getSnapshot()).elements.find(e => e.id === id)!
  expect(element).toBeDefined()
  const g = generateTimberGeometry(element)
  const geo = new THREE.BoxGeometry(mmToMeters(g.size.x), mmToMeters(g.size.y), mmToMeters(g.size.z))
  const mesh = new THREE.Mesh(geo)
  const c = boxCenterWorld(element)
  mesh.position.set(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
  mesh.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w)
  const box = new THREE.Box3().setFromObject(mesh)
  geo.dispose()
  return box
}

describe('S05.1: a perpendicular second wall', () => {
  it('adds a wall with globally unique board IDs without changing the first wall', () => {
    const store = makeStore()
    const before = store.getSnapshot()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.building.walls).toHaveLength(2)
    expect(doc.building.walls[0]).toEqual(before.building.walls[0])
    expect(doc.building.openings).toEqual(before.building.openings)
    expect(doc.validation.valid).toBe(true)
    const ids = doc.assembly.elements.map(e => e.elementId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('plate-top-1')
    expect(ids).toContain('wall-002:plate-top-1')
  })

  it('positions the second wall at a right angle without a board overlap', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    const first = boxAt('plate-top-1', store)
    const second = boxAt('wall-002:plate-top-1', store)
    expect(first.min.x).toBeCloseTo(0, 5)
    expect(first.max.x).toBeCloseTo(6, 5)
    expect(second.min.x).toBeCloseTo(5.855, 5)
    expect(second.max.x).toBeCloseTo(6, 5)
    expect(second.min.z).toBeCloseTo(-3.145, 5)
    expect(second.max.z).toBeCloseTo(-0.145, 5)
    expect(first.max.y).toBeCloseTo(2.655, 5)
    expect(second.max.y).toBeCloseTo(2.655, 5)
  })

  it('undo and redo restore exactly one additional wall', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.walls).toHaveLength(1)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.walls).toHaveLength(2)
  })

  it('changes the second wall length without changing the first', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    expect(store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-002', lengthMm: 3500 } }).success).toBe(true)
    const walls = store.getSnapshot().building.walls
    expect(walls[0].lengthMm).toBe(6000)
    expect(walls[1].lengthMm).toBe(3500)
    expect(boxAt('wall-002:plate-bottom-1', store).min.z).toBeCloseTo(-3.645, 5)
  })

  it('removes the second wall and preserves all original openings', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    expect(store.dispatch({ type: 'REMOVE_WALL', payload: { wallId: 'wall-002' } }).success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.building.walls).toHaveLength(1)
    expect(doc.building.openings).toHaveLength(2)
    expect(doc.assembly.elements.every(e => e.wallId === 'wall-001')).toBe(true)
  })

  it('imports and exports the second wall via JSON', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    const copy = makeStore()
    expect(copy.importJson(store.exportJson()).success).toBe(true)
    expect(copy.getSnapshot().building.walls[1]).toEqual(wallTwo())
  })

  it('rejects a third wall at identical coordinates or deleting the first wall', () => {
    const store = makeStore()
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: wallTwo() } }).success).toBe(true)
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: { ...wallTwo(), wallId: 'wall-003' } } }).errorCode).toBe('WALL_FOOTPRINT_OVERLAP')
    expect(store.dispatch({ type: 'REMOVE_WALL', payload: { wallId: 'wall-001' } }).errorCode).toBe('WALL_NOT_REMOVABLE')
    expect(store.getSnapshot().building.walls).toHaveLength(2)
  })
})
