import { describe, expect, it } from 'vitest'
import { createTimberElement, type TimberElement } from './timber'
import { buildHorizontalCut, timberCorners, timberSectionAtHeight } from './horizontal-cut'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { projectToScene } from '../scene/project-to-scene'

const element=(partial:Parameters<typeof createTimberElement>[0])=>createTimberElement(partial)
const area=(points:ReturnType<typeof timberSectionAtHeight>)=>Math.abs(points.reduce((sum,p,i)=>{
  const next=points[(i+1)%points.length]
  return sum+p.xMm*next.zMm-next.xMm*p.zMm
},0))/2
const wall=()=>projectToScene(createProjectFromCurrentState({
  projectId:'cut-geometry',length:6000,height:2700,spacing:600,openings:[],
})).elements
describe('SIGMA4 0.1.18: real horizontal plane vs 3D solid',()=>{
  it('slices real bottom plates at floor height and studs at mid-height',()=>{
    const elements=wall()
    const floor=buildHorizontalCut(elements,10)
    const mid=buildHorizontalCut(elements,1200)
    expect(floor.pieces.some(p=>p.elementId==='plate-bottom-1')).toBe(true)
    expect(floor.pieces.some(p=>p.elementId==='stud-01')).toBe(false)
    expect(mid.pieces.some(p=>p.elementId==='stud-01')).toBe(true)
    expect(mid.pieces.some(p=>p.elementId==='plate-bottom-1')).toBe(false)
    const firstStud=mid.pieces.find(p=>p.elementId==='stud-01')!
    expect(firstStud.areaMm2).toBeCloseTo(45*145,4)
    expect(firstStud.polygon).toHaveLength(4)
    expect(mid.bounds).toEqual(floor.bounds)
  })
  it('includes lower Y boundary but excludes upper; selects correct top-plate levels',()=>{
    const elements=wall()
    const start=buildHorizontalCut(elements,0)
    expect(start.pieces.some(p=>p.elementId==='plate-bottom-1')).toBe(true)
    const stud=buildHorizontalCut(elements,45)
    expect(stud.pieces.some(p=>p.elementId==='stud-01')).toBe(true)
    expect(stud.pieces.some(p=>p.elementId==='plate-bottom-1')).toBe(false)
    const upper=buildHorizontalCut(elements,2620)
    expect(upper.pieces.some(p=>p.role==='top-plate')).toBe(true)
    expect(upper.pieces.some(p=>p.elementId==='stud-01')).toBe(false)
    expect(buildHorizontalCut(elements,2700).pieces).toEqual([])
  })
  it('rotates vertical framing in an XZ oriented wall: correct physical dimensions',()=>{
    const piece:TimberElement={
      ...element({id:'rotated-stud',length:2400,width:145,height:45,
        orientation:{mode:'y',angle:0,roll:0},
        position:{x:0,y:45,z:-72.5}}),
      wallId:'wall-z',
      wallTransform:{origin:{x:5000,y:0,z:0},orientation:'z'},
    }
    const polygon=timberSectionAtHeight(piece,900)
    const dx=Math.max(...polygon.map(p=>p.xMm))-Math.min(...polygon.map(p=>p.xMm))
    const dz=Math.max(...polygon.map(p=>p.zMm))-Math.min(...polygon.map(p=>p.zMm))
    expect(dx).toBeCloseTo(45,6)
    expect(dz).toBeCloseTo(145,6)
    expect(area(polygon)).toBeCloseTo(45*145,4)
  })
  it('cuts rolled vertical stud by rotated diamond, not its larger rectangular AABB',()=>{
    const piece=element({id:'angled-stud',length:2600,width:145,height:45,
      position:{x:0,y:0,z:0},orientation:{mode:'y',angle:0,roll:45}})
    const polygon=timberSectionAtHeight(piece,1000)
    expect(polygon).toHaveLength(4)
    expect(area(polygon)).toBeCloseTo(145*45,4)
    const aabb=(Math.max(...polygon.map(p=>p.xMm))-Math.min(...polygon.map(p=>p.xMm)))*
      (Math.max(...polygon.map(p=>p.zMm))-Math.min(...polygon.map(p=>p.zMm)))
    expect(aabb).toBeGreaterThan(area(polygon)*1.3)
  })
  it('cuts a sloped board at different heights, shifting the true polygon',()=>{
    const slope=element({id:'slope',length:3000,width:145,height:45,
      orientation:{mode:'slope',angle:30,roll:0}})
    const low=timberSectionAtHeight(slope,400)
    const high=timberSectionAtHeight(slope,1000)
    expect(low.length).toBeGreaterThanOrEqual(3)
    expect(high.length).toBeGreaterThanOrEqual(3)
    const centre=(ps:typeof low)=>ps.reduce((sum,p)=>sum+p.xMm,0)/ps.length
    expect(centre(high)-centre(low)).toBeGreaterThan(800)
    expect(timberSectionAtHeight(slope,1800)).toEqual([])
  })
  it('does not return sections for invalid boards or non-intersecting heights',()=>{
    const e=element({id:'short',length:200,width:100,height:40})
    expect(timberSectionAtHeight(e,-1)).toEqual([])
    expect(timberSectionAtHeight(e,40)).toEqual([])
    expect(timberSectionAtHeight(e,0)).toHaveLength(4)
    expect(timberSectionAtHeight({...e,length:0},0)).toEqual([])
    expect(timberCorners({...e,height:-2})).toEqual([])
    expect(buildHorizontalCut([],1000).pieces).toEqual([])
  })
  it('slices both three-stud exterior receiving channels and the end stud from one project',()=>{
    const store=createProjectStore(createProjectFromCurrentState({
      projectId:'cut-garage',length:6000,height:2700,spacing:600,openings:[],
    }))
    const p=(xMm:number,zMm:number)=>({xMm,zMm})
    for(const vertex of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
      expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point:vertex}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
    for(const [start,end] of [[p(0,-3000),p(4000,-3000)],
      [p(4000,-3000),p(4000,0)]] as const)
      expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{start,end,thicknessMm:100}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}}).success).toBe(true)
    const elements=projectToScene(store.getSnapshot()).elements
    const cut=buildHorizontalCut(elements,1200)
    const receivers=cut.pieces.filter(p=>p.elementId.includes('partition-backing-'))
    expect(receivers).toHaveLength(6)
    expect(receivers.every(p=>p.areaMm2>0)).toBe(true)
    expect(receivers.filter(p=>p.elementId.endsWith('-flat')).map(p=>p.areaMm2)).toEqual([4500,4500])
    expect(receivers.filter(p=>!p.elementId.endsWith('-flat')).map(p=>p.areaMm2)).toEqual([6525,6525,6525,6525])
    expect(cut.pieces.some(p=>p.wallId.startsWith('partition-')&&p.role==='stud')).toBe(true)
    const high=buildHorizontalCut(elements,2650)
    expect(high.pieces.some(p=>p.role==='top-plate')).toBe(true)
    expect(high.pieces.some(p=>p.elementId.includes('partition-backing-'))).toBe(false)
  })
})
