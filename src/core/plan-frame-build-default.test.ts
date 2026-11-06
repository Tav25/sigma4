import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphView } from './plan-graph'
import { physicalPartitionRuns } from './structural-runs'
import { validateAssemblyContacts } from './frame-structural-validator'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
type Segment=readonly [ReturnType<typeof p>,ReturnType<typeof p>]
const makePlan=(edges:readonly Segment[])=>{
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'s22.1-9x6-T-one-click', length:6000, height:2700,
    spacing:600, openings:[],
  }))
  const apply=(command:Parameters<typeof store.dispatch>[0])=>{
    const result=store.dispatch(command)
    expect(result.success,JSON.stringify(result)).toBe(true)
  }
  for(const point of [p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)])
    apply({type:'PLAN_ADD_POINT',payload:{point}})
  apply({type:'PLAN_CLOSE',payload:{}})
  for(const [start,end] of edges)
    apply({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}})
  return store
}
const vertical=[p(3000,0),p(3000,-6000)] as const
const tArm=[p(0,-3000),p(3000,-3000)] as const

describe('SIGMA4 0.1.28: one-click build includes the authored interior walls',()=>{
  it.each(['through-first','branch-first'] as const)(
    'builds a continuous 6m partition with 3m T branch (%s)',order=>{
      const store=makePlan(order==='through-first'?[vertical,tArm]:[tArm,vertical])
      const initial=store.getSnapshot().building.floorPlan!
      expect(initial.frame?.partitions).toBeUndefined()
      expect(graphView(initial).interiorWalls).toHaveLength(3)
      const previous=store.exportJson(),revision=store.getRevision()
      const result=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
      expect(result.success,JSON.stringify(result)).toBe(true)
      const doc=store.getSnapshot()
      expect(store.getRevision()).toBe(revision+1)
      expect(doc.building.floorPlan!.frame?.partitions).toBe(true)
      expect(doc.building.floorPlan!.frame?.built).toBe(true)
      expect(doc.building.walls).toHaveLength(6)
      const runs=physicalPartitionRuns(doc.building.floorPlan!)
      expect(runs.walls).toHaveLength(2)
      const verticalRun=runs.walls.find(w=>w.start.xMm===3000&&w.end.xMm===3000)!
      expect(verticalRun).toBeDefined()
      const wallId='partition-'+verticalRun.id
      expect(doc.building.walls.find(w=>w.wallId===wallId)?.lengthMm).toBe(5710)
      expect(doc.assembly.elements.filter(e=>e.elementId===wallId+':plate-top-1'))
        .toHaveLength(1)
      expect(doc.assembly.elements.filter(e=>e.wallId===wallId&&
        e.elementId.includes(':partition-backing-'))).toHaveLength(3)
      expect(validateAssemblyContacts(doc)).toEqual([])
      expect(doc.validation.valid,
        JSON.stringify(doc.validation.issues.filter(i=>i.severity==='error'))).toBe(true)
      const built=store.exportJson()
      expect(store.undo().success).toBe(true)
      expect(store.exportJson()).toBe(previous)
      expect(store.redo().success).toBe(true)
      expect(store.exportJson()).toBe(built)
      expect(store.importJson(built).success).toBe(true)
      expect(store.exportJson()).toBe(built)
    })
  it('retains four exterior walls for an empty 9x6 plan',()=>{
    const store=makePlan([])
    const r=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
    expect(r.success,r.messageRu).toBe(true)
    expect(store.getSnapshot().building.floorPlan!.frame?.partitions).toBeUndefined()
    expect(store.getSnapshot().building.walls).toHaveLength(4)
    expect(store.getSnapshot().validation.valid).toBe(true)
  })
})
