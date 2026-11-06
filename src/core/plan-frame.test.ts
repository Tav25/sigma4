import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import type { Opening } from './project'
import { projectToScene } from '../scene/project-to-scene'
import { buildDimensionLayout } from '../scene/dimension-model'
import { planWallClearances } from './floor-plan'
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
      expect(doc.building.walls.map(wall => wall.lengthMm)).toEqual([width, 6710, width, 6710])
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

  it('uses the Z pair as through walls when the depth is greater', () => {
    const store = garage()
    expect(store.dispatch({ type: 'PLAN_FRAME_RESIZE', payload: { widthMm: 7000, depthMm: 10000 } }).success).toBe(true)
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.building.walls.map(wall => wall.lengthMm)).toEqual([6710, 10000, 6710, 10000])
    const bounds = calculateWorldBounds(projectToScene(doc).elements)
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(7, 6)
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(10, 6)
  })

  it('frames the garage closet, preserves its door on a 300 mm move, and rebuilds JSON', () => {
    const store = garage()
    const point = (xMm: number, zMm: number) => ({ xMm, zMm })
    for (const [start, end] of [
      [point(0, -3000), point(4000, -3000)], [point(4000, -3000), point(4000, 0)],
    ]) {
      expect(store.dispatch({ type: 'PLAN_GRAPH_ADD_EDGE', payload: { start, end, thicknessMm: 100 } }).success).toBe(true)
    }
    expect(store.dispatch({ type: 'PLAN_FRAME_ENABLE_PARTITIONS', payload: {} }).success).toBe(true)
    const door: Opening = { ...openings[1], wallId: 'partition-I001', positionUmm: 1200 }
    const lowDoor = store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: { ...door, heightMm: 1900 } } })
    expect(lowDoor.success).toBe(false)
    expect(lowDoor.messageRu).toContain('IRC')
    expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: door } }).success).toBe(true)
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const initial = store.getSnapshot()
    expect(initial.building.walls.slice(4).map(wall => wall.lengthMm)).toEqual([3905, 2805])
    expect(planWallClearances(initial.building.floorPlan!, 'I002')?.negative?.distanceMm).toBe(3805)
    const initialElements = projectToScene(initial).elements
    const doorHead = calculateWorldBounds(initialElements.filter(element => element.id === 'partition-I001:D01-header'))
    expect(doorHead.max.z - doorHead.min.z).toBeCloseTo(0.1, 6)
    expect(doorHead.max.y - doorHead.min.y).toBeCloseTo(0.045, 6)
    expect(doorHead.min.y).toBeCloseTo(2.1, 6)
    const pieces = initialElements.map(element => ({ element, box: calculateWorldBounds([element]) }))
    const partitions = pieces.filter(({ element }) => element.wallId?.startsWith('partition-'))
    for (const part of partitions) {
      const collisions = pieces.filter(other => other !== part && (['x', 'y', 'z'] as const).every(axis =>
        Math.min(part.box.max[axis], other.box.max[axis]) - Math.max(part.box.min[axis], other.box.min[axis]) > 1e-6))
      expect(collisions.map(item => item.element.id)).toEqual([])
    }
    expect(initial.assembly.elements.filter(e => e.elementId.includes(':partition-backing-'))).toHaveLength(6)
    const move = store.dispatch({ type: 'PLAN_SET_INTERIOR_CLEARANCE',
      payload: { id: 'I002', side: 'negative', distanceMm: 4105 } })
    expect(move.success).toBe(true)
    const moved = store.getSnapshot()
    expect(moved.building.walls[4].lengthMm).toBe(4205)
    expect(planWallClearances(moved.building.floorPlan!, 'I002')?.negative?.distanceMm).toBe(4105)
    expect(moved.building.floorPlan?.frame?.openings).toEqual([door])
    const scene = projectToScene(moved)
    const projection = scene.sceneOpenings.find(o => o.id === door.id)!
    expect(openingLocalToWorld(projection, projection.positionXmm, 0)).toEqual({ x: 1200, y: 0, z: -3000 })
    const dimensions = buildDimensionLayout(moved.building.walls, scene.elements)
    expect(dimensions.overallXmm).toBeCloseTo(10000, 3)
    expect(dimensions.overallZmm).toBeCloseTo(7000, 3)
    const json = store.exportJson()
    expect(store.dispatch({ type: 'PLAN_GRAPH_DELETE_EDGE', payload: { id: 'I001' } }).success).toBe(false)
    expect(store.exportJson()).toBe(json)
    expect(store.importJson(json).success).toBe(true)
    expect(store.exportJson()).toBe(json)
  })

  it('moves a hosted opening atomically, rejects conflicts and preserves its exact 3D position', () => {
    const store = garage()
    const window = openings[0]
    const door: Opening = { ...openings[1], wallId: 'plan-front', positionUmm: 2600,
      swing: { hinge: 'end', side: 'right' } }
    for (const opening of [window, door]) {
      expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening } }).success).toBe(true)
    }
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const before = store.exportJson()
    const revision = store.getRevision()
    const move = (positionUmm: number) => store.dispatch({
      type: 'PLAN_FRAME_MOVE_OPENING', payload: { openingId: door.id, positionUmm },
    })
    expect(move(1800).success).toBe(false)
    expect(move(150).success).toBe(false)
    expect(store.getRevision()).toBe(revision)
    expect(store.exportJson()).toBe(before)
    expect(move(2900).success).toBe(true)
    expect(store.getRevision()).toBe(revision + 1)
    const doc = store.getSnapshot()
    expect(doc.building.floorPlan?.frame?.openings).toEqual([window, { ...door, positionUmm: 2900 }])
    const projected = projectToScene(doc).sceneOpenings.find(item => item.id === door.id)!
    expect(openingLocalToWorld(projected, projected.positionXmm, 0, 72.5)).toEqual({ x: 2900, y: 0, z: 0 })
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
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

  it.each([true, false])('fits four corners without colliding boards (through walls on X: %s)', throughAlongX => {
    const store = garage()
    if (!throughAlongX) {
      expect(store.dispatch({ type: 'PLAN_FRAME_RESIZE', payload: { widthMm: 7000, depthMm: 10000 } }).success).toBe(true)
    }
    for (const opening of openings) {
      expect(store.dispatch({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening } }).success).toBe(true)
    }
    expect(store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} }).success).toBe(true)
    const { elements } = projectToScene(store.getSnapshot())
    const boards = elements.map(element => ({ element, box: calculateWorldBounds([element]) }))
    const corners = throughAlongX ? [
      ['plan-front', 'plan-right', false], ['plan-back', 'plan-right', true],
      ['plan-back', 'plan-left', false], ['plan-front', 'plan-left', true],
    ] as const : [
      ['plan-right', 'plan-back', false], ['plan-left', 'plan-back', true],
      ['plan-left', 'plan-front', false], ['plan-right', 'plan-front', true],
    ] as const
    const throughAxis = throughAlongX ? 'x' : 'z'
    corners.forEach(([wallId, nextWallId, atStart]) => {
      const backingId = wallId + ':warm-corner-stud' + (atStart ? '-start' : '')
      const backing = boards.find(board => board.element.id === backingId)!
      const studs = elements.filter(element => element.wallId === nextWallId && element.role === 'stud')
        .sort((a, b) => a.position.x - b.position.x)
      const endStud = studs[atStart ? studs.length - 1 : 0]
      const nextStud = boards.find(board => board.element === endStud)!
      const contact = backing.box.clone().intersect(nextStud.box.clone().expandByScalar(1e-6))
      expect(contact.isEmpty()).toBe(false)
      expect(contact.max[throughAxis] - contact.min[throughAxis]).toBeCloseTo(0.1, 5)
      expect(contact.max.y - contact.min.y).toBeCloseTo(2.565, 5)
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
    // Version 0.1.13 shortened every panel by one depth and started it
    // one depth after the outside corner. The authored opening stays put.
    stale.building.walls.forEach((wall, index) => {
      wall.lengthMm = index % 2 === 0 ? 9855 : 6855
    })
    stale.building.walls[0].origin.x = 145
    stale.building.walls[2].origin.x = 9855
    stale.building.openings[0].positionUmm = 655
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
