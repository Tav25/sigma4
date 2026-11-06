import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { defaultGarageDoorSpec } from './garage-door'
import { headerProfile, validateOpeningHeaderInputs, verifyOpeningFraming, verifyHeaderLoadInputs } from './opening-profiles'
import { projectToScene } from '../scene/project-to-scene'
import { calculateWorldBounds } from '../scene/view-bounds'
import { buildHorizontalCut } from './horizontal-cut'
import type { Opening, ProjectDocument } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
const base=()=>createProjectStore(createProjectFromCurrentState({
  projectId:'stage3-opening-geometry',length:6000,height:2700,spacing:600,openings:[],
}))
function framed(openings:Opening[],withRoom=false){
  const store=base()
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  if(withRoom){
    for(const [start,end] of [[p(0,-3000),p(4000,-3000)],[p(4000,-3000),p(4000,0)]]){
      expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',
        payload:{start,end,thicknessMm:100}}).success).toBe(true)
    }
    expect(store.dispatch({type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}}).success).toBe(true)
  }
  for(const opening of openings){
    const r=store.dispatch({type:'PLAN_FRAME_SAVE_OPENING',payload:{opening}})
    expect(r.success,r.messageRu).toBe(true)
  }
  const result=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
  expect(result.success,JSON.stringify(result)).toBe(true)
  return {store,doc:store.getSnapshot()}
}
const find=(doc:ProjectDocument,id:string)=>doc.assembly.elements.find(e=>e.elementId===id)!
const bounds=(doc:ProjectDocument,id:string)=>calculateWorldBounds(
  projectToScene(doc).elements.filter(e=>e.id===id))
function contact(a:ReturnType<typeof bounds>,b:ReturnType<typeof bounds>,axis:'x'|'y'|'z'){
  return Math.min(a.max[axis],b.max[axis])-Math.max(a.min[axis],b.min[axis])
}

describe('SIGMA4 S16: explicit opening profiles, supports and load demands',()=>{
  it('keeps a default two-ply exterior profile and legacy garage preliminary profile',()=>{
    const wall={wallId:'plan-front',sectionMm:{width:45,height:145}}
    expect(headerProfile({id:'W',wallId:'plan-front',type:'window',
      positionUmm:900,widthMm:1200,heightMm:1000,sillHeightMm:900},wall))
      .toEqual({kind:'bearing-double-preview',depthMm:145,jackCount:1,kingCount:1})
    const garage=defaultGarageDoorSpec()
    expect(headerProfile({id:'G',wallId:'plan-front',type:'garage-door',
      positionUmm:2000,widthMm:2438,heightMm:2134,sillHeightMm:0,garage},wall))
      .toEqual({kind:'garage-engineered-preview',depthMm:286,jackCount:2,kingCount:1})
    expect(headerProfile({id:'D',wallId:'partition-I001',type:'door',
      positionUmm:1200,widthMm:900,heightMm:2100,sillHeightMm:0},
      {wallId:'partition-I001',sectionMm:{width:45,height:100}}))
      .toEqual({kind:'nonbearing-flat',depthMm:45,jackCount:0,kingCount:1})
  })
  it('creates custom 235 mm header on two jack posts/side for exterior window',()=>{
    const opening:Opening={id:'W01',wallId:'plan-front',type:'window',
      positionUmm:2300,widthMm:1200,heightMm:1000,sillHeightMm:900,
      headerPreview:{depthMm:235,jackStudsPerSide:2},
      designLoads:{permanentKNPerM:3,variableKNPerM:2},
    }
    const {doc,store}=framed([opening])
    expect(doc.validation.valid).toBe(true)
    expect(doc.validation.engineeringStatus).toBe('not_evaluated')
    const wall=doc.building.walls.find(w=>w.wallId==='plan-front')!
    const header=find(doc,'plan-front:W01-header-1')
    expect(header.sectionMm).toEqual({width:45,height:235})
    expect(header.lengthMm).toBe(1380)
    expect(header.position).toEqual({x:2210,y:1900,z:-50})
    expect(find(doc,'plan-front:W01-header-2').position.z).toBe(50)
    expect(find(doc,'plan-front:W01-king-left').position.x).toBe(2187.5)
    expect(find(doc,'plan-front:W01-jack-left-2').position.x).toBe(2232.5)
    expect(find(doc,'plan-front:W01-jack-right-2').position.x).toBe(3567.5)
    for(const suffix of ['jack-left','jack-left-2','jack-right','jack-right-2']){
      const jack=find(doc,'plan-front:W01-'+suffix)
      expect(jack.role).toBe('jack-stud')
      expect(jack.position.y+jack.lengthMm).toBe(1900)
      expect(jack.connectionIds).toContain('plan-front:W01-header-1')
      const overlap=contact(bounds(doc,jack.elementId),bounds(doc,header.elementId),'x')
      expect(overlap).toBeGreaterThan(0.04)
      expect(contact(bounds(doc,jack.elementId),bounds(doc,header.elementId),'y'))
        .toBeCloseTo(0,7)
    }
    const warnings=doc.validation.issues.filter(i=>i.code==='HEADER_DEMAND_REQUIRES_DESIGN')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].messageRu).toContain('0.90 кН·м')
    expect(warnings[0].messageRu).toContain('3.00 кН')
    expect(verifyOpeningFraming(opening,wall,doc.assembly.elements)).toEqual([])
    const cut=buildHorizontalCut(projectToScene(doc).elements,1950)
    expect(cut.pieces.filter(e=>e.elementId.includes('W01-header-'))).toHaveLength(2)
    const before=store.exportJson()
    expect(store.importJson(before).success).toBe(true)
    expect(store.exportJson()).toBe(before)
  })
  it('preserves 2 jack supports and safety notices for 8-foot garage door',()=>{
    const opening:Opening={id:'G01',wallId:'plan-back',type:'garage-door',
      positionUmm:2200,widthMm:2438,heightMm:2134,sillHeightMm:0,
      garage:defaultGarageDoorSpec(),
    }
    const {doc}=framed([opening])
    const wall=doc.building.walls.find(w=>w.wallId==='plan-back')!
    expect(verifyOpeningFraming(opening,wall,doc.assembly.elements)).toEqual([])
    expect(doc.assembly.elements.filter(e=>
      e.wallId==='plan-back'&&e.role==='jack-stud')).toHaveLength(4)
    expect(doc.validation.issues.some(i=>i.code==='GARAGE_LINTEL_REQUIRES_ENGINEERING')).toBe(true)
    expect(doc.validation.issues.some(i=>i.code==='HEADER_LOADS_UNSPECIFIED')).toBe(true)
  })
  it('does not invent a load-bearing header for an interior nonbearing doorway',()=>{
    const door:Opening={id:'D01',wallId:'partition-I001',type:'door',
      positionUmm:1200,widthMm:900,heightMm:2100,sillHeightMm:0}
    const {doc}=framed([door],true)
    const wall=doc.building.walls.find(w=>w.wallId==='partition-I001')!
    expect(verifyOpeningFraming(doc.building.openings.find(o=>o.id==='D01')!,wall,doc.assembly.elements)).toEqual([])
    expect(doc.validation.issues.some(i=>i.code==='HEADER_LOADS_UNSPECIFIED'&&
      i.affectedIds.includes('D01'))).toBe(false)
    expect(find(doc,'partition-I001:D01-header').sectionMm.width).toBe(45)
  })
  it('rejects invalid author-supplied header profiles and unsupported nonbearing load inputs',()=>{
    const normal:Opening={id:'D01',wallId:'plan-front',type:'door',
      positionUmm:1800,widthMm:900,heightMm:2100,sillHeightMm:0,
      headerPreview:{depthMm:700,jackStudsPerSide:0}}
    expect(validateOpeningHeaderInputs(normal,false).map(i=>i.code)).toContain('HEADER_PREVIEW_INVALID')
    const wrong={...normal,wallId:'partition-I001',
      headerPreview:{depthMm:145,jackStudsPerSide:1},
      designLoads:{permanentKNPerM:1,variableKNPerM:1}}
    expect(validateOpeningHeaderInputs(wrong,true).map(i=>i.code))
      .toEqual(expect.arrayContaining(['HEADER_PROFILE_INCOMPATIBLE','HEADER_LOADS_INVALID']))
    const noLoad:Opening={...normal,headerPreview:undefined,designLoads:undefined}
    expect(verifyHeaderLoadInputs(noLoad,{wallId:'plan-front',sectionMm:{width:45,height:145}} as any)
      .map(i=>i.code)).toContain('HEADER_LOADS_UNSPECIFIED')
    const {store}=framed([])
    const json=store.exportJson()
    const invalid=JSON.parse(json)
    invalid.building.floorPlan.frame.openings=[normal]
    expect(store.importJson(JSON.stringify(invalid)).success).toBe(false)
    expect(store.exportJson()).toBe(json)
  })
})
