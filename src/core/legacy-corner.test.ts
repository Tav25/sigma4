import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from './project-store'
import { createProjectStore } from './ProjectStore'
import { rightCornerOrigin } from './corner'

function original() {
  return createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600, projectId: 'corner-geometry',
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  })
}

describe('S05.3: two-stud 45x145 corner and legacy JSON compatibility', () => {
  it('creates new projects with the real 145 mm wall depth', () => {
    expect(original().building.walls[0].thicknessMm).toBe(145)
  })

  it('upgrades a legacy 45 mm wall thickness field without changing board sizes', () => {
    const old = original()
    old.building.walls[0].thicknessMm = 45
    const oldAssembly = JSON.stringify(old.assembly.elements)
    const rebuilt = buildProjectSnapshot(old)
    expect(rebuilt.validation.valid).toBe(true)
    expect(rebuilt.building.walls[0].thicknessMm).toBe(145)
    expect(old.building.walls[0].thicknessMm).toBe(45)
    expect(JSON.stringify(rebuilt.assembly.elements)).toBe(oldAssembly)
  })

  it('imports legacy two-wall JSON and replaces the old 20mm strip with a 45x145 stud', () => {
    const source = createProjectStore(original())
    const front = source.getSnapshot().building.walls[0]
    const wall = {
      ...front, wallId: 'wall-002', orientation: 'z' as const,
      origin: rightCornerOrigin(front, front), lengthMm: 3000, openings: [],
    }
    expect(source.dispatch({ type: 'ADD_WALL', payload: { wall } }).success).toBe(true)
    const exported = JSON.parse(source.exportJson())
    exported.building.walls.forEach((w: { thicknessMm: number }) => { w.thicknessMm = 45 })
    // An old export may contain the unused 20 mm strip in generated assembly.
    exported.assembly.elements.push({
      elementId: 'warm-corner-cleat', wallId: 'wall-001', role: 'corner-backing',
      sectionMm: { width: 20, height: 145 }, lengthMm: 2565,
      orientation: { mode: 'y', angle: 0, roll: 0 },
      position: { x: 5865, y: 45, z: -72.5 },
      connectionIds: [], generated: true,
    })
    const destination = createProjectStore(original())
    const imported = destination.importJson(JSON.stringify(exported))
    expect(imported.success).toBe(true)
    const updated = destination.getSnapshot()
    expect(updated.building.walls.map(w => w.thicknessMm)).toEqual([145, 145])
    expect(updated.assembly.elements.some(e => e.elementId === 'warm-corner-cleat')).toBe(false)
    expect(updated.assembly.elements.some(e => e.sectionMm.width === 20)).toBe(false)
    const inside = updated.assembly.elements.find(e => e.elementId === 'warm-corner-stud')
    expect(inside?.sectionMm).toEqual({ width: 45, height: 145 })
    expect(inside?.position.x).toBe(5877.5)
    expect(updated.assembly.elements.find(e => e.elementId === 'stud-11')?.sectionMm).toEqual({
      width: 45, height: 145,
    })
    expect(destination.undo().success).toBe(true)
    expect(destination.getSnapshot().building.walls).toHaveLength(1)
    expect(destination.redo().success).toBe(true)
    expect(destination.getSnapshot().building.walls).toHaveLength(2)
  })

  it('keeps the corner joined when facade length changes and returns on undo', () => {
    const store = createProjectStore(original())
    const front = store.getSnapshot().building.walls[0]
    expect(store.dispatch({
      type: 'ADD_WALL', payload: { wall: { ...front, wallId: 'wall-002', lengthMm: 3000,
        origin: rightCornerOrigin(front, front), orientation: 'z', openings: [] } },
    }).success).toBe(true)
    expect(store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 6500 } }).success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin.x).toBeCloseTo(6427.5)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin.x).toBeCloseTo(5927.5)
    expect(store.getSnapshot().assembly.elements.find(e => e.elementId === 'warm-corner-stud')?.position.x).toBe(5877.5)
  })
})
