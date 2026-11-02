import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { defaultGarageDoorSpec, GARAGE_DOOR_PRESETS } from './garage-door'
import { rightCornerOrigin } from './corner'
import { projectToScene } from '../scene/project-to-scene'

const make = (length = 6000) => createProjectStore(createProjectFromCurrentState({
  projectId: 'garage-na-ca', length, height: 2700, spacing: 600, openings: [],
}))
function addGarage(store: ReturnType<typeof make>, wallId: string,
  widthMm: number = GARAGE_DOOR_PRESETS[0].widthMm, positionXmm = 135) {
  return store.dispatch({ type: 'ADD_OPENING', payload: { wallId,
    opening: { id: 'G01', type: 'garage-door', positionXmm,
      widthMm, heightMm: 2134, sillHeightMm: 0,
      garage: defaultGarageDoorSpec() },
  } })
}

describe('S06.4: North American garage openings in modular walls', () => {
  it('creates 8x7-ft garage door with 2 jack studs/side and a labelled unverified lintel', () => {
    const store = make()
    expect(addGarage(store, 'wall-001').success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.validation.valid).toBe(true)
    const garage = doc.building.openings[0]
    expect(garage.type).toBe('garage-door')
    expect(garage.widthMm).toBe(2438)
    expect(garage.heightMm).toBe(2134)
    expect(garage.sillHeightMm).toBe(0)
    expect(garage.garage).toEqual(defaultGarageDoorSpec())
    expect('positionXmm' in garage).toBe(false)
    const boards = doc.assembly.elements.filter(e => e.elementId.startsWith('G01-'))
    expect(boards.filter(e => e.role === 'jack-stud')).toHaveLength(4)
    expect(boards.filter(e => e.role === 'king-stud')).toHaveLength(2)
    const headers = boards.filter(e => e.role === 'garage-lintel-preview')
    expect(headers).toHaveLength(2)
    expect(headers.every(e => e.sectionMm.height === 286)).toBe(true)
    expect(headers.every(e => e.position.y === 2134)).toBe(true)
    expect(doc.assembly.elements.some(e => e.role === 'bottom-plate' &&
      e.position.x >= garage.positionUmm &&
      e.position.x < garage.positionUmm + garage.widthMm)).toBe(false)
    expect(doc.validation.issues.some(i => i.code === 'GARAGE_LINTEL_REQUIRES_ENGINEERING')).toBe(true)
    expect(doc.validation.issues.some(i => i.code === 'GARAGE_BRACING_AND_TRACK_CLEARANCES_UNVERIFIED')).toBe(true)
    expect(doc.validation.engineeringStatus).toBe('not_evaluated')
  })
  it('supports 16x7-ft and rejects an opening wider than the supporting wall', () => {
    const store = make()
    expect(addGarage(store, 'wall-001', GARAGE_DOOR_PRESETS[2].widthMm, 400).success).toBe(true)
    expect(store.getSnapshot().validation.valid).toBe(true)
    expect(store.getSnapshot().assembly.elements.some(e => e.elementId === 'G01-header-1')).toBe(true)
    const short = make(3000)
    const result = addGarage(short, 'wall-001', 4877, 135)
    expect(result.success).toBe(false)
    expect(short.getSnapshot().building.openings).toHaveLength(0)
  })
  it('adds a garage door to the perpendicular second wall and projects marker', () => {
    const store = make()
    const first = store.getSnapshot().building.walls[0]
    const second = { ...first, wallId: 'wall-002', lengthMm: 3000,
      orientation: 'z' as const, origin: rightCornerOrigin(first, first), openings: [] }
    expect(store.dispatch({ type: 'ADD_WALL', payload: { wall: second } }).success).toBe(true)
    expect(addGarage(store, 'wall-002').success).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.validation.valid).toBe(true)
    const op = projectToScene(snap).sceneOpenings.find(o => o.id === 'G01')!
    expect(op.wallId).toBe('wall-002')
    expect(op.wallOrientation).toBe('z')
    expect(op.garage?.minHeadRoomMm).toBe(305)
    expect(projectToScene(snap).markers.find(m => m.openingId === 'G01')?.position.z)
      .toBeCloseTo(second.origin.z - 135 - 2438 / 2)
    expect(snap.assembly.elements.some(e => e.elementId === 'wall-002:G01-header-1' &&
      e.role === 'garage-lintel-preview')).toBe(true)
  })
  it('rejects invalid garage specification before writing JSON, including a misplaced sill', () => {
    const store = make()
    const wrong = { ...defaultGarageDoorSpec(), lintelPreviewDepthMm: -100 }
    const r = store.dispatch({ type:'ADD_OPENING', payload:{ wallId:'wall-001',
      opening: { id:'G02', type:'garage-door', positionXmm:300, widthMm:2438,
        heightMm:2134, sillHeightMm:0, garage:wrong } } })
    expect(r.success).toBe(false)
    expect(store.getSnapshot().building.openings).toHaveLength(0)
    const r2 = store.dispatch({ type:'ADD_OPENING', payload:{ wallId:'wall-001',
      opening: { id:'G03', type:'garage-door', positionXmm:300, widthMm:2438,
        heightMm:2134, sillHeightMm:100, garage:defaultGarageDoorSpec() } } })
    expect(r2.success).toBe(false)
    expect(store.getSnapshot().building.openings).toHaveLength(0)
  })
  it('roundtrips canonical garage parameters, undo/redo and rejects tampered import', () => {
    const store = make()
    expect(addGarage(store, 'wall-001').success).toBe(true)
    const json = store.exportJson()
    expect(store.dispatch({ type:'SET_OPENING_POSITION', payload:{
      openingId:'G01', positionUmm:400,
    } }).success).toBe(true)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(json)
    expect(store.redo().success).toBe(true)
    const copy = make()
    expect(copy.importJson(store.exportJson()).success).toBe(true)
    expect(copy.exportJson()).toBe(store.exportJson())
    const bad = JSON.parse(json)
    delete bad.building.openings[0].garage
    expect(copy.importJson(JSON.stringify(bad)).success).toBe(false)
    expect(copy.getSnapshot().building.openings[0].garage).toEqual(defaultGarageDoorSpec())
  })
})
