import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProjectFromCurrentState } from '../core/project-store'
import { createProjectStore } from '../core/ProjectStore'
import { rightCornerOrigin } from '../core/corner'
import { wallEnd } from '../core/wall-topology'
import { projectToScene } from './project-to-scene'
import { openingLocalToWorld, openingWorldToLocalU, openingYaw } from './opening-geometry'

const create = () => createProjectStore(createProjectFromCurrentState({
  projectId: 's06.3-openings', length: 6000, height: 2700, spacing: 600,
  openings: [
    { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
  ],
}))

function withSideWall() {
  const store = create()
  const front = store.getSnapshot().building.walls[0]
  const side = { ...front, wallId: 'wall-002', lengthMm: 6000,
    orientation: 'z' as const, origin: rightCornerOrigin(front, front), openings: [] }
  expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: side } }).success).toBe(true)
  return store
}

const sideWindow = {
  id: 'W03', type: 'window' as const, positionXmm: 900, widthMm: 1200,
  heightMm: 1200, sillHeightMm: 900,
}
const sideDoor = {
  id: 'D01', type: 'door' as const, positionXmm: 3300, widthMm: 900,
  heightMm: 2100, sillHeightMm: 0,
}

describe('S06.3: any wall owns its openings and physical framing', () => {
  it('generates a window and door in wall 2 without altering wall 1', () => {
    const store = withSideWall()
    const original = store.getSnapshot().assembly.elements.filter(e => e.wallId === 'wall-001')
    expect(store.dispatch({ type: 'ADD_OPENING', payload: {
      wallId: 'wall-002', opening: sideWindow,
    } }).success).toBe(true)
    expect(store.dispatch({ type: 'ADD_OPENING', payload: {
      wallId: 'wall-002', opening: sideDoor,
    } }).success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.validation.valid).toBe(true)
    expect(doc.building.walls[0].openings).toEqual(['W01', 'W02'])
    expect(doc.building.walls[1].openings).toEqual(['W03', 'D01'])
    expect(doc.building.openings.filter(o => o.wallId === 'wall-001').map(o => o.id))
      .toEqual(['W01', 'W02'])
    expect(doc.assembly.elements.filter(e => e.wallId === 'wall-001')).toEqual(original)
    const side = doc.assembly.elements.filter(e => e.wallId === 'wall-002')
    for (const fragment of ['W03-king-left', 'W03-header-1', 'D01-king-left', 'D01-header-1']) {
      expect(side.some(e => e.elementId.includes(fragment)), fragment).toBe(true)
    }
    const ids = doc.assembly.elements.map(e => e.elementId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(doc.building.openings.every(o => !('positionXmm' in o))).toBe(true)
  })

  it('projects both wall axes with physically correct outside markers and hit planes', () => {
    const store = withSideWall()
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideWindow } }).success).toBe(true)
    const doc = store.getSnapshot()
    const scene = projectToScene(doc)
    expect(scene.openings.find(o => o.id === 'W03')).toEqual(sideWindow)
    const w = scene.sceneOpenings.find(o => o.id === 'W03')!
    expect(w.wallId).toBe('wall-002')
    expect(w.wallOrientation).toBe('z')
    expect(w.wallOrigin).toEqual(doc.building.walls[1].origin)
    expect(openingLocalToWorld(w, 1500, 1500)).toEqual({
      x: 5927.5, y: 1500, z: -1572.5,
    })
    expect(scene.markers.find(m => m.openingId === 'W03')?.position).toEqual({
      x: 6050, y: 1500, z: -1572.5,
    })
    expect(openingYaw(w)).toBeCloseTo(Math.PI / 2)
    const center = openingLocalToWorld(w, 1500, 1500)
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2))
    plane.position.set(center.x / 1000, center.y / 1000, center.z / 1000)
    plane.rotation.y = openingYaw(w)
    plane.updateMatrixWorld()
    const ray = new THREE.Raycaster(
      new THREE.Vector3(center.x / 1000 + 2, center.y / 1000, center.z / 1000),
      new THREE.Vector3(-1, 0, 0),
    )
    const hit = ray.intersectObject(plane)
    expect(hit).toHaveLength(1)
    expect(openingWorldToLocalU(w, hit[0].point)).toBeCloseTo(1.5, 6)
    plane.geometry.dispose()
    const original = scene.sceneOpenings.find(o => o.id === 'W01')!
    expect(openingYaw(original)).toBe(0)
    expect(openingLocalToWorld(original, 1500, 1500)).toEqual({ x: 1500, y: 1500, z: 0 })
    expect(openingWorldToLocalU(original, { x: 1.5, z: 0 })).toBe(1.5)
  })

  it('moves a side opening along local -Z with marker, and restores via undo/redo', () => {
    const store = withSideWall()
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideWindow } }).success).toBe(true)
    const before = store.exportJson()
    const result = store.dispatch({ type: 'SET_OPENING_POSITION', payload: {
      openingId: 'W03', positionUmm: 1200,
    } })
    expect(result.success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W03')?.position.z)
      .toBe(-1872.5)
    expect(store.getSnapshot().building.openings.find(o => o.id === 'W01')?.positionUmm).toBe(900)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.openings.find(o => o.id === 'W03')?.positionUmm).toBe(1200)
  })

  it('follows the parent wall when a connected side wall changes its world position', () => {
    const store = withSideWall()
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideWindow } }).success).toBe(true)
    const original = projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W03')!.position
    expect(store.dispatch({ type: 'SET_WALL_ORIGIN', payload: {
      wallId: 'wall-001', origin: { x: 400, y: 0, z: 200 },
    } }).success).toBe(true)
    const changed = projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W03')!.position
    expect(changed.x).toBe(original.x + 400)
    expect(changed.z).toBe(original.z + 200)
    expect(changed.y).toBe(original.y)
  })

  it('rejects overlapping openings in the same wall and duplicate IDs globally', () => {
    const store = withSideWall()
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideWindow } }).success).toBe(true)
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideDoor } }).success).toBe(true)
    const before = store.exportJson()
    expect(store.dispatch({ type: 'SET_OPENING_POSITION', payload: {
      openingId: 'W03', positionUmm: 3000,
    } }).success).toBe(false)
    expect(store.dispatch({ type: 'ADD_OPENING', payload: {
      wallId: 'wall-001', opening: { ...sideDoor, id: 'W03' },
    } }).errorCode).toBe('DUPLICATE_OPENING_ID')
    expect(store.exportJson()).toBe(before)
  })

  it('restores all side opening details on JSON import and can remove them cleanly', () => {
    const store = withSideWall()
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideWindow } }).success).toBe(true)
    expect(store.dispatch({ type: 'ADD_OPENING', payload: { wallId: 'wall-002', opening: sideDoor } }).success).toBe(true)
    expect(store.dispatch({ type: 'SET_MARKER_SETTINGS', payload: {
      openingId: 'D01', anchor: 'right', outsideOffsetMm: 90, color: '#dd9900',
    } }).success).toBe(true)
    const copy = create()
    expect(copy.importJson(store.exportJson()).success).toBe(true)
    expect(copy.exportJson()).toBe(store.exportJson())
    expect(projectToScene(copy.getSnapshot()).markers.find(m => m.openingId === 'D01')?.position)
      .toEqual({ x: 6090, y: 1050, z: -4272.5 })
    expect(copy.dispatch({ type: 'REMOVE_OPENING', payload: { openingId: 'W03' } }).success).toBe(true)
    expect(projectToScene(copy.getSnapshot()).markers.some(m => m.openingId === 'W03')).toBe(false)
    expect(copy.getSnapshot().assembly.elements.some(e => e.elementId.includes('W03'))).toBe(false)
  })

  it('adds a door to the ninth wall without special-case framing code', () => {
    const store = withSideWall()
    for (let n = 3; n <= 9; n++) {
      const allWalls = store.getSnapshot().building.walls
      const parent = allWalls[allWalls.length - 1]
      const wall = { ...parent,
        wallId: 'wall-' + String(n).padStart(3, '0'),
        lengthMm: 3000, origin: wallEnd(parent), openings: [],
      }
      expect(store.dispatch({ type: 'ADD_WALL', payload: { wall,
        connection: { type: 'end-to-end', fromWallId: parent.wallId, toWallId: wall.wallId },
      } }).success).toBe(true)
    }
    expect(store.dispatch({ type: 'ADD_OPENING', payload: {
      wallId: 'wall-009', opening: { ...sideDoor, id: 'D09', positionXmm: 900 },
    } }).success).toBe(true)
    const projection = projectToScene(store.getSnapshot())
    expect(projection.sceneOpenings.find(o => o.id === 'D09')?.wallId).toBe('wall-009')
    expect(projection.markers.some(m => m.openingId === 'D09')).toBe(true)
    expect(store.getSnapshot().assembly.elements.some(e =>
      e.wallId === 'wall-009' && e.elementId.includes('D09'))).toBe(true)
    expect(store.getSnapshot().validation.valid).toBe(true)
  })
})
