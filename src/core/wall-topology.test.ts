import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { wallEnd, wallFootprint, effectiveConnections } from './wall-topology'
import { validateSourceParameters, validateProject } from './frame-validator'
import type { Wall } from './project'

const create = () => createProjectStore(createProjectFromCurrentState({
  projectId: 'multi-wall-regression', length: 6000, height: 2700, spacing: 600,
  openings: [
    { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
  ],
}))
function append(store: ReturnType<typeof create>, number: number) {
  const doc = store.getSnapshot()
  const parent = doc.building.walls[doc.building.walls.length - 1]
  const newWall: Wall = {
    ...parent, wallId: 'wall-' + String(number).padStart(3, '0'),
    lengthMm: 3000, origin: wallEnd(parent), openings: [],
  }
  return store.dispatch({ type: 'ADD_WALL', payload: {
    wall: newWall, connection: { fromWallId: parent.wallId, toWallId: newWall.wallId, type: 'end-to-end' },
  } })
}

describe('S06.2 connected modular walls', () => {
  it('creates 9 genuine walls with unique boards, no overlap, and JSON roundtrip', () => {
    const store = create()
    const front = store.getSnapshot().building.walls[0]
    const right: Wall = { ...front, wallId:'wall-002', lengthMm:3000, orientation:'z',
      origin:{ x: 5927.5, y:0, z:-72.5 }, openings:[] }
    expect(store.dispatch({type:'ADD_WALL',payload:{wall:right}}).success).toBe(true)
    for (let i=3;i<=9;i++) expect(append(store,i).success).toBe(true)
    const doc = store.getSnapshot()
    expect(doc.building.walls).toHaveLength(9)
    expect(doc.building.connections).toHaveLength(8)
    expect(doc.building.connections?.[0].type).toBe('california-right')
    expect(doc.assembly.elements.filter(e=>e.role==='corner-backing')).toHaveLength(1)
    expect(new Set(doc.assembly.elements.map(e=>e.elementId)).size).toBe(doc.assembly.elements.length)
    expect(doc.validation.valid).toBe(true)
    const restored=create()
    expect(restored.importJson(store.exportJson()).success).toBe(true)
    expect(restored.exportJson()).toBe(store.exportJson())
    expect(validateProject(doc).valid).toBe(true)
    expect(effectiveConnections(doc)).toHaveLength(8)
  })

  it('rejects overlapping, missing, cyclic and misaligned connections atomically', () => {
    const store=create()
    const front=store.getSnapshot().building.walls[0]
    const second:Wall={...front,wallId:'wall-002',lengthMm:3000,
      origin:{x:1000,y:0,z:0},openings:[]}
    expect(store.dispatch({type:'ADD_WALL',payload:{wall:second}}).errorCode).toBe('WALL_FOOTPRINT_OVERLAP')
    expect(store.getSnapshot().building.walls).toHaveLength(1)
    const unattached:Wall={...second,origin:{x:10000,y:0,z:0}}
    expect(store.dispatch({type:'ADD_WALL',payload:{
      wall:unattached,connection:{fromWallId:'missing',toWallId:'wall-002',type:'end-to-end'},
    }}).errorCode).toBe('INVALID_WALL_CONNECTION')
    expect(store.dispatch({type:'ADD_WALL',payload:{
      wall:unattached,connection:{fromWallId:'wall-001',toWallId:'wall-002',type:'end-to-end'},
    }}).errorCode).toBe('WALL_JOINT_GAP')
    expect(store.getRevision()).toBe(0)
  })

  it('reflows descendants after parent resize, moves a whole chain, and restores by Undo', () => {
    const store=create()
    expect(append(store,2).success).toBe(true)
    expect(append(store,3).success).toBe(true)
    const before=store.exportJson()
    expect(store.dispatch({type:'SET_WALL_LENGTH',payload:{wallId:'wall-001',lengthMm:6500}}).success).toBe(true)
    expect(store.getSnapshot().building.walls[1].origin.x).toBe(6500)
    expect(store.getSnapshot().building.walls[2].origin.x).toBe(9500)
    expect(store.dispatch({type:'SET_WALL_ORIGIN',payload:{wallId:'wall-001',
      origin:{x:400,y:0,z:200}}}).success).toBe(true)
    expect(store.getSnapshot().building.walls[2].origin.x).toBe(9900)
    expect(store.getSnapshot().building.walls[2].origin.z).toBe(200)
    expect(store.undo().success).toBe(true)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
  })

  it('forbids deleting a wall with children and rejects tampered JSON', () => {
    const store=create()
    expect(append(store,2).success).toBe(true)
    expect(append(store,3).success).toBe(true)
    expect(store.dispatch({type:'REMOVE_WALL',payload:{wallId:'wall-002'}}).errorCode).toBe('WALL_HAS_CHILDREN')
    const tampered=JSON.parse(store.exportJson())
    tampered.building.connections.push({
      fromWallId:'wall-003',toWallId:'wall-001',type:'end-to-end',
    })
    expect(validateSourceParameters(tampered).some(x=>x.code==='WALL_CONNECTION_CYCLE')).toBe(true)
    expect(store.importJson(JSON.stringify(tampered)).success).toBe(false)
    expect(store.getSnapshot().building.walls).toHaveLength(3)
  })

  it('preserves the legacy 2-wall corner and validates the shape of wall footprints', () => {
    const store=create(),doc=store.getSnapshot()
    const front=doc.building.walls[0]
    const second:Wall={...front,wallId:'wall-002',lengthMm:3000,orientation:'z',
      origin:{x:5927.5,y:0,z:-72.5},openings:[]}
    expect(store.dispatch({type:'ADD_WALL',payload:{wall:second}}).success).toBe(true)
    expect(store.getSnapshot().assembly.elements.find(e=>e.elementId==='warm-corner-stud')?.position.x).toBe(5810)
    const footprint=wallFootprint(second)
    expect(footprint.maxX).toBe(6000)
    expect(footprint.minZ).toBe(-3072.5)
  })
})
