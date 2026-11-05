import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from './project-store'
import { createProjectStore } from './ProjectStore'
import { firstWallExteriorLowerLeft } from './world-origin'
import { rightCornerOrigin } from './corner'
import { projectToScene } from '../scene/project-to-scene'
import { calculateWorldBounds } from '../scene/view-bounds'

const create = (length = 4000) => createProjectFromCurrentState({
  projectId: 'first-outside-corner-zero', length, height: 2700,
  spacing: 600, openings: [],
})

describe('First wall lower-left exterior corner at world zero', () => {
  it('starts new walls at the REAL timber outside corner, not at wall mid-thickness', () => {
    const project = create()
    const first = project.building.walls[0]
    expect(first.origin).toEqual({ x: 0, y: 0, z: -72.5 })
    expect(firstWallExteriorLowerLeft(first)).toEqual({ x: 0, y: 0, z: 0 })
    const physicalBounds = calculateWorldBounds(projectToScene(project).elements)
    expect(physicalBounds.min.x * 1000).toBeCloseTo(0, 6)
    expect(physicalBounds.min.y * 1000).toBeCloseTo(0, 6)
    expect(physicalBounds.max.z * 1000).toBeCloseTo(0, 6)
    expect(physicalBounds.min.z * 1000).toBeCloseTo(-145, 6)
    expect(physicalBounds.max.x * 1000).toBeCloseTo(4000, 6)
  })

  it('maintains physical California-corner alignment and valid joinery', () => {
    const doc = create(6000)
    const first = doc.building.walls[0]
    const side = { ...first, wallId: 'wall-002', orientation: 'z' as const,
      lengthMm: 3000, origin: rightCornerOrigin(first, first), openings: [] }
    doc.building.walls.push(side)
    const rebuilt = buildProjectSnapshot(doc)
    expect(rebuilt.validation.valid).toBe(true)
    expect(side.origin.z).toBe(-145)
    const bounds = calculateWorldBounds(projectToScene(rebuilt).elements)
    expect(bounds.min.x * 1000).toBeCloseTo(0, 6)
    expect(bounds.max.z * 1000).toBeCloseTo(0, 6)
    expect(bounds.max.x * 1000).toBeCloseTo(6000, 6)
  })

  it('does not silently move an old JSON file; one explicit command moves ALL walls and supports Undo/Redo', () => {
    const importedDoc = createProjectFromCurrentState({
      projectId: 'legacy-zero-on-midplane', length: 6000, height: 2700,
      spacing: 600, openings: [{
        id: 'W01', type: 'window', positionXmm: 900,
        widthMm: 1200, heightMm: 1200, sillHeightMm: 900,
      }],
    })
    const first = importedDoc.building.walls[0]
    first.origin = { x: 1500, y: 0, z: 0 }
    const side = { ...first, wallId: 'wall-002', orientation: 'z' as const,
      lengthMm: 3000, origin: rightCornerOrigin(first, first), openings: [] }
    const independent = { ...first, wallId: 'wall-003', origin: { x: 13000, y: 0, z: -8000 }, openings: [] }
    importedDoc.building.walls.push(side, independent)
    importedDoc.building.connections = [
      { type: 'california-right', fromWallId: first.wallId, toWallId: side.wallId },
    ]
    const original = buildProjectSnapshot(importedDoc)
    expect(original.validation.valid).toBe(true)
    const store = createProjectStore(create())
    expect(store.importJson(JSON.stringify(original)).success).toBe(true)
    const before = store.exportJson()
    expect(firstWallExteriorLowerLeft(store.getSnapshot().building.walls[0])).toEqual({
      x: 1500, y: 0, z: 72.5,
    })
    expect(store.getSnapshot().building.walls[2].origin).toEqual({ x: 13000, y: 0, z: -8000 })
    const result = store.dispatch({ type: 'ANCHOR_FIRST_WALL_AT_ZERO', payload: {} })
    expect(result.success).toBe(true)
    expect(result.changedIds).toContain('building.walls[wall-002].origin')
    const after = store.getSnapshot()
    expect(firstWallExteriorLowerLeft(after.building.walls[0])).toEqual({ x: 0, y: 0, z: 0 })
    expect(after.building.walls[0].origin).toEqual({ x: 0, y: 0, z: -72.5 })
    expect(after.building.walls[1].origin).toEqual({
      x: side.origin.x - 1500, y: 0, z: side.origin.z - 72.5,
    })
    expect(after.building.walls[2].origin).toEqual({ x: 11500, y: 0, z: -8072.5 })
    expect(after.building.openings[0].positionUmm).toBe(900)
    expect(after.validation.valid).toBe(true)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
    expect(store.redo().success).toBe(true)
    expect(firstWallExteriorLowerLeft(store.getSnapshot().building.walls[0])).toEqual({ x: 0, y: 0, z: 0 })
    const copy = createProjectStore(create())
    expect(copy.importJson(store.exportJson()).success).toBe(true)
    expect(copy.exportJson()).toBe(store.exportJson())
  })

  it('rejects an unsupported wall direction without modifying the project', () => {
    const store = createProjectStore(create())
    const doc = store.getSnapshot()
    expect(firstWallExteriorLowerLeft(doc.building.walls[0])).toEqual({ x: 0, y: 0, z: 0 })
    const unsupported = { ...doc.building.walls[0], orientation: 'z' as const }
    expect(() => firstWallExteriorLowerLeft(unsupported)).toThrow()
    expect(store.exportJson()).toContain('"wall-001"')
  })
})
