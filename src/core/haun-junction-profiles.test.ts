import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphView } from './plan-graph'
import { physicalCrossNodes, physicalPartitionRuns, validatePhysicalThroughRuns } from './structural-runs'
import { physicalTimberBoxes, boxesFaceContact, volumesOverlap, validateAssemblyContacts } from './frame-structural-validator'
import { buildHorizontalCut } from './horizontal-cut'
import { projectToScene } from '../scene/project-to-scene'
import type { ProjectDocument } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
type Point=ReturnType<typeof p>
type Edge=readonly [Point,Point]
const newFrame=(edges:readonly Edge[])=>{
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'haun-junctions-v0.1.27',length:6000,height:2700,spacing:600,openings:[],
  }))
  const act=(type:string,payload:object)=>{
    const result=store.dispatch({type,payload} as Parameters<typeof store.dispatch>[0])
    expect(result.success,JSON.stringify(result)).toBe(true)
  }
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    act('PLAN_ADD_POINT',{point})
  act('PLAN_CLOSE',{})
  for(const [start,end] of edges)
    act('PLAN_GRAPH_ADD_EDGE',{start,end,thicknessMm:100})
  act('PLAN_FRAME_ENABLE_PARTITIONS',{})
  act('PLAN_FRAME_BUILD',{})
  const doc=store.getSnapshot()
  expect(doc.validation.valid,JSON.stringify(doc.validation.issues.filter(x=>x.severity==='error'))).toBe(true)
  return {doc,store}
}
const assemblies=(doc:ProjectDocument)=>doc.building.walls.filter(w=>w.wallId.startsWith('partition-'))
const own=(doc:ProjectDocument,wallId:string)=>doc.assembly.elements.filter(e=>e.wallId===wallId)
const caps=(doc:ProjectDocument,wallId:string)=>
  own(doc,wallId).filter(e=>e.role==='top-plate'&&e.elementId.includes(':plate-top-2'))
const cuts=(doc:ProjectDocument,h:number)=>buildHorizontalCut(projectToScene(doc).elements,h).pieces
const assertNoCollidingCaps=(doc:ProjectDocument)=>{
  const caps=physicalTimberBoxes(doc).filter(b=>
    b.element.role==='top-plate'&&b.id.includes(':plate-top-2'))
  for(let i=0;i<caps.length;i++)for(let j=i+1;j<caps.length;j++)
    expect(volumesOverlap(caps[i],caps[j]),
      'Top plate collision: '+caps[i].id+' / '+caps[j].id).toBe(false)
  for(const cap of caps){
    for(const id of cap.element.connectionIds.filter(id=>id.includes(':plate-top-2'))){
      const other=caps.find(e=>e.id===id)!
      expect(other,'Broken upper-plate link '+id).toBeDefined()
      expect(boxesFaceContact(cap,other),'Upper cap not in contact '+cap.id+'/'+id).toBe(true)
    }
  }
}
const assertValid=(doc:ProjectDocument)=>{
  expect(validateAssemblyContacts(doc)).toEqual([])
  expect(validatePhysicalThroughRuns(doc)).toEqual([])
  assertNoCollidingCaps(doc)
  expect(doc.validation.engineeringStatus).toBe('not_evaluated')
}
describe('SIGMA4 v0.1.27: Larry Haun straight, L, T and X wall joinery',()=>{
  it('keeps a straight interior wall continuous with no false junction package',()=>{
    const {doc}=newFrame([[p(4000,0),p(4000,-7000)]])
    expect(assemblies(doc)).toHaveLength(1)
    const wall=assemblies(doc)[0]
    expect(own(doc,wall.wallId).filter(e=>e.elementId.includes(':partition-backing-'))).toHaveLength(0)
    expect(own(doc,wall.wallId).filter(e=>e.elementId.includes(':cross-backing-'))).toHaveLength(0)
    expect(own(doc,wall.wallId).filter(e=>e.elementId===wall.wallId+':plate-top-1')).toHaveLength(1)
    expect(caps(doc,wall.wallId)).toHaveLength(1)
    assertValid(doc)
  })
  it.each([false,true])('L: first courses butt, second courses lap around corner (reverse drawing %s)',reverse=>{
    const x=[p(0,-3000),p(4000,-3000)] as const
    const z=[p(4000,-3000),p(4000,0)] as const
    const {doc}=newFrame(reverse?[z,x]:[x,z])
    const walls=assemblies(doc)
    expect(walls).toHaveLength(2)
    const a=walls.find(w=>w.orientation==='x')!,b=walls.find(w=>w.orientation==='z')!
    expect(a&&b).toBeTruthy()
    const firstA=own(doc,a.wallId).find(e=>e.elementId===a.wallId+':plate-top-1')!
    const firstB=own(doc,b.wallId).find(e=>e.elementId===b.wallId+':plate-top-1')!
    expect(firstA&&firstB).toBeTruthy()
    const box=physicalTimberBoxes(doc)
    const upperA=caps(doc,a.wallId)[0], upperB=caps(doc,b.wallId)[0]
    expect(upperA&&upperB).toBeTruthy()
    expect(boxesFaceContact(box.find(x=>x.id===upperA.elementId)!,
      box.find(x=>x.id===upperB.elementId)!)).toBe(true)
    expect(upperA.connectionIds).toContain(upperB.elementId)
    expect(cuts(doc,2635).filter(x=>x.role==='top-plate')).toHaveLength(6)
    expect(cuts(doc,2680).filter(x=>x.wallId===a.wallId||x.wallId===b.wallId)
      .filter(x=>x.role==='top-plate')).toHaveLength(2)
    assertValid(doc)
  })
  it('T: 2 authored collinear arms are one physical through-wall with a three-stud receiver',()=>{
    const {doc}=newFrame([
      [p(0,-3000),p(10000,-3000)],
      [p(4000,0),p(4000,-3000)],
    ])
    expect(graphView(doc.building.floorPlan!).interiorWalls).toHaveLength(3)
    expect(assemblies(doc)).toHaveLength(2)
    const run=assemblies(doc).find(w=>w.orientation==='x')!
    expect(own(doc,run.wallId).filter(e=>e.elementId===run.wallId+':plate-top-1'))
      .toHaveLength(1)
    expect(own(doc,run.wallId).filter(e=>e.elementId.includes(':partition-backing-')))
      .toHaveLength(3)
    expect(caps(doc,run.wallId)).toHaveLength(2)
    assertValid(doc)
  })
  it.each([false,true])('X: one continuous horizontal wall + two vertical butt arms (reverse drawing %s)',reverse=>{
    const x=[p(0,-3000),p(10000,-3000)] as const
    const z=[p(4000,0),p(4000,-7000)] as const
    const {doc,store}=newFrame(reverse?[z,x]:[x,z])
    const plan=doc.building.floorPlan!
    expect(graphView(plan).interiorWalls).toHaveLength(4)
    expect(physicalCrossNodes(plan)).toEqual([p(4000,-3000)])
    const runs=physicalPartitionRuns(plan)
    expect(runs.walls).toHaveLength(3)
    expect(assemblies(doc)).toHaveLength(3)
    const host=assemblies(doc).find(w=>w.orientation==='x')!
    expect(host.lengthMm).toBe(9710)
    expect(own(doc,host.wallId).filter(e=>e.elementId===host.wallId+':plate-top-1'))
      .toHaveLength(1)
    const cross=own(doc,host.wallId).filter(e=>e.elementId.includes(':cross-backing-'))
    expect(cross).toHaveLength(4)
    expect(cross.filter(e=>e.elementId.endsWith('-flat-a')||e.elementId.endsWith('-flat-b')))
      .toHaveLength(2)
    expect(cross.filter(e=>e.elementId.endsWith('-left')||e.elementId.endsWith('-right')))
      .toHaveLength(2)
    expect(own(doc,host.wallId).filter(e=>e.elementId.includes(':partition-backing-')))
      .toHaveLength(0)
    expect(caps(doc,host.wallId)).toHaveLength(2)
    const branchCaps=assemblies(doc).filter(w=>w.orientation==='z')
      .map(w=>caps(doc,w.wallId))
    expect(branchCaps).toHaveLength(2)
    expect(branchCaps.every(list=>list.length===1)).toBe(true)
    expect(cuts(doc,1200).filter(p=>p.elementId.includes(':cross-backing-')))
      .toHaveLength(4)
    expect(cuts(doc,2635).filter(p=>p.wallId===host.wallId&&
      p.elementId===host.wallId+':plate-top-1')).toHaveLength(1)
    expect(cuts(doc,2680).filter(p=>p.wallId===host.wallId&&
      p.elementId.includes(':plate-top-2'))).toHaveLength(2)
    assertValid(doc)
    const snapshot=store.exportJson()
    expect(store.importJson(snapshot).success).toBe(true)
    expect(store.exportJson()).toBe(snapshot)
  })
  it('rejects an X missing one nailer even if the remaining boards still touch',()=>{
    const {doc}=newFrame([
      [p(0,-3000),p(10000,-3000)],
      [p(4000,0),p(4000,-7000)],
    ])
    const invalid=JSON.parse(JSON.stringify(doc)) as ProjectDocument
    const idx=invalid.assembly.elements.findIndex(e=>e.elementId.includes(':cross-backing-')&&
      e.elementId.endsWith('-flat-a'))
    expect(idx).toBeGreaterThanOrEqual(0)
    invalid.assembly.elements.splice(idx,1)
    expect(validatePhysicalThroughRuns(invalid).map(x=>x.code))
      .toContain('HAUN_X_RECEIVER_MISSING')
  })
})
