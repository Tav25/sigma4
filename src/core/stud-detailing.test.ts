import { describe, expect, it } from 'vitest'
import { centersBetween } from './stud-detailing'
import { generateWallPanel } from './wall'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { defaultGarageDoorSpec } from './garage-door'
import { graphView } from './plan-graph'
import { projectToScene } from '../scene/project-to-scene'
import { buildHorizontalCut } from './horizontal-cut'
import type { ProjectDocument, Opening } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
const EPS=0.002
const reg=(doc:ProjectDocument,id:string)=>doc.assembly.elements
  .filter(e=>e.wallId===id&&e.role==='stud'&&e.elementId.includes(':stud-layout-'))
const at=(doc:ProjectDocument,id:string)=>doc.assembly.elements.filter(e=>e.wallId===id)
function assertIndependentBays(doc:ProjectDocument,wallId:string) {
  const wall=doc.building.walls.find(w=>w.wallId===wallId)!
  const all=at(doc,wallId)
  const ends=[all.find(e=>e.elementId===wallId+':stud-01')!,
    all.find(e=>e.elementId===wallId+':stud-02')!]
  expect(ends.every(Boolean)).toBe(true)
  const limits=[ends[0].position.x,...reg(doc,wallId).map(e=>e.position.x),ends[1].position.x].sort((a,b)=>a-b)
  expect(limits[0]).toBeCloseTo(wall.sectionMm.width/2,5)
  expect(limits.at(-1)).toBeCloseTo(wall.lengthMm-wall.sectionMm.width/2,5)
  expect(reg(doc,wallId).every(e=>
    e.lengthMm===wall.heightMm-3*wall.sectionMm.width &&
    e.position.y===wall.sectionMm.width)).toBe(true)
  for(const opening of doc.building.openings.filter(o=>o.wallId===wallId)) {
    const left=all.find(e=>e.elementId===wallId+':'+opening.id+'-king-left')!
    const right=all.find(e=>e.elementId===wallId+':'+opening.id+'-king-right')!
    expect(left&&right).toBeTruthy()
    expect(reg(doc,wallId).every(e=>e.position.x<=left.position.x+EPS ||
      e.position.x>=right.position.x-EPS)).toBe(true)
  }
  for(const board of reg(doc,wallId)){
    const occupied=all.filter(e=>e.elementId!==board.elementId&&
      (e.role==='stud'||e.role==='king-stud'||e.role==='jack-stud'||e.role==='corner-backing'))
    const overlap=occupied.filter(e=>{
      const width=e.orientation.mode==='y'&&e.orientation.roll===90?
        e.sectionMm.height:e.sectionMm.width
      const min=e.orientation.mode==='y'&&e.orientation.roll===90?
        e.position.x:e.position.x-width/2
      return Math.min(board.position.x+board.sectionMm.width/2,min+width)-
        Math.max(board.position.x-board.sectionMm.width/2,min)>EPS
    })
    expect(overlap.map(e=>e.elementId),'Overlapping regular stud '+board.elementId).toEqual([])
  }
}
function garage(edges:readonly (readonly [ReturnType<typeof p>,ReturnType<typeof p>])[]=[],
  openings:readonly Opening[]=[]){
  const store=createProjectStore(createProjectFromCurrentState({
    length:6000,height:2700,spacing:600,openings:[],
    projectId:'haun-detailing-stage-2',projectName:'Detailing bays',
  }))
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  for(const [start,end] of edges)
    expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}}).success).toBe(true)
  if(edges.length)expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
  for(const opening of openings){
    const result=store.dispatch({type:'PLAN_FRAME_SAVE_OPENING',payload:{opening}})
    expect(result.success,result.messageRu).toBe(true)
  }
  const built=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
  expect(built.success,JSON.stringify(built)).toBe(true)
  const doc=store.getSnapshot()
  expect(doc.validation.valid).toBe(true)
  return {doc,store}
}

describe('SIGMA4 S15: required posts before regular stud infill',()=>{
  it('keeps legacy standalone stud layout, but seeds only endpoints in linked mode',()=>{
    const params={length:3000,height:2700,sectionWidth:45,sectionHeight:145,spacing:600,topLayers:2}
    const legacy=generateWallPanel(params).elements.filter(e=>e.role==='stud')
    expect(legacy).toHaveLength(6)
    const required=generateWallPanel({...params,requiredFirst:true}).elements.filter(e=>e.role==='stud')
    expect(required.map(e=>e.position.x)).toEqual([22.5,2977.5])
  })
  it('resets spans at mandatory stations, with nominal on-center spacing and no tiny endpoint bay',()=>{
    expect(centersBetween(22.5,2222.5,600,45)).toEqual([622.5,1222.5,1822.5])
    expect(centersBetween(100,550,600,45)).toEqual([])
    expect(centersBetween(100,900,400,45)).toEqual([500])
    expect(()=>centersBetween(0,100,20,45)).toThrow()
  })
  it('layouts exterior wall around a window and a Haun receiving channel before filling',()=>{
    const w:Opening={id:'W01',wallId:'plan-front',type:'window',
      positionUmm:2300,widthMm:1200,heightMm:1000,sillHeightMm:900}
    const {doc,store}=garage([[p(6000,0),p(6000,-2300)]],[w])
    const front=at(doc,'plan-front')
    const channel=front.filter(e=>e.elementId.includes(':partition-backing-'))
    expect(channel).toHaveLength(3)
    const kings=front.filter(e=>e.role==='king-stud')
    expect(kings).toHaveLength(2)
    expect(reg(doc,'plan-front').length).toBeGreaterThan(5)
    assertIndependentBays(doc,'plan-front')
    const left=channel.find(e=>e.elementId.endsWith('-left'))!
    const right=channel.find(e=>e.elementId.endsWith('-right'))!
    expect(reg(doc,'plan-front').every(e=>e.position.x<left.position.x ||
      e.position.x>right.position.x)).toBe(true)
    const topCripples=front.filter(e=>e.role==='cripple-top')
    expect(topCripples).toHaveLength(1)
    expect(topCripples[0].position.x).toBeCloseTo(2922.5,5)
    const bottomCripples=front.filter(e=>e.role==='cripple-bottom')
    expect(bottomCripples.filter(e=>e.elementId.includes('-layout-'))).toHaveLength(1)
    expect(bottomCripples.filter(e=>e.elementId.includes('-layout-'))[0].position.x)
      .toBeCloseTo(2922.5,5)
    expect(front.filter(e=>e.elementId.includes(':stud-layout-')).every(e=>
      !e.connectionIds.length)).toBe(true)
    const json=store.exportJson()
    expect(store.importJson(json).success).toBe(true)
    expect(store.exportJson()).toBe(json)
    expect(store.getSnapshot().assembly).toEqual(doc.assembly)
  })
  it('works with doors, garage openings and a window in one rectangular 10x7 frame',()=>{
    const wins:Opening[]=[
      {id:'W01',wallId:'plan-front',type:'window',positionUmm:800,widthMm:1200,heightMm:1000,sillHeightMm:900},
      {id:'D01',wallId:'plan-left',type:'door',positionUmm:1800,widthMm:900,heightMm:2100,sillHeightMm:0},
      {id:'G01',wallId:'plan-back',type:'garage-door',positionUmm:2000,widthMm:2438,heightMm:2134,
        sillHeightMm:0,garage:defaultGarageDoorSpec()},
    ]
    const {doc}=garage([],wins)
    for(const wall of doc.building.walls)assertIndependentBays(doc,wall.wallId)
    expect(doc.assembly.elements.some(e=>e.elementId.includes('G01-cripple-top-layout'))).toBe(true)
    expect(doc.assembly.elements.some(e=>e.elementId.includes('W01-cripple-top-layout'))).toBe(true)
    expect(doc.assembly.elements.some(e=>e.elementId.includes('D01-cripple-top-layout'))).toBe(true)
  })
  it('handles an interior T and door without replacing the connected end studs',()=>{
    const {doc,store}=garage([
      [p(0,-3000),p(10000,-3000)],
      [p(4000,0),p(4000,-3000)],
    ],[])
    const sides=graphView(doc.building.floorPlan!).interiorWalls
    expect(sides).toHaveLength(3)
    for(const w of doc.building.walls.filter(w=>w.wallId.startsWith('partition-'))){
      assertIndependentBays(doc,w.wallId)
      expect(at(doc,w.wallId).some(e=>e.elementId.endsWith(':stud-01'))).toBe(true)
    }
    const snapshot=store.exportJson()
    expect(store.undo().success).toBe(true)
    expect(store.redo().success).toBe(true)
    expect(store.exportJson()).toBe(snapshot)
    const cut=buildHorizontalCut(projectToScene(doc).elements,1200)
    expect(cut.pieces.some(p=>p.elementId.includes('stud-layout'))).toBe(true)
  })
})
