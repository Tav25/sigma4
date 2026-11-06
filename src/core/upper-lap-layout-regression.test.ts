import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { graphView } from './plan-graph'
import { buildHorizontalCut } from './horizontal-cut'
import { projectToScene } from '../scene/project-to-scene'
import type { Opening } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
function reproduce(reverse=false,door=false,style:'whole'|'upper-first'|'lower-first'|'branch-first'='whole'){
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'9x6-northwest-tee',projectName:'Northwest room 3x3.25',
    length:6000,height:2700,spacing:600,openings:[],
  }))
  for(const point of [p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)]){
    const r=store.dispatch({type:'PLAN_ADD_POINT',payload:{point}})
    expect(r.success,r.messageRu).toBe(true)
  }
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  // The screenshot: northwest room, wall x=3000 continues from back (Z=-6000)
  // across the T-junction at Z=-3250 all the way to the front wall Z=0.
  const full=[p(3000,-6000),p(3000,0)]
  const upper=[p(3000,-6000),p(3000,-3250)]
  const lower=[p(3000,-3250),p(3000,0)]
  const branch=[p(0,-3250),p(3000,-3250)]
  const oriented=(segment:ReturnType<typeof p>[])=>reverse?segment.slice().reverse():segment
  const sequence=style==='whole'?[full,branch]:
    style==='upper-first'?[upper,lower,branch]:
    style==='lower-first'?[lower,branch,upper]:
    [branch,lower,upper]
  for(const [start,end] of sequence.map(oriented)){
    const r=store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}})
    expect(r.success,r.messageRu).toBe(true)
  }
  const plan=store.getSnapshot().building.floorPlan!
  const pieces=graphView(plan).interiorWalls
  expect(pieces).toHaveLength(3)
  expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
  if(door){
    const top=pieces.find(e=>e.start.xMm===3000 && e.end.xMm===3000 &&
      Math.min(e.start.zMm,e.end.zMm)===-6000)!
    expect(top).toBeTruthy()
    const localU=top.start.zMm===-6000?1200:1550
    const opening:Opening={
      id:'D01',type:'door',wallId:'partition-'+top.id,
      positionUmm:localU,widthMm:900,heightMm:2100,sillHeightMm:0,
    }
    const added=store.dispatch({type:'PLAN_FRAME_SAVE_OPENING',payload:{opening}})
    expect(added.success,JSON.stringify(added)).toBe(true)
  }
  const result=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
  expect(result.success,
    JSON.stringify({message:result.messageRu,issues:result.validation?.issues?.filter(i=>i.severity==='error')},null,2)
  ).toBe(true)
  const doc=store.getSnapshot()
  expect(doc.validation.valid).toBe(true)
  const caps=doc.assembly.elements.filter(e=>e.role==='top-plate'&&
    e.elementId.includes(':plate-top-2'))
  expect(caps.filter(e=>e.wallId.startsWith('partition-'))).toHaveLength(3)
  expect(buildHorizontalCut(projectToScene(doc).elements,2680).pieces.length).toBeGreaterThan(0)
  const json=store.exportJson()
  expect(store.importJson(json).success).toBe(true)
  expect(store.exportJson()).toBe(json)
}
describe('SIGMA4: upper plate laps on screenshot 9x6 / 3x3.25 northwest room',()=>{
  it('supports upper-left room T with vertical through-wall',()=>reproduce(false,false))
  it('supports upper-left room T and door D01',()=>reproduce(false,true))
  it('supports reversed vertical and horizontal construction order',()=>reproduce(true,false))
  it('supports reversed construction order with door D01',()=>reproduce(true,true))
  it.each(['upper-first','lower-first','branch-first'] as const)(
    'builds separately drawn walls (%s) with door, both directions',(style)=>{
      reproduce(false,true,style)
      reproduce(true,true,style)
    })
  it.each(['upper-first','lower-first','branch-first'] as const)(
    'builds separately drawn walls (%s) without door, both directions',(style)=>{
      reproduce(false,false,style)
      reproduce(true,false,style)
    })
})
