import {describe,it,expect} from 'vitest'
import {createProjectFromCurrentState} from './project-store'
import {createProjectStore} from './ProjectStore'
import {graphView} from './plan-graph'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
function create(){
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'garage-plan-v0.1.12',length:6000,height:2700,spacing:600,openings:[],
  }))
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)]){
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
  }
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  return store
}
describe('SIGMA4 0.1.12 ProjectStore canonical graph and undo/redo',()=>{
  it('saves garage corner and deletes only horizontal right segment, keeping 3D unchanged',()=>{
    const store=create()
    const boards=JSON.stringify(store.getSnapshot().assembly.elements)
    for(const [start,end] of [[p(0,-2000),p(10000,-2000)],
      [p(4700,0),p(4700,-2000)]] as const){
      const command=store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}})
      expect(command.success,command.messageRu).toBe(true)
    }
    expect(store.getSnapshot().building.floorPlan?.graph?.edges).toHaveLength(3)
    const plan=store.getSnapshot().building.floorPlan!
    const right=graphView(plan).interiorWalls.find(w=>w.start.xMm===4700&&w.end.xMm===10000)!
    expect(right).toBeTruthy()
    expect(store.dispatch({type:'PLAN_GRAPH_DELETE_EDGE',payload:{id:right.id}}).success).toBe(true)
    expect(graphView(store.getSnapshot().building.floorPlan!).interiorWalls).toHaveLength(2)
    expect(store.getSnapshot().validation.valid).toBe(true)
    expect(JSON.stringify(store.getSnapshot().assembly.elements)).toBe(boards)
    const json=store.exportJson()
    const parsed=JSON.parse(json)
    expect(parsed.building.floorPlan.graph.nodes.length).toBeGreaterThan(0)
    expect(parsed.building.floorPlan.interiorWalls).toEqual([])
    const copy=create()
    const result=copy.importJson(json)
    expect(result.success,result.messageRu).toBe(true)
    expect(copy.exportJson()).toBe(json)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.graph?.edges).toHaveLength(3)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.floorPlan?.graph?.edges).toHaveLength(2)
  })
  it('can put a free point and later use it to draw a bend, close with no wall attachment',()=>{
    const store=create()
    expect(store.dispatch({type:'PLAN_GRAPH_ADD_POINT',payload:{point:p(2500,-1500)}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(2500,-1500),end:p(4500,-1500),thicknessMm:100,
    }}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(4500,-1500),end:p(4500,-3500),thicknessMm:100,
    }}).success).toBe(true)
    const source=store.getSnapshot().building.floorPlan!
    expect(source.graph?.edges).toHaveLength(2)
    const joint=source.graph?.nodes.find(n=>n.xMm===4500&&n.zMm===-1500)
    expect(joint).toBeTruthy()
    expect(source.graph?.edges.filter(e=>e.a===joint?.id||e.b===joint?.id)).toHaveLength(2)
  })
  it('splits an existing edge, rejects splitting too close to endpoint atomically',()=>{
    const store=create()
    store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(0,-3000),end:p(10000,-3000),thicknessMm:100,
    }})
    const id=store.getSnapshot().building.floorPlan!.graph!.edges[0].id
    const before=store.exportJson()
    const bad=store.dispatch({type:'PLAN_GRAPH_SPLIT_EDGE',payload:{id,point:p(100,-3000)}})
    expect(bad.success).toBe(false)
    expect(store.exportJson()).toBe(before)
    expect(store.dispatch({type:'PLAN_GRAPH_SPLIT_EDGE',payload:{id,point:p(4500,-3000)}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan!.graph!.edges).toHaveLength(2)
  })
  it('dragging a graph segment carries dependent T junctions with single history entry',()=>{
    const store=create()
    store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(0,-2000),end:p(10000,-2000),thicknessMm:100,
    }})
    store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(4700,0),end:p(4700,-2000),thicknessMm:100,
    }})
    const old=store.exportJson()
    const id=graphView(store.getSnapshot().building.floorPlan!).interiorWalls.find(w=>
      w.start.xMm===4700&&w.start.zMm===0)?.id
    expect(id).toBeTruthy()
    const r=store.dispatch({type:'PLAN_MOVE_INTERIOR_WALL',payload:{id:id!,offsetMm:300}})
    expect(r.success,r.messageRu).toBe(true)
    const updated=graphView(store.getSnapshot().building.floorPlan!).interiorWalls
    expect(updated.some(w=>w.start.xMm===5000&&w.end.xMm===5000)).toBe(true)
    expect(updated.some(w=>w.start.xMm===0&&w.end.xMm===5000)).toBe(true)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(old)
  })
  it('rejects corrupt external graph JSON and preserves previous saved project',()=>{
    const store=create()
    store.dispatch({type:'PLAN_GRAPH_ADD_POINT',payload:{point:p(3000,-3000)}})
    const original=store.exportJson()
    const bad=JSON.parse(original)
    bad.building.floorPlan.graph.nodes[0].xMm=110000
    const result=store.importJson(JSON.stringify(bad))
    expect(result.success).toBe(false)
    expect(store.exportJson()).toBe(original)
  })
  it('legacy projects stay importable and convert only on first graph operation',()=>{
    const store=create()
    const old=store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:{
      id:'I001',start:p(3000,0),end:p(3000,-7000),thicknessMm:100,
    }}})
    expect(old.success).toBe(true)
    const legacyJson=store.exportJson()
    expect(JSON.parse(legacyJson).building.floorPlan.graph).toBeUndefined()
    const copy=create()
    expect(copy.importJson(legacyJson).success).toBe(true)
    expect(copy.getSnapshot().building.floorPlan?.graph).toBeUndefined()
    expect(copy.dispatch({type:'PLAN_GRAPH_ADD_POINT',payload:{point:p(4600,-2000)}}).success).toBe(true)
    expect(copy.getSnapshot().building.floorPlan?.interiorWalls).toEqual([])
    expect(copy.getSnapshot().building.floorPlan?.graph?.edges).toHaveLength(1)
    expect(copy.undo().success).toBe(true)
    expect(copy.exportJson()).toBe(legacyJson)
  })
  it('clearing the graph allows reopening the exterior without deleting outer dimensions',()=>{
    const store=create()
    store.dispatch({type:'PLAN_GRAPH_ADD_POINT',payload:{point:p(3000,-2000)}})
    expect(store.dispatch({type:'PLAN_REOPEN',payload:{}}).success).toBe(false)
    expect(store.dispatch({type:'PLAN_GRAPH_CLEAR',payload:{}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan!.graph?.nodes).toEqual([])
    expect(store.dispatch({type:'PLAN_REOPEN',payload:{}}).success).toBe(true)
    expect(store.getSnapshot().building.floorPlan!.exterior).toHaveLength(4)
  })
})
