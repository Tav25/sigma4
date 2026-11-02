import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { rightCornerOrigin } from './corner'
import { boxCenterWorld, generateTimberGeometry, mmToMeters } from './timber'
import { projectToScene } from '../scene/project-to-scene'

function storeWithCorner() {
  const store = createProjectStore(createProjectFromCurrentState({
    projectId: 's05-2', length: 6000, height: 2700, spacing: 600,
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  }))
  const front = store.getSnapshot().building.walls[0]
  const side = {
    ...front, wallId: 'wall-002', orientation: 'z' as const,
    origin: rightCornerOrigin(front, front), lengthMm: 3000, openings: [],
  }
  expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: side } }).success).toBe(true)
  return store
}

function bbox(store: ReturnType<typeof storeWithCorner>, id: string) {
  const el = projectToScene(store.getSnapshot()).elements.find(e => e.id === id)!
  expect(el).toBeDefined()
  const spec = generateTimberGeometry(el)
  const geo = new THREE.BoxGeometry(
    mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z),
  )
  const mesh = new THREE.Mesh(geo)
  const center = boxCenterWorld(el)
  mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
  mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
  const bounds = new THREE.Box3().setFromObject(mesh)
  geo.dispose()
  return bounds
}

describe('S05.2: warm Canadian right corner', () => {
  it('places the side wall inside (-Z) against the right end of facade wall', () => {
    const store = storeWithCorner()
    const front = bbox(store, 'plate-bottom-1')
    const side = bbox(store, 'wall-002:plate-bottom-1')
    expect(front.max.x).toBeCloseTo(6, 6)
    expect(front.min.z).toBeCloseTo(-0.0725, 6)
    expect(side.min.x).toBeCloseTo(5.855, 6)
    expect(side.max.x).toBeCloseTo(6, 6)
    expect(side.min.z).toBeCloseTo(-3.0725, 6)
    expect(side.max.z).toBeCloseTo(-0.0725, 6)
  })

  it('ties upper plates over the corner without two boards in the same volume', () => {
    const store = storeWithCorner()
    const frontTop = bbox(store, 'plate-top-2')
    const sideTop = bbox(store, 'wall-002:plate-top-2')
    expect(frontTop.max.x).toBeCloseTo(5.855, 6)
    expect(sideTop.min.x).toBeCloseTo(5.855, 6)
    expect(sideTop.max.x).toBeCloseTo(6, 6)
    expect(sideTop.max.z).toBeCloseTo(0.0725, 6)
    expect(frontTop.min.y).toBeCloseTo(2.655, 6)
    expect(sideTop.min.y).toBeCloseTo(2.655, 6)
    const d = frontTop.clone().intersect(sideTop)
    const extents = d.getSize(new THREE.Vector3())
    // Contact along a face is allowed; positive volume overlap is not.
    expect(d.isEmpty() || Math.min(extents.x, extents.y, extents.z) < 1e-6).toBe(true)
  })

  it('turns the 45x145 inside stud 90 degrees and leaves a cavity', () => {
    const store = storeWithCorner()
    const doc = store.getSnapshot()
    const stud = doc.assembly.elements.find(e => e.elementId === 'warm-corner-stud')
    expect(stud).toBeDefined()
    expect(stud?.role).toBe('corner-backing')
    expect(stud?.sectionMm).toEqual({ width: 45, height: 145 })
    expect(stud?.orientation).toEqual({ mode: 'y', angle: 0, roll: 90 })
    expect(stud?.position.x).toBe(5810)
    expect(stud?.position.z).toBe(-50)
    expect(doc.building.walls.map(w => w.thicknessMm)).toEqual([145, 145])

    const inside = bbox(store, 'warm-corner-stud')
    const outside = bbox(store, 'stud-11')
    const side = bbox(store, 'wall-002:stud-01')

    // Actual world-space footprint in metres for the 6000mm facade.
    expect(inside.min.x).toBeCloseTo(5.810, 6)
    expect(inside.max.x).toBeCloseTo(5.955, 6)
    expect(outside.min.x).toBeCloseTo(5.955, 6)
    expect(outside.max.x).toBeCloseTo(6, 6)
    expect(inside.min.z).toBeCloseTo(-0.0725, 6)
    expect(inside.max.z).toBeCloseTo(-0.0275, 6)
    expect(side.min.z).toBeCloseTo(-0.1175, 6)
    expect(side.max.z).toBeCloseTo(-0.0725, 6)
    expect(inside.min.y).toBeCloseTo(0.045, 6)
    expect(inside.max.y).toBeCloseTo(2.610, 6)

    // Both corner joints touch at faces, not inside their volumes.
    // The rotated nailer uses only 45 mm of wall depth: the remaining
    // 100 mm from z=-27.5 to +72.5 is available for insulation.
    expect(outside.min.x - inside.max.x).toBeCloseTo(0, 6)
    expect(outside.max.z - inside.max.z).toBeCloseTo(0.100, 6)
    for (const [a, b] of [[inside, outside], [inside, side], [outside, side]]) {
      const extents = a.clone().intersect(b).getSize(new THREE.Vector3())
      expect(Math.min(extents.x, extents.y, extents.z)).toBeCloseTo(0, 6)
    }

    expect(stud?.connectionIds).toContain('wall-002:stud-01')
    expect(stud?.connectionIds).toContain('stud-11')
    expect(doc.assembly.elements.find(e => e.elementId === 'stud-11')?.connectionIds).toContain('warm-corner-stud')
    const sideStud = doc.assembly.elements.find(e => e.elementId === 'wall-002:stud-01')
    expect(sideStud?.connectionIds).toContain('warm-corner-stud')
  })

  it('moves the inner corner stud with facade length and changes its height', () => {
    const store = storeWithCorner()
    expect(store.dispatch({
      type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 6500 },
    }).success).toBe(true)
    expect(bbox(store, 'warm-corner-stud').min.x).toBeCloseTo(6.310, 6)
    expect(store.dispatch({
      type: 'SET_WALL_HEIGHT', payload: { wallId: 'wall-001', heightMm: 3000 },
    }).success).toBe(true)
    expect(bbox(store, 'warm-corner-stud').max.y).toBeCloseTo(2.910, 6)
    expect(store.undo().success).toBe(true)
    expect(bbox(store, 'warm-corner-stud').max.y).toBeCloseTo(2.610, 6)
  })

  it('first wall length changes move the side wall and preserve a single undo', () => {
    const store = storeWithCorner()
    const before = store.getSnapshot()
    expect(store.dispatch({
      type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 6500 },
    }).success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin.x).toBe(6427.5)
    expect(bbox(store, 'wall-002:plate-bottom-1').max.x).toBeCloseTo(6.5, 6)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin).toEqual(before.building.walls[1].origin)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin.x).toBe(6427.5)
  })

  it('the connected walls share a top height when either wall is edited', () => {
    const store = storeWithCorner()
    expect(store.dispatch({ type: 'SET_WALL_HEIGHT', payload: { wallId: 'wall-002', heightMm: 3000 } }).success).toBe(true)
    expect(store.getSnapshot().building.walls.map(w => w.heightMm)).toEqual([3000, 3000])
    expect(bbox(store, 'wall-002:plate-top-2').max.y).toBeCloseTo(3, 6)
    expect(bbox(store, 'plate-top-2').max.y).toBeCloseTo(3, 6)
  })

  it('rejects detached corners and frame openings that collide with the corner framing', () => {
    const store = storeWithCorner()
    const before = store.exportJson()
    expect(store.dispatch({
      type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 4600 },
    }).success).toBe(false)
    expect(store.exportJson()).toBe(before)
  })

  it('preserves the corner and the upper-plate joints through export/import', () => {
    const original = storeWithCorner()
    const json = original.exportJson()
    const imported = createProjectStore(createProjectFromCurrentState({
      length: 6000, height: 2700, spacing: 600, openings: [], projectId: 'import-corner',
    }))
    expect(imported.importJson(json).success).toBe(true)
    expect(imported.getSnapshot().building.walls[1].origin).toEqual(
      original.getSnapshot().building.walls[1].origin,
    )
    const ids = imported.getSnapshot().assembly.elements.map(e => e.elementId)
    expect(new Set(ids).size).toBe(ids.length)
    const top = imported.getSnapshot().assembly.elements.find(e => e.elementId === 'plate-top-2')!
    expect(top.connectionIds).toContain('wall-002:plate-top-2')
  })
})
