import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { emptyFloorPlan } from './floor-plan'

const point = (xMm:number,zMm:number) => ({xMm,zMm})
function create() {
  return createProjectStore(createProjectFromCurrentState({
    projectId:'plan-command-tests',length:6000,height:2700,spacing:600,openings:[],
  }))
}
function rectangle(store: ReturnType<typeof create>) {
  for (const p of [point(0,0),point(6000,0),point(6000,-4000),point(0,-4000)]) {
    const result = store.dispatch({type:'PLAN_ADD_POINT',payload:{point:p}})
    expect(result.success,result.messageRu).toBe(true)
  }
}
describe('SIGMA4 0.1.0 plan commands with JSON truth, validation and undo',()=>{
  it('persists a closed rectangle with exact millimetres independently from timber',()=>{
    const store=create()
    const boards=JSON.stringify(store.getSnapshot().assembly.elements)
    expect(store.getSnapshot().building.floorPlan).toBeUndefined()
    rectangle(store)
    expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
    const snapshot=store.getSnapshot()
    expect(snapshot.validation.valid).toBe(true)
    expect(snapshot.building.floorPlan).toEqual({
      exterior:[point(0,0),point(6000,0),point(6000,-4000),point(0,-4000)],
      closed:true,interiorWalls:[],
    })
    expect(JSON.stringify(snapshot.assembly.elements)).toBe(boards)
    const json=store.exportJson()
    const copy=create()
    expect(copy.importJson(json).success).toBe(true)
    expect(copy.exportJson()).toBe(json)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.closed).toBe(false)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.closed).toBe(true)
  })
  it('rejects malformed points, crossing segments, and early/diagonal closure atomically',()=>{
    const store=create()
    let result=store.dispatch({type:'PLAN_ADD_POINT',payload:{point:point(250,0)}})
    expect(result.success).toBe(false)
    expect(store.getSnapshot().building.floorPlan).toBeUndefined()
    rectangle(store)
    const original=store.exportJson()
    result=store.dispatch({type:'PLAN_ADD_POINT',payload:{point:point(0,0)}})
    expect(result.success).toBe(false)
    expect(store.exportJson()).toBe(original)
    result=store.dispatch({type:'PLAN_MOVE_POINT',payload:{index:1,point:point(6000,-1000)}})
    expect(result.success).toBe(false)
    expect(store.exportJson()).toBe(original)
    result=store.dispatch({type:'PLAN_CLOSE',payload:{}})
    expect(result.success).toBe(true)
    const after=store.exportJson()
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point:point(1000,1000)}}).success).toBe(false)
    expect(store.exportJson()).toBe(after)
  })
  it('allows reopening and undoing the last vertex without corrupting the 3D frame',()=>{
    const store=create()
    rectangle(store)
    store.dispatch({type:'PLAN_CLOSE',payload:{}})
    expect(store.dispatch({type:'PLAN_REOPEN',payload:{}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_REMOVE_LAST',payload:{}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.exterior).toHaveLength(3)
    expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(false)
    expect(store.dispatch({type:'PLAN_CLEAR',payload:{}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan).toEqual(emptyFloorPlan())
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.exterior).toHaveLength(3)
  })
  it('refuses invalid external JSON and preserves the previous committed document',()=>{
    const store=create()
    rectangle(store)
    const original=store.exportJson()
    const corrupted=JSON.parse(original)
    corrupted.building.floorPlan.exterior[2]={xMm:4000,zMm:-7000}
    const result=store.importJson(JSON.stringify(corrupted))
    expect(result.success).toBe(false)
    expect(store.exportJson()).toBe(original)
  })
  it('permits moving a nonorigin vertex when the plan remains orthogonal',()=>{
    const store=create()
    for(const p of [point(0,0),point(6000,0)]) {
      expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point:p}}).success).toBe(true)
    }
    expect(store.dispatch({type:'PLAN_MOVE_POINT',payload:{index:1,point:point(6800,0)}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.exterior[1]).toEqual(point(6800,0))
    expect(store.dispatch({type:'PLAN_MOVE_POINT',payload:{index:0,point:point(1000,0)}}).success).toBe(false)
  })
})
