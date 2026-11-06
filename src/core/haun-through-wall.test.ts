import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphView } from './plan-graph'
import { physicalPartitionRuns } from './structural-runs'
import { planStructuralFrameSides } from './plan-frame'
import { validateAssemblyContacts, physicalTimberBoxes, boxesFaceContact } from './frame-structural-validator'
import { buildHorizontalCut } from './horizontal-cut'
import { projectToScene } from '../scene/project-to-scene'
import { defaultGarageDoorSpec } from './garage-door'
import type { Opening, ProjectDocument } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
const create=(order:'long-first'|'branch-first'='long-first')=>{
  const store=createProjectStore(createProjectFromCurrentState({
    length:6000,height:2700,spacing:600,openings:[],
    projectId:'Larry-Haun-9x6-through-run',
  }))
  const send=(cmd:Parameters<typeof store.dispatch>[0])=>{
    const result=store.dispatch(cmd)
    expect(result.success,JSON.stringify(result)).toBe(true)
  }
  for(const point of [p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)])
    send({type:'PLAN_ADD_POINT',payload:{point}})
  send({type:'PLAN_CLOSE',payload:{}})
  const long=[p(3000,0),p(3000,-6000)] as const
  const short=[p(0,-3000),p(3000,-3000)] as const
  for(const [start,end] of order==='long-first'?[long,short]:[short,long])
    send({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}})
  send({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}})
  const plan=store.getSnapshot().building.floorPlan!
  const segments=graphView(plan).interiorWalls
  const vertical=segments.filter(e=>e.start.xMm===3000&&e.end.xMm===3000)
  expect(vertical).toHaveLength(2)
  const upper=vertical.find(e=>Math.max(e.start.zMm,e.end.zMm)===0)!
  const lower=vertical.find(e=>Math.min(e.start.zMm,e.end.zMm)===-6000)!
  const opening=(id:string,segment:typeof upper):Opening=>({
    id,wallId:'partition-'+segment.id,type:'door',
    positionUmm:segment.start.zMm===0?1100:1000,
    widthMm:900,heightMm:2100,sillHeightMm:0,
  })
  // Both doors must stay authored on their original 2D graph edges.
  send({type:'PLAN_FRAME_SAVE_OPENING',payload:{
    opening:opening('D01',upper),
  }})
  send({type:'PLAN_FRAME_SAVE_OPENING',payload:{
    opening:{...opening('D02',lower),
      positionUmm:segmentStartAtJunction(lower)?1000:1100},
  }})
  send({type:'PLAN_FRAME_SAVE_OPENING',payload:{
    opening:{id:'G01',wallId:'plan-right',type:'garage-door',
      positionUmm:1500,widthMm:2438,heightMm:2134,sillHeightMm:0,
      garage:defaultGarageDoorSpec()},
  }})
  send({type:'PLAN_FRAME_BUILD',payload:{}})
  return {store,doc:store.getSnapshot(),upperId:upper.id,lowerId:lower.id}
}
const segmentStartAtJunction=(edge:{start:{zMm:number}})=>
  edge.start.zMm===-3000
const prefix=(doc:ProjectDocument)=>doc.building.walls
  .filter(w=>w.wallId.startsWith('partition-'))
const member=(doc:ProjectDocument,id:string)=>doc.assembly.elements
  .filter(e=>e.wallId===id)
const upper=(doc:ProjectDocument,id:string)=>member(doc,id)
  .filter(e=>e.role==='top-plate' && e.elementId.includes(':plate-top-2'))

describe('Larry Haun: a 6m THROUGH wall with 2 doors and a 3m T branch',()=>{
  it.each(['long-first','branch-first'] as const)(
    'generates ONE continuous wall from graph-split segments (%s)',order=>{
      const {store,doc,upperId,lowerId}=create(order)
      const authored=doc.building.floorPlan!
      expect(graphView(authored).interiorWalls).toHaveLength(3)
      const runs=physicalPartitionRuns(authored)
      expect(runs.walls).toHaveLength(2)
      const throughOwner=runs.ownerBySegment.get(upperId)!
      expect(throughOwner).toBe(runs.ownerBySegment.get(lowerId))
      const throughId='partition-'+throughOwner
      const through=doc.building.walls.find(w=>w.wallId===throughId)!
      expect(through).toBeTruthy()
      expect(through.lengthMm).toBe(5710)
      expect(prefix(doc)).toHaveLength(2)
      expect(doc.building.walls).toHaveLength(6)
      const authoredDoors=authored.frame!.openings.filter(o=>o.type==='door')
      expect(new Set(authoredDoors.map(o=>o.wallId)).size).toBe(2)
      const physicalDoors=doc.building.openings.filter(o=>o.type==='door')
      expect(physicalDoors).toHaveLength(2)
      expect(physicalDoors.every(o=>o.wallId===throughId)).toBe(true)
      expect(physicalDoors[0].positionUmm).toBeLessThan(physicalDoors[1].positionUmm)
      const bottom=member(doc,throughId).filter(e=>e.role==='bottom-plate')
      expect(bottom).toHaveLength(3) // split ONLY at the two doors
      const first=member(doc,throughId).filter(e=>
        e.elementId===throughId+':plate-top-1')
      expect(first).toHaveLength(1)
      expect(first[0].lengthMm).toBe(5710)
      // No phantom panel end studs at the middle T-junction.
      expect(member(doc,throughId).filter(e=>e.elementId.endsWith(':stud-01'))).toHaveLength(1)
      expect(member(doc,throughId).filter(e=>e.elementId.endsWith(':stud-02'))).toHaveLength(1)
      const source=store.exportJson()
      expect(store.importJson(source).success).toBe(true)
      expect(store.exportJson()).toBe(source)
    })
  it('places a three-stud receiver UNDER continuous first cap, and laps upper plate',()=>{
    const {doc}=create()
    const through=prefix(doc).find(w=>w.orientation==='z')!
    const branch=prefix(doc).find(w=>w.orientation==='x')!
    const channel=member(doc,through.wallId)
      .filter(e=>e.elementId.includes(':partition-backing-'))
    expect(channel).toHaveLength(3)
    expect(channel.filter(e=>e.elementId.endsWith('-flat'))).toHaveLength(1)
    expect(channel.filter(e=>e.elementId.endsWith('-left')||e.elementId.endsWith('-right')))
      .toHaveLength(2)
    expect(channel.every(e=>e.lengthMm===2565)).toBe(true)
    const caps=upper(doc,through.wallId)
    expect(caps).toHaveLength(2)
    const tie=upper(doc,branch.wallId)
    expect(tie).toHaveLength(1)
    expect(tie[0].connectionIds).toContain(caps[0].elementId)
    expect(tie[0].connectionIds).toContain(caps[1].elementId)
    const boxes=physicalTimberBoxes(doc)
    const branchEnd=boxes.find(e=>e.id===branch.wallId+':stud-02')!
    const flat=boxes.find(e=>e.id===channel.find(e=>e.elementId.endsWith('-flat'))!.elementId)!
    expect(branchEnd&&flat).toBeTruthy()
    expect(boxesFaceContact(branchEnd,flat)).toBe(true)
    expect(validateAssemblyContacts(doc)).toEqual([])
    const mid=buildHorizontalCut(projectToScene(doc).elements,1200)
    expect(mid.pieces.filter(piece=>piece.elementId.includes(':partition-backing-'))).toHaveLength(3)
    const high=buildHorizontalCut(projectToScene(doc).elements,2680)
    expect(high.pieces.filter(piece=>piece.elementId.includes(':plate-top-2') &&
      piece.wallId===through.wallId)).toHaveLength(2)
    expect(doc.validation.valid).toBe(true)
  })
  it('still keeps four-arm X arms separate pending its own four-way channel scheme',()=>{
    const {store}=create()
    // The approved rectangular T is not silently converted into an X.
    const plan=store.getSnapshot().building.floorPlan!
    expect(planStructuralFrameSides(plan).filter(s=>s.wallId.startsWith('partition-')))
      .toHaveLength(2)
  })
})
