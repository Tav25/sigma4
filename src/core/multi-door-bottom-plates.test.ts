import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { defaultGarageDoorSpec } from './garage-door'
import { rightCornerOrigin } from './corner'

function makeUserProject() {
  const store = createProjectStore(createProjectFromCurrentState({
    projectId: 'garage-and-door-repro', length: 6000, height: 2700,
    spacing: 600, openings: [
      { id: 'W01', type: 'window', positionXmm: 900,
        widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 3300,
        widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  }))
  const front = store.getSnapshot().building.walls[0]
  const side = {
    ...front, wallId: 'wall-002', lengthMm: 12000,
    orientation: 'z' as const, origin: rightCornerOrigin(front, front), openings: [],
  }
  expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: side } }).success).toBe(true)
  expect(store.dispatch({ type: 'ADD_OPENING', payload: {
    wallId: side.wallId,
    opening: {
      id: 'G01', type: 'garage-door', positionXmm: 2230,
      widthMm: 3500, heightMm: 2000, sillHeightMm: 0,
      garage: defaultGarageDoorSpec(),
    },
  } }).success).toBe(true)
  expect(store.dispatch({ type: 'ADD_OPENING', payload: {
    wallId: side.wallId,
    opening: {
      id: 'W03', type: 'window', positionXmm: 6435,
      widthMm: 450, heightMm: 1200, sillHeightMm: 900,
    },
  } }).success).toBe(true)
  return store
}

function plateSegments(store: ReturnType<typeof makeUserProject>) {
  return store.getSnapshot().assembly.elements
    .filter(element => element.wallId === 'wall-002' && element.role === 'bottom-plate')
    .map(element => ({
      id: element.elementId,
      x: element.position.x,
      length: element.lengthMm,
    }))
    .sort((a, b) => a.x - b.x)
}

describe('Regression: garage door followed by a pedestrian door', () => {
  it('reproduces user project (wall 002, 12000 mm, G01 and W03) and adds D01', () => {
    const store = makeUserProject()
    const before = store.getSnapshot()
    expect(before.building.walls[1].openings).toEqual(['G01', 'W03'])
    expect(plateSegments(store)).toEqual([
      { id: 'wall-002:plate-bottom-left', x: 0, length: 2230 },
      { id: 'wall-002:plate-bottom-right', x: 5730, length: 6270 },
    ])
    const result = store.dispatch({ type: 'ADD_OPENING', payload: {
      wallId: 'wall-002', opening: {
        id: 'D01', type: 'door', positionXmm: 135,
        widthMm: 900, heightMm: 2100, sillHeightMm: 0,
      },
    } })
    expect(result.success).toBe(true)
    expect(store.getSnapshot().validation.valid).toBe(true)
    expect(store.getSnapshot().building.walls[1].openings).toEqual(['G01', 'W03', 'D01'])
    expect(plateSegments(store)).toEqual([
      { id: 'wall-002:plate-bottom-left', x: 0, length: 135 },
      { id: 'wall-002:plate-bottom-mid-1', x: 1035, length: 1195 },
      { id: 'wall-002:plate-bottom-right', x: 5730, length: 6270 },
    ])
    const ids = store.getSnapshot().assembly.elements.map(el => el.elementId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(store.getSnapshot().assembly.elements.filter(el => el.elementId === 'wall-002:D01-header-1')).toHaveLength(1)
    const exported = store.exportJson()
    const copy = makeUserProject()
    expect(copy.importJson(exported).success).toBe(true)
    expect(copy.exportJson()).toBe(exported)
    expect(copy.undo().success).toBe(true)
    expect(copy.redo().success).toBe(true)
    expect(copy.getSnapshot().validation.valid).toBe(true)
  })

  it('handles three door cutouts and gives each internal plate a distinct stable ID', () => {
    const store = makeUserProject()
    for (const [id, x] of [['D01', 135], ['D02', 8000]] as const) {
      expect(store.dispatch({ type: 'ADD_OPENING', payload: {
        wallId: 'wall-002', opening: {
          id, type: 'door', positionXmm: x,
          widthMm: 900, heightMm: 2100, sillHeightMm: 0,
        },
      } }).success).toBe(true)
    }
    expect(plateSegments(store)).toEqual([
      { id: 'wall-002:plate-bottom-left', x: 0, length: 135 },
      { id: 'wall-002:plate-bottom-mid-1', x: 1035, length: 1195 },
      { id: 'wall-002:plate-bottom-mid-2', x: 5730, length: 2270 },
      { id: 'wall-002:plate-bottom-right', x: 8900, length: 3100 },
    ])
    expect(store.getSnapshot().validation.valid).toBe(true)
    expect(store.getSnapshot().validation.issues.some(i => i.code === 'DUPLICATE_ELEMENT_ID')).toBe(false)
  })

  it('keeps original plate IDs for a single garage and restores them after deleting the door', () => {
    const store = makeUserProject()
    expect(store.dispatch({ type:'ADD_OPENING', payload:{
      wallId:'wall-002', opening: {
        id:'D01', type:'door', positionXmm:135, widthMm:900,
        heightMm:2100, sillHeightMm:0,
      },
    } }).success).toBe(true)
    expect(store.dispatch({ type:'REMOVE_OPENING', payload:{ openingId:'D01' } }).success).toBe(true)
    expect(plateSegments(store)).toEqual([
      { id:'wall-002:plate-bottom-left', x:0, length:2230 },
      { id:'wall-002:plate-bottom-right', x:5730, length:6270 },
    ])
  })
})
