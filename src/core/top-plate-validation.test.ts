import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { validateTopPlateLaps } from './top-plate-validation'
import { validateProject } from './frame-validator'
import type { TimberElement } from './project'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
type Point=ReturnType<typeof p>
type Segment=readonly [Point,Point]
const make=(segments:readonly Segment[])=>{
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'S22.2-top-plate-splice',length:6000,height:2700,spacing:600,openings:[],
  }))
  const act=(command:Parameters<typeof store.dispatch>[0])=>{
    const result=store.dispatch(command)
    expect(result.success,JSON.stringify(result)).toBe(true)
  }
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    act({type:'PLAN_ADD_POINT',payload:{point}})
  act({type:'PLAN_CLOSE',payload:{}})
  for(const [start,end] of segments)act({type:'PLAN_GRAPH_ADD_EDGE',payload:{
    start,end,thicknessMm:100,
  }})
  act({type:'PLAN_FRAME_BUILD',payload:{}})
  return store.getSnapshot()
}
const cap=(doc:ReturnType<typeof make>,id:string)=>
  doc.assembly.elements.find(e=>e.elementId===id)!
const divide=(doc:ReturnType<typeof make>,original:TimberElement,at:number)=>{
  const end=original.lengthMm+original.position.x
  expect(at).toBeGreaterThan(original.position.x)
  expect(at).toBeLessThan(end)
  doc.assembly.elements.push({
    ...original,elementId:original.elementId+'-splice',
    position:{...original.position,x:at},lengthMm:end-at,connectionIds:[],
  })
  original.lengthMm=at-original.position.x
}
const t=[[p(4000,0),p(4000,-7000)],[p(0,-3500),p(4000,-3500)]] as const
const x=[[p(0,-3500),p(10000,-3500)],[p(4000,0),p(4000,-7000)]] as const
describe('SIGMA4: materialized double top plate laps and IRC 610 mm splice offset',()=>{
  it.each([{name:'T',segments:t},{name:'X',segments:x}])('accepts actual $name upper laps without inventing 610 mm overhang',({segments})=>{
    const doc=make(segments)
    expect(validateTopPlateLaps(doc)).toEqual([])
    expect(doc.validation.valid).toBe(true)
    expect(doc.validation.engineeringStatus).toBe('not_evaluated')
  })
  it('accepts a first-course 3000 mm splice with unbroken 610 mm shoulders in second course',()=>{
    const doc=make([])
    divide(doc,cap(doc,'plan-front:plate-top-1'),3000)
    expect(validateTopPlateLaps(doc)).toEqual([])
  })
  it('rejects any splice closer than 610 mm to an unspanned end',()=>{
    const doc=make([])
    divide(doc,cap(doc,'plan-front:plate-top-1'),400)
    const codes=validateTopPlateLaps(doc).map(issue=>issue.code)
    expect(codes).toContain('TOP_PLATE_SPLICE_LAP_TOO_SHORT')
    expect(validateProject(doc).valid).toBe(false)
  })
  it('rejects aligned first and second course butt joints',()=>{
    const doc=make([])
    divide(doc,cap(doc,'plan-front:plate-top-1'),3000)
    divide(doc,cap(doc,'plan-front:plate-top-2'),3000)
    expect(validateTopPlateLaps(doc).filter(x=>x.code==='TOP_PLATE_SPLICE_LAP_TOO_SHORT'))
      .toHaveLength(2)
  })
  it('rejects a splice directly under a T channel even with 1000+ mm to wall ends',()=>{
    const doc=make(t)
    const run=doc.building.walls.find(w=>w.wallId.startsWith('partition-') &&
      w.orientation==='z')!
    // A T channel interrupts the second course around this point. The
    // first course must be uninterrupted here, regardless of boundary length.
    divide(doc,cap(doc,run.wallId+':plate-top-1'),3000)
    expect(validateTopPlateLaps(doc).map(x=>x.code))
      .toContain('TOP_PLATE_SPLICE_LAP_TOO_SHORT')
  })
  it('rejects missing physical second-course bridge at a T, independently of link metadata',()=>{
    const doc=make(t)
    const branch=doc.building.walls.find(w=>w.wallId.startsWith('partition-') &&
      w.orientation==='x')!
    doc.assembly.elements=doc.assembly.elements.filter(e=>
      !e.elementId.startsWith(branch.wallId+':plate-top-2'))
    const issues=validateTopPlateLaps(doc)
    expect(issues.map(x=>x.code)).toContain('TOP_PLATE_INTERSECTION_LAP_MISSING')
    expect(validateProject(doc).valid).toBe(false)
  })
  it('rejects removal of either half of the X-through wall upper course',()=>{
    const doc=make(x)
    const through=doc.building.walls.find(w=>w.wallId.startsWith('partition-') &&
      w.orientation==='x')!
    const upper=doc.assembly.elements.filter(e=>e.wallId===through.wallId &&
      e.elementId.includes(':plate-top-2'))
    expect(upper).toHaveLength(2)
    doc.assembly.elements.splice(doc.assembly.elements.indexOf(upper[0]),1)
    expect(validateTopPlateLaps(doc).map(i=>i.code))
      .toContain('TOP_PLATE_INTERSECTION_LAP_MISSING')
  })
  it('flags a geometric first-layer gap regardless of any top-level validity metadata',()=>{
    const doc=make([])
    const first=cap(doc,'plan-front:plate-top-1')
    first.lengthMm=2000
    expect(validateTopPlateLaps(doc).map(i=>i.code))
      .toContain('TOP_PLATE_FIRST_COURSE_GAP')
  })
})
