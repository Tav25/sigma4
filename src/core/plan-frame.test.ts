import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import type { Opening } from './project'
import { projectToScene } from '../scene/project-to-scene'
import { buildDimensionLayout } from '../scene/dimension-model'
import { defaultGarageDoorSpec } from './garage-door'
import { calculateWorldBounds } from '../scene/view-bounds'
import { openingLocalToWorld } from '../scene/opening-geometry'
import { validateProject } from './frame-validator'

function garage() {
  const store = createProjectStore(createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600, openings: [],
    projectId: 'garage', projectName: 'Гараж',
  }))
  for (const [xMm, zMm] of [[0, 0], [10000, 0], [10000, -7000], [0, -7000]]) {
    expect(store.dispatch({ type: 'PLAN_ADD_POINT', payload: { point: { xMm, zMm } } }).success).toBe(true)
  }
  expect(store.dispatch({ type: 'PLAN_CLOSE', payload: {} }).success).toBe(true)
  return store
}

const openings: Opening[] = [
  { id: 'W01', wallId: 'plan-front', type: 'window', positionUmm: 800, widthMm: 1200, heightMm: 1000, sillHeightMm: 900 },
  { id: 'D01', wallId: 'plan-left', type: 'door', positionUmm: 1800, widthMm: 900, heightMm: 2100, sillHeightMm: 0 },
  { id: 'G01', wallId: 'plan-back', type: 'garage-door', positionUmm: 2000, widthMm: 2438, heightMm: 2134, sillHeightMm: 0, garage: defaultGarageDoorSpec() },
]

describe('frame from a rectangular plan', () => {
  it('generates four walls and preserves the plan openings through resize and JSON import', () => {
    const store = garage()
    for (const opening of openings) {
      expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening } }).success).toBe(true)
    }
    expect(store.getSnapshot().building.walls).toHaveLength(1)
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const assertFrame = (width: number) => {
      const doc = store.getSnapshot()
      expect(doc.building.walls.map(wall => wall.wallId)).toEqual(['plan-front', 'plan-right', 'plan-back', 'plan-left'])
      expect(doc.validation.valid).toBe(true)
      const scene = projectToScene(doc)
      const dimensions = buildDimensionLayout(doc.building.walls, scene.elements)
      expect(dimensions.overallXmm).toBeCloseTo(width, 2)
      expect(dimensions.overallZmm).toBeCloseTo(7000, 2)
      expect(doc.building.floorPlan?.frame?.openings).toEqual(openings)
      expect(scene.sceneOpenings).toHaveLength(3)
      const starts = scene.sceneOpenings.map(opening =>
        openingLocalToWorld(opening, opening.positionXmm, opening.sillHeightMm, 72.5))
      expect(starts).toEqual([
        { x: 800, y: 900, z: 0 },
        { x: 0, y: 0, z: -5200 },
        { x: width - 2000, y: 0, z: -7000 },
      ])
    }
    assertFrame(10000)
    expect(store.dispatch({ type: 'PLAN_FRAME_RESIZE', payload: { widthMm: 11000, depthMm: 7000 } }).success).toBe(true)
    assertFrame(11000)
    expect(store.undo().success).toBe(true)
    assertFrame(10000)
    expect(store.redo().success).toBe(true)
    assertFrame(11000)
    const json = store.exportJson()
    expect(store.importJson(json).success).toBe(true)
    expect(store.exportJson()).toBe(json)
    assertFrame(11000)
  })

  it('rejects a resize that cuts through a saved opening and identifies it', () => {
    const store = garage()
    expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: openings[2] } }).success).toBe(true)
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const before = store.exportJson()
    const result = store.dispatch({ type: 'PLAN_FRAME_RESIZE', payload: { widthMm: 4000, depthMm: 7000 } })
    expect(result.success).toBe(false)
    expect(result.validation?.issues[0]?.affectedIds).toContain('G01')
    expect(store.exportJson()).toBe(before)
  })

  it('fits the rotated framing at all four corners without colliding boards', () => {
    const store = garage()
    for (const opening of openings) {
      expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening } }).success).toBe(true)
    }
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const { elements } = projectToScene(store.getSnapshot())
    const boards = elements.map(element => ({ element, box: calculateWorldBounds([element]) }))
    const corners = ['plan-front', 'plan-right', 'plan-back', 'plan-left']
    corners.forEach((wallId, index) => {
      const nextWallId = corners[(index + 1) % corners.length]
      const backing = boards.find(board => board.element.id === wallId + ':warm-corner-stud')!
      const nextStud = boards.find(board => board.element.id === nextWallId + ':stud-01')!
      const contact = backing.box.clone().intersect(nextStud.box.clone().expandByScalar(1e-6))
      expect(contact.isEmpty()).toBe(false)
      const upperPlate = boards.find(board => board.element.id === nextWallId + ':plate-top-2')!
      const lowerPlate = boards.find(board => board.element.id === wallId + ':plate-top-1')!
      const lap = lowerPlate.box.clone().intersect(upperPlate.box.clone().expandByScalar(1e-6))
      expect(lap.isEmpty()).toBe(false)
      expect(lap.max.x - lap.min.x).toBeCloseTo(0.145, 5)
      expect(lap.max.z - lap.min.z).toBeCloseTo(0.145, 5)
    })
    const overlaps = boards.flatMap(({ element, box }, index) =>
      boards.slice(index + 1).filter(other => {
        const intersection = box.clone().intersect(other.box)
        return !intersection.isEmpty() && (['x', 'y', 'z'] as const)
          .every(axis => intersection.max[axis] - intersection.min[axis] > 1e-6)
      }).map(other => [element.id, other.element.id]))
    expect(overlaps).toEqual([])
  })

  it('validates linked source data and rebuilds a stale derived JSON snapshot', () => {
    const store = garage()
    expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: openings[0] } }).success).toBe(true)
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const before = store.exportJson()
    const stale = store.getSnapshot()
    stale.building.walls[0].lengthMm = 600
    stale.building.openings[0].positionUmm = 9999
    stale.assembly.elements = []
    expect(validateProject(stale).issues.some(issue => issue.code === 'PLAN_FRAME_OUT_OF_SYNC')).toBe(true)
    expect(store.importJson(JSON.stringify(stale)).success).toBe(true)
    expect(store.exportJson()).toBe(before)

    const invalid = store.getSnapshot()
    invalid.building.floorPlan!.frame!.openings[0].wallId = 'missing-wall'
    expect(store.importJson(JSON.stringify(invalid)).success).toBe(false)
    expect(store.exportJson()).toBe(before)
    expect(store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'plan-front', lengthMm: 6000 } }).errorCode)
      .toBe('FRAME_CONTROLLED_BY_PLAN')
  })
})
