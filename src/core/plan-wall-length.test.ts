import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphView, resizePlanWallLength } from './plan-graph'
import type { Opening } from './project'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
const create=()=>{
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'plan-wall-length-0.1.28',length:6000,height:2700,spacing:600,openings:[],
  }))
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  return store
}
const add=(store:ReturnType<typeof create>,a:ReturnType<typeof p>,b:ReturnType<typeof p>)=>{
  const result=store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
    start:a,end:b,thicknessMm:100,
  }})
  expect(result.success,result.messageRu).toBe(true)
  const walls=graphView(store.getSnapshot().building.floorPlan!).interiorWalls
  return walls.find(w=>w.start.xMm===a.xMm&&w.start.zMm===a.zMm &&
    w.end.xMm===b.xMm&&w.end.zMm===b.zMm)!.id
}
describe('SIGMA4 0.1.28: anchored wall length',()=>{
  it('fixes the start, records one history action, and roundtrips Undo/Redo',()=>{
    const store=create(),id=add(store,p(1500,-2000),p(4000,-2000))
    const before=store.exportJson(),rev=store.getRevision()
    const r=store.dispatch({type:'PLAN_SET_INTERIOR_LENGTH',payload:{
      id,lengthMm:3000,fixedEnd:'start',
    }})
    expect(r.success,r.messageRu).toBe(true)
    expect(store.getRevision()).toBe(rev+1)
    expect(graphView(store.getSnapshot().building.floorPlan!).interiorWalls[0])
      .toMatchObject({start:p(1500,-2000),end:p(4500,-2000)})
    const after=store.exportJson()
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
    expect(store.redo().success).toBe(true)
    expect(store.exportJson()).toBe(after)
  })
  it('fixes the end of a reverse-oriented segment and keeps JSON deterministic',()=>{
    const store=create(),id=add(store,p(4000,-2500),p(1800,-2500))
    expect(store.dispatch({type:'PLAN_SET_INTERIOR_LENGTH',payload:{
      id,lengthMm:2800,fixedEnd:'end',
    }}).success).toBe(true)
    expect(graphView(store.getSnapshot().building.floorPlan!).interiorWalls[0])
      .toMatchObject({start:p(4600,-2500),end:p(1800,-2500)})
    const json=store.exportJson(),copy=create()
    expect(copy.importJson(json).success).toBe(true)
    expect(copy.exportJson()).toBe(json)
  })
  it('rejects bad lengths, missing wall and breaking a T-junction without mutation',()=>{
    const store=create()
    add(store,p(3500,0),p(3500,-4000))
    const side=add(store,p(0,-2000),p(3500,-2000))
    const before=store.exportJson(),rev=store.getRevision()
    for(const payload of [
      {id:side,lengthMm:250,fixedEnd:'start' as const},
      {id:'missing',lengthMm:3000,fixedEnd:'start' as const},
      {id:side,lengthMm:2900,fixedEnd:'start' as const},
    ]){
      expect(store.dispatch({type:'PLAN_SET_INTERIOR_LENGTH',payload}).success).toBe(false)
      expect(store.exportJson()).toBe(before)
      expect(store.getRevision()).toBe(rev)
    }
  })
  it('rejects shortening through a door, preserving its attachment',()=>{
    const store=create(),id=add(store,p(0,-2500),p(4000,-2500))
    expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
    const opening:Opening={id:'D01',wallId:'partition-'+id,type:'door',
      positionUmm:2400,widthMm:900,heightMm:2100,sillHeightMm:0}
    expect(store.dispatch({type:'PLAN_FRAME_SAVE_OPENING',payload:{opening}}).success).toBe(true)
    const before=store.exportJson(),rev=store.getRevision()
    const result=store.dispatch({type:'PLAN_SET_INTERIOR_LENGTH',payload:{
      id,lengthMm:3000,fixedEnd:'start',
    }})
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PLAN_ATTACHMENT_CONFLICT')
    expect(store.getRevision()).toBe(rev)
    expect(store.exportJson()).toBe(before)
  })
  it('preserves legacy wall structure without creating graph source',()=>{
    const store=create()
    expect(store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:{
      id:'I008',start:p(1200,-1500),end:p(3500,-1500),thicknessMm:100,
    }}}).success).toBe(true)
    const plan=store.getSnapshot().building.floorPlan!
    const resized=resizePlanWallLength(plan,'I008',3000,'start')
    expect(resized.graph).toBeUndefined()
    expect(resized.interiorWalls[0]).toMatchObject({
      start:p(1200,-1500),end:p(4200,-1500),
    })
    expect(plan.interiorWalls[0].end).toEqual(p(3500,-1500))
  })
})
