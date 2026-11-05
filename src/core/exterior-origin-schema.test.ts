import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from './project-store'
import { createProjectStore } from './ProjectStore'
import { rightCornerOrigin } from './corner'
import { firstWallExteriorLowerLeft, wallMidplaneOrigin } from './world-origin'
import { projectToScene } from '../scene/project-to-scene'
import { calculateWorldBounds } from '../scene/view-bounds'
import { openingLocalToWorld } from '../scene/opening-geometry'
import type { ProjectDocument } from './project'

function model() {
  const doc = createProjectFromCurrentState({
    projectId: 'origin-schema-regression', length: 6000, height: 2700,
    spacing: 600, openings: [{ id: 'W01', type: 'window', positionXmm: 900,
      widthMm: 1200, heightMm: 1200, sillHeightMm: 900 }],
  })
  const front = doc.building.walls[0]
  doc.building.walls.push({
    ...front, wallId: 'wall-002', orientation: 'z',
    lengthMm: 3000, origin: rightCornerOrigin(front, front), openings: [],
  })
  return buildProjectSnapshot(doc)
}

function footprint(doc: ProjectDocument) {
  const box = calculateWorldBounds(projectToScene(doc).elements)
  return [box.min.x, box.max.x, box.min.z, box.max.z].map(x => x * 1000)
}

describe('S06.5.7 author coordinate is the actual outside corner', () => {
  it('keeps source 0 0 0 while physical front timber and California joint are exact', () => {
    const doc = model()
    expect(doc.project.schemaVersion).toBe('1.1.0')
    expect(doc.building.walls[0].origin).toEqual({ x: 0, y: 0, z: 0 })
    expect(firstWallExteriorLowerLeft(doc.building.walls[0])).toEqual({ x: 0, y: 0, z: 0 })
    expect(wallMidplaneOrigin(doc.building.walls[0])).toEqual({ x: 0, y: 0, z: -72.5 })
    expect(doc.building.walls[1].origin).toEqual({ x: 6000, y: 0, z: -145 })
    expect(wallMidplaneOrigin(doc.building.walls[1])).toEqual({ x: 5927.5, y: 0, z: -145 })
    const [minX, maxX, minZ, maxZ] = footprint(doc)
    expect(minX).toBeCloseTo(0, 6)
    expect(maxX).toBeCloseTo(6000, 6)
    expect(minZ).toBeCloseTo(-3145, 6)
    expect(maxZ).toBeCloseTo(0, 6)
    expect(doc.validation.valid).toBe(true)
    const scene = projectToScene(doc)
    expect(scene.markers[0].position.z).toBe(50)
    expect(openingLocalToWorld(scene.sceneOpenings[0], 1500, 1500))
      .toEqual({ x: 1500, y: 1500, z: -72.5 })
  })

  it('converts 1.0.0 midplane coordinates with NO change to physical timber', () => {
    const modern = model()
    const legacy = JSON.parse(JSON.stringify(modern)) as ProjectDocument
    legacy.project.schemaVersion = '1.0.0'
    for (const wall of legacy.building.walls) {
      if (wall.orientation === 'x') wall.origin.z -= wall.sectionMm.height / 2
      if (wall.orientation === 'z') wall.origin.x -= wall.sectionMm.height / 2
    }
    const store = createProjectStore(model())
    expect(store.importJson(JSON.stringify(legacy)).success).toBe(true)
    const migrated = store.getSnapshot()
    expect(migrated.project.schemaVersion).toBe('1.1.0')
    expect(migrated.building.walls).toEqual(modern.building.walls)
    expect(footprint(migrated)).toEqual(footprint(modern))
    expect(projectToScene(migrated).markers).toEqual(projectToScene(modern).markers)
    const json = store.exportJson()
    const nextStore = createProjectStore(model())
    expect(nextStore.importJson(json).success).toBe(true)
    expect(nextStore.exportJson()).toBe(json)
  })

  it('keeps early 1.0.0 projects at their true physical position until user chooses anchor 0', () => {
    const old = model()
    old.project.schemaVersion = '1.0.0'
    old.building.walls[0].origin = { x: 0, y: 0, z: 0 }
    old.building.walls[1].origin = { x: 5927.5, y: 0, z: -72.5 }
    const store = createProjectStore(model())
    expect(store.importJson(JSON.stringify(old)).success).toBe(true)
    expect(store.getSnapshot().building.walls[0].origin.z).toBe(72.5)
    expect(footprint(store.getSnapshot())[3]).toBeCloseTo(72.5, 6)
    const before = store.exportJson()
    expect(store.dispatch({ type: 'ANCHOR_FIRST_WALL_AT_ZERO', payload: {} }).success).toBe(true)
    expect(store.getSnapshot().building.walls[0].origin).toEqual({ x: 0, y: 0, z: 0 })
    expect(store.getSnapshot().building.walls[1].origin).toEqual({ x: 6000, y: 0, z: -145 })
    expect(footprint(store.getSnapshot())[3]).toBeCloseTo(0, 6)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
    expect(store.redo().success).toBe(true)
  })
})
