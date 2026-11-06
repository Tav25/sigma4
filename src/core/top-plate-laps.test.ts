import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { projectToScene } from '../scene/project-to-scene'
import { buildHorizontalCut } from './horizontal-cut'
import { calculateWorldBounds } from '../scene/view-bounds'
import type { Opening, ProjectDocument } from './project'

const point=(xMm:number,zMm:number)=>({xMm,zMm})
type Segment=readonly [ReturnType<typeof point>,ReturnType<typeof point>]
function frame(edges:readonly Segment[],withDoor=false) {
  const store=createProjectStore(createProjectFromCurrentState({
    length:6000,height:2700,spacing:600,openings:[],
    projectId:'cap-lap-regression',projectName:'Haun cap joints',
  }))
  for(const p of [point(0,0),point(10000,0),point(10000,-7000),point(0,-7000)])
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point:p}}).success).toBe(true)
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  for(const [start,end] of edges) {
    const r=store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start,end,thicknessMm:100,
    }})
    expect(r.success,r.messageRu).toBe(true)
  }
  expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
  if(withDoor) {
    const door:Opening={
      id:'D01',wallId:'partition-I001',type:'door',
      positionUmm:1200,widthMm:900,heightMm:2100,sillHeightMm:0,
    }
    const result=store.dispatch({type:'PLAN_FRAME_SAVE_OPENING',payload:{opening:door}})
    expect(result.success,result.messageRu).toBe(true)
  }
  const built=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
  expect(built.success,built.messageRu).toBe(true)
  const doc=store.getSnapshot()
  expect(doc.validation.valid).toBe(true)
  return{store,doc}
}
const upper=(doc:ProjectDocument)=>doc.assembly.elements.filter(e=>e.role==='top-plate'&&e.elementId.includes(':plate-top-2'))
function assertNoUpperCollisions(doc:ProjectDocument) {
  const elems=projectToScene(doc).elements.filter(e=>{
    if(e.role==='top-plate') return e.id.includes(':plate-top-2')
    return false
  })
  const boxes=elems.map(e=>({e,box:calculateWorldBounds([e])}))
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j]
    const overlap=(['x','y','z'] as const).map(axis=>
      Math.min(a.box.max[axis],b.box.max[axis])-
      Math.max(a.box.min[axis],b.box.min[axis]))
    expect(overlap.every(n=>n>0.000001),
      'Upper caps penetrate: '+a.e.id+' & '+b.e.id).toBe(false)
  }
}
function hasContact(doc:ProjectDocument,one:string,two:string):boolean {
  const scene=projectToScene(doc).elements
  const a=scene.find(e=>e.id===one),b=scene.find(e=>e.id===two)
  if(!a||!b)return false
  const A=calculateWorldBounds([a]),B=calculateWorldBounds([b])
  const overlap=(['x','y','z'] as const).map(axis=>
    Math.min(A.max[axis],B.max[axis])-Math.max(A.min[axis],B.min[axis]))
  return overlap.every(v=>v>=-1e-6)&&overlap[1]>0.04 &&
    overlap.filter((_,i)=>i!==1).some(v=>Math.abs(v)<1e-6)
}
function assertRealUpperJoin(doc:ProjectDocument) {
  const exterior=upper(doc)
  const tied=exterior.filter(el=>el.wallId.startsWith('partition-')&&
    el.connectionIds.some(id=>id.includes(':plate-top-2')))
  expect(tied.length).toBeGreaterThan(0)
  for(const el of tied){
    for(const target of el.connectionIds.filter(id=>id.includes(':plate-top-2'))){
      expect(hasContact(doc,el.elementId,target),
        'Upper cap has logical link but NO physical touching: '+el.elementId+' -> '+target).toBe(true)
    }
  }
}

describe('SIGMA4 v0.1.20: Haun top-plate lapping at junctions',()=>{
  it('makes two top courses for every linked interior wall, with full-height studs',()=>{
    const {doc}=frame([[point(0,-3000),point(4000,-3000)],
      [point(4000,-3000),point(4000,0)]])
    for(const w of doc.building.walls.filter(w=>w.wallId.startsWith('partition-'))){
      const caps=upper(doc).filter(e=>e.wallId===w.wallId)
      expect(caps.length).toBeGreaterThanOrEqual(1)
      const lower=doc.assembly.elements.find(e=>
        e.wallId===w.wallId&&e.elementId===w.wallId+':plate-top-1')
      expect(lower).toBeTruthy()
      const normal=doc.assembly.elements.find(e=>e.wallId===w.wallId&&
        e.elementId.startsWith(w.wallId+':stud-'))
      expect(normal?.lengthMm).toBe(2565)
      expect(lower?.position.y).toBe(2632.5)
      expect(caps[0].position.y).toBe(2677.5)
    }
    expect(doc.assembly.elements.find(e=>e.elementId==='plan-front:plate-top-1')?.lengthMm)
      .toBe(10000)
    assertNoUpperCollisions(doc)
    assertRealUpperJoin(doc)
  })
  it('cuts host upper cap at external tee and crosses the channel with the branch',()=>{
    const {doc,store}=frame([[point(4200,0),point(4200,-2500)]])
    const front=upper(doc).filter(e=>e.wallId==='plan-front').sort((a,b)=>a.position.x-b.position.x)
    expect(front).toHaveLength(2)
    expect(front[0].position.x).toBe(145)
    expect(front[0].lengthMm).toBe(4005)
    expect(front[1].position.x).toBe(4250)
    const butt=upper(doc).find(e=>e.wallId.startsWith('partition-'))!
    expect(butt.lengthMm).toBe(2500)
    expect(butt.connectionIds.some(id=>id==='plan-front:plate-top-2')).toBe(true)
    expect(front.every(e=>hasContact(doc,butt.elementId,e.elementId))).toBe(true)
    assertNoUpperCollisions(doc)
    const json=store.exportJson()
    expect(store.importJson(json).success).toBe(true)
    expect(store.exportJson()).toBe(json)
  })
  it('connects L corner and both exterior receivers without penetrating wood',()=>{
    const {doc}=frame([[point(0,-3000),point(4000,-3000)],
      [point(4000,-3000),point(4000,0)]],true)
    const lower=buildHorizontalCut(projectToScene(doc).elements,2635)
    const upperCut=buildHorizontalCut(projectToScene(doc).elements,2680)
    expect(lower.pieces.filter(p=>p.role==='top-plate').length).toBe(6)
    expect(upperCut.pieces.filter(p=>p.role==='top-plate').length).toBeGreaterThan(6)
    const walls=doc.building.walls.filter(w=>w.wallId.startsWith('partition-'))
    expect(walls).toHaveLength(2)
    expect(doc.assembly.elements.filter(e=>e.elementId.includes(':partition-backing-'))).toHaveLength(6)
    const kings=doc.assembly.elements.filter(e=>e.wallId==='partition-I001'&&e.role==='king-stud')
    expect(kings).toHaveLength(2)
    expect(kings.every(e=>e.lengthMm===2565)).toBe(true)
    const aboveHeader=doc.assembly.elements.filter(e=>e.wallId==='partition-I001'&&e.role==='cripple-top')
    expect(aboveHeader.every(e=>e.position.y+e.lengthMm<=2610)).toBe(true)
    assertNoUpperCollisions(doc)
    assertRealUpperJoin(doc)
  })
  it('joins graph-split interior T with a perpendicular cap across both through fragments',()=>{
    const {doc}=frame([[point(0,-3000),point(10000,-3000)],
      [point(4000,0),point(4000,-3000)]])
    const ids=doc.building.walls.filter(w=>w.wallId.startsWith('partition-')).map(w=>w.wallId)
    // An authored T contains three editable graph edges, but only TWO
    // physical wall runs: the collinear arms form one continuous through-wall.
    expect(ids).toHaveLength(2)
    const transverse=doc.building.walls.find(w=>w.orientation==='z'&&ids.includes(w.wallId))!
    const transverseCap=upper(doc).find(e=>e.wallId===transverse.wallId)!
    expect(transverseCap.lengthMm).toBe(transverse.lengthMm+145+100)
    assertNoUpperCollisions(doc)
    assertRealUpperJoin(doc)
  })
  it('joins 4-arm X at one centre seam, with 2 through and 2 butt upper caps',()=>{
    const {doc}=frame([[point(0,-3000),point(10000,-3000)],
      [point(4000,0),point(4000,-7000)]])
    expect(doc.building.walls.filter(w=>w.wallId.startsWith('partition-'))).toHaveLength(4)
    expect(doc.validation.valid).toBe(true)
    assertNoUpperCollisions(doc)
    assertRealUpperJoin(doc)
    const caps=upper(doc).filter(e=>e.wallId.startsWith('partition-'))
    expect(caps).toHaveLength(4)
    const verticals=doc.building.walls.filter(w=>w.wallId.startsWith('partition-')&&w.orientation==='z')
    for(const wall of verticals) {
      const cap=caps.find(el=>el.wallId===wall.wallId)!
      expect(cap.lengthMm).toBe(wall.lengthMm+145+50)
    }
  })
})
