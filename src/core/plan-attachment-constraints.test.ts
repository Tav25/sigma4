import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphSharedJunctionCount, resizePlanWithBoundNodes } from './plan-attachment-constraints'
import { graphView } from './plan-graph'
import { planFrameOpeningSides, planSidePoint } from './plan-frame'
import { validateFloorPlan } from './floor-plan'
import { projectToScene } from '../scene/project-to-scene'
import { buildHorizontalCut } from './horizontal-cut'
import type { Opening, ProjectDocument } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
type Segment=[ReturnType<typeof p>,ReturnType<typeof p>]
type Store=ReturnType<typeof createProjectStore>
const act=(store:Store,command:Parameters<Store['dispatch']>[0])=>{
  const result=store.dispatch(command)
  expect(result.success,JSON.stringify({
    errorCode:result.errorCode,messageRu:result.messageRu,
    issues:result.validation?.issues.filter(i=>i.severity==='error'),
  })).toBe(true)
}
function createPlan(width=9000,depth=6000){
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'stage4-bound-wall-geometry',length:6000,height:2700,spacing:600,
    openings:[],
  }))
  for(const point of [p(0,0),p(width,0),p(width,-depth),p(0,-depth)])
    act(store,{type:'PLAN_ADD_POINT',payload:{point}})
  act(store,{type:'PLAN_CLOSE',payload:{}})
  return store
}
function addEdges(store:Store,segments:Segment[]){
  for(const [start,end] of segments)
    act(store,{type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}})
  act(store,{type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}})
}
function door(store:Store,id:string,edgeId:string,u:number,widthMm=900){
  const opening:Opening={id,wallId:'partition-'+edgeId,type:'door',
    positionUmm:u,widthMm,heightMm:2100,sillHeightMm:0}
  act(store,{type:'PLAN_FRAME_SAVE_OPENING',payload:{opening}})
}
function built(store:Store):ProjectDocument {
  act(store,{type:'PLAN_FRAME_BUILD',payload:{}})
  const d=store.getSnapshot()
  expect(d.validation.valid).toBe(true)
  return d
}
function rawOpeningPosition(doc:ProjectDocument,id:string){
  const o=doc.building.floorPlan!.frame!.openings.find(o=>o.id===id)!
  const side=planFrameOpeningSides(doc.building.floorPlan!).find(x=>x.wallId===o.wallId)!
  expect(side).toBeDefined()
  return planSidePoint(side,o.positionUmm)
}
function assertRoundtrip(store:Store){
  const json=store.exportJson()
  const another=createPlan()
  expect(another.importJson(json).success).toBe(true)
  expect(another.exportJson()).toBe(json)
}

describe('SIGMA4 v0.1.23: maintain canonical room and opening attachments on edits',()=>{
  it('moves exterior-attached shared graph nodes when a 9x6 building grows to 10x7',()=>{
    const store=createPlan()
    addEdges(store,[[p(3000,-6000),p(3000,0)],
      [p(0,-3250),p(3000,-3250)]])
    const plan=store.getSnapshot().building.floorPlan!
    expect(graphSharedJunctionCount(plan)).toBe(1)
    const edges=graphView(plan).interiorWalls
    const top=edges.find(e=>e.start.xMm===3000&&e.end.xMm===3000&&
      Math.min(e.start.zMm,e.end.zMm)===-6000)!
    door(store,'D01',top.id,top.start.zMm===-6000?1200:1550)
    act(store,{type:'PLAN_FRAME_SAVE_OPENING',payload:{
      opening:{id:'W01',wallId:'plan-back',type:'window',
        positionUmm:4500,widthMm:1200,heightMm:1000,sillHeightMm:900},
    }})
    const baseline=built(store)
    const oldDoor=baseline.building.floorPlan!.frame!.openings.find(o=>o.id==='D01')!
    const before=store.exportJson()
    act(store,{type:'PLAN_FRAME_RESIZE',payload:{widthMm:10000,depthMm:7000}})
    const doc=store.getSnapshot()
    const updated=doc.building.floorPlan!
    expect(updated.exterior).toEqual([p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    expect(graphSharedJunctionCount(updated)).toBe(1)
    const changed=graphView(updated).interiorWalls
    expect(changed.filter(e=>e.start.xMm===3000&&e.end.xMm===3000)).toHaveLength(2)
    expect(changed.some(e=>e.start.zMm===-7000||e.end.zMm===-7000)).toBe(true)
    expect(changed.some(e=>e.start.zMm===-6000||e.end.zMm===-6000)).toBe(false)
    expect(updated.frame!.openings.find(o=>o.id==='D01')).toEqual(oldDoor)
    expect(updated.frame!.openings.find(o=>o.id==='W01')!.positionUmm).toBe(4500)
    expect(doc.validation.valid).toBe(true)
    expect(buildHorizontalCut(projectToScene(doc).elements,1200).pieces.length).toBeGreaterThan(15)
    assertRoundtrip(store)
    const after=store.exportJson()
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(before)
    expect(store.redo().success).toBe(true)
    expect(store.exportJson()).toBe(after)
  })

  it('preserves physical doorway placement on a dependent branch when its junction moves',()=>{
    const store=createPlan(10000,7000)
    addEdges(store,[[p(4000,0),p(4000,-7000)],[p(4000,-3500),p(0,-3500)]])
    const plan=store.getSnapshot().building.floorPlan!
    const left=graphView(plan).interiorWalls.find(e=>e.start.xMm===4000&&
      e.end.xMm===0&&e.start.zMm===-3500)!
    expect(left).toBeDefined()
    door(store,'D01',left.id,1200)
    const doc=built(store)
    const previous=rawOpeningPosition(doc,'D01')
    expect(previous).toEqual(p(2800,-3500))
    const first=store.exportJson()
    const movedEdge=graphView(doc.building.floorPlan!).interiorWalls.find(e=>
      e.start.xMm===4000&&e.end.xMm===4000)!
    act(store,{type:'PLAN_MOVE_INTERIOR_WALL',payload:{id:movedEdge.id,offsetMm:250}})
    const current=store.getSnapshot()
    expect(rawOpeningPosition(current,'D01')).toEqual(previous)
    expect(current.building.floorPlan!.frame!.openings.find(o=>o.id==='D01')!.positionUmm)
      .toBe(1450)
    expect(graphSharedJunctionCount(current.building.floorPlan!)).toBe(1)
    expect(current.validation.valid).toBe(true)
    assertRoundtrip(store)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(first)
  })

  it('keeps local start offsets on the room wall attached to a moving exterior boundary',()=>{
    const store=createPlan()
    addEdges(store,[[p(3000,-6000),p(3000,0)]])
    const edge=graphView(store.getSnapshot().building.floorPlan!).interiorWalls[0]
    door(store,'D01',edge.id,1200)
    built(store)
    const oldPhysical=rawOpeningPosition(store.getSnapshot(),'D01')
    act(store,{type:'PLAN_FRAME_RESIZE',payload:{widthMm:9000,depthMm:7000}})
    const doc=store.getSnapshot()
    const opening=doc.building.floorPlan!.frame!.openings[0]
    expect(opening.positionUmm).toBe(1200)
    expect(rawOpeningPosition(doc,'D01')).toEqual(p(3000,-5800))
    expect(rawOpeningPosition(doc,'D01')).not.toEqual(oldPhysical)
    expect(doc.validation.valid).toBe(true)
  })

  it('remaps a door to the second piece when its host edge is split by a T branch',()=>{
    const store=createPlan(10000,7000)
    addEdges(store,[[p(4000,0),p(4000,-7000)]])
    const beforeId=graphView(store.getSnapshot().building.floorPlan!).interiorWalls[0].id
    door(store,'D01',beforeId,4200)
    built(store)
    const old=rawOpeningPosition(store.getSnapshot(),'D01')
    act(store,{type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(0,-3000),end:p(4000,-3000),thicknessMm:100,
    }})
    const snapshot=store.getSnapshot()
    const moved=snapshot.building.floorPlan!.frame!.openings.find(o=>o.id==='D01')!
    expect(moved.wallId).not.toBe('partition-'+beforeId)
    expect(moved.positionUmm).toBe(1200)
    expect(rawOpeningPosition(snapshot,'D01')).toEqual(old)
    expect(graphSharedJunctionCount(snapshot.building.floorPlan!)).toBe(1)
    expect(snapshot.validation.valid).toBe(true)
    assertRoundtrip(store)
  })

  it('rejects a new T connection through an existing door without changing the project',()=>{
    const store=createPlan(10000,7000)
    addEdges(store,[[p(4000,0),p(4000,-7000)]])
    door(store,'D01',graphView(store.getSnapshot().building.floorPlan!).interiorWalls[0].id,4200)
    built(store)
    const before=store.exportJson()
    const result=store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(0,-4600),end:p(4000,-4600),thicknessMm:100,
    }})
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PLAN_ATTACHMENT_CONFLICT')
    expect(result.messageRu).toContain('D01')
    expect(store.exportJson()).toBe(before)
  })

  it('rejects shrinking past a wall or garage opening, leaving JSON and undo history intact',()=>{
    const store=createPlan(10000,7000)
    addEdges(store,[[p(6200,0),p(6200,-7000)]])
    act(store,{type:'PLAN_FRAME_SAVE_OPENING',payload:{
      opening:{id:'G01',wallId:'plan-back',type:'garage-door',
        positionUmm:6800,widthMm:2438,heightMm:2134,sillHeightMm:0,
        garage:{installationProfile:'clopay-standard-torsion',
          minSideRoomMm:96,minHeadRoomMm:305,minBackRoomExtraMm:457,
          lintelPreviewDepthMm:286,jackStudsPerSide:2}},
    }})
    built(store)
    const before=store.exportJson()
    const rev=store.getRevision()
    const badWall=store.dispatch({type:'PLAN_FRAME_RESIZE',payload:{widthMm:5900,depthMm:7000}})
    expect(badWall.success).toBe(false)
    expect(store.exportJson()).toBe(before)
    expect(store.getRevision()).toBe(rev)
    const badGarage=store.dispatch({type:'PLAN_FRAME_RESIZE',payload:{widthMm:7000,depthMm:7000}})
    expect(badGarage.success).toBe(false)
    expect(store.exportJson()).toBe(before)
    expect(store.getRevision()).toBe(rev)
  })

  it('makes identical deterministic geometry with legacy ungraphed interior source',()=>{
    const store=createPlan(9000,6000)
    const before=store.getSnapshot().building.floorPlan!
    const legacy={...before,interiorWalls:[{
      id:'I007',start:p(3000,-6000),end:p(3000,0),thicknessMm:100,
    }]}
    expect(validateFloorPlan(legacy)).toEqual([])
    const resized=resizePlanWithBoundNodes(legacy,10000,7000)
    expect(resized.interiorWalls[0].start).toEqual(p(3000,-7000))
    expect(resized.interiorWalls[0].end).toEqual(p(3000,0))
    expect(validateFloorPlan(resized)).toEqual([])
  })
})
