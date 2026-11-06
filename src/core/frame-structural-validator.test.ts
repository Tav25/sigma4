import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { physicalTimberBoxes, boxesFaceContact, volumesOverlap,
  validateAssemblyContacts } from './frame-structural-validator'
import { validateProject } from './frame-validator'
import type { Opening, ProjectDocument } from './project'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
const clone=(doc:ProjectDocument)=>JSON.parse(JSON.stringify(doc)) as ProjectDocument
type Store=ReturnType<typeof createProjectStore>
const dispatch=(store:Store,cmd:Parameters<Store['dispatch']>[0])=>{
  const result=store.dispatch(cmd)
  expect(result.success,JSON.stringify({
    error:result.errorCode,message:result.messageRu,
    issues:result.validation?.issues.filter(i=>i.severity==='error').slice(0,5),
  })).toBe(true)
}
function linked(withRoom=true,withWindow=true){
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'S18-physical-connections',projectName:'Geometric contact validation',
    length:6000,height:2700,spacing:600,openings:[],
  }))
  for(const point of [p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)])
    dispatch(store,{type:'PLAN_ADD_POINT',payload:{point}})
  dispatch(store,{type:'PLAN_CLOSE',payload:{}})
  if(withRoom) {
    for(const [start,end] of [
      [p(0,-3300),p(4000,-3300)],
      [p(4000,-3300),p(4000,0)],
    ])
      dispatch(store,{type:'PLAN_GRAPH_ADD_EDGE',payload:{
        start,end,thicknessMm:100,
      }})
    dispatch(store,{type:'PLAN_FRAME_ENABLE_PARTITIONS',payload:{}})
    const roomDoor:Opening={
      id:'D01',wallId:'partition-I001',type:'door',positionUmm:1200,
      widthMm:900,heightMm:2100,sillHeightMm:0,
    }
    dispatch(store,{type:'PLAN_FRAME_SAVE_OPENING',payload:{opening:roomDoor}})
  }
  if(withWindow){
    const window:Opening={id:'W01',wallId:'plan-back',type:'window',
      positionUmm:2200,widthMm:1200,heightMm:1000,sillHeightMm:900,
      headerPreview:{depthMm:235,jackStudsPerSide:2},
    }
    dispatch(store,{type:'PLAN_FRAME_SAVE_OPENING',payload:{opening:window}})
  }
  dispatch(store,{type:'PLAN_FRAME_BUILD',payload:{}})
  const doc=store.getSnapshot()
  expect(doc.validation.valid).toBe(true)
  return {doc,store}
}
const code=(doc:ProjectDocument,name:string)=>
  validateAssemblyContacts(doc).filter(i=>i.code===name)
const element=(doc:ProjectDocument,match:(id:string)=>boolean)=>{
  const e=doc.assembly.elements.find(x=>match(x.elementId))
  expect(e).toBeTruthy()
  return e!
}
describe('SIGMA4 S18 independent physical joinery and support validator',()=>{
  it('accepts 10×7 outer T, upper cap overlaps, room door and heavy exterior window header',()=>{
    const {doc,store}=linked()
    const boxes=physicalTimberBoxes(doc)
    expect(boxes).toHaveLength(doc.assembly.elements.length)
    expect(validateAssemblyContacts(doc)).toEqual([])
    expect(doc.validation.engineeringStatus).toBe('not_evaluated')
    const a=boxes.find(b=>b.id==='plan-back:W01-header-1')!
    const jack=boxes.find(b=>b.id==='plan-back:W01-jack-left')!
    expect(a&&jack).toBeTruthy()
    expect(boxesFaceContact(a,jack)).toBe(true)
    expect(volumesOverlap(a,jack)).toBe(false)
    const copy=store.exportJson()
    expect(store.importJson(copy).success).toBe(true)
    expect(store.exportJson()).toBe(copy)
  })
  it('finds a real missing bottom bearing after a full-height stud moves upward',()=>{
    const {doc}=linked(false,false),bad=clone(doc)
    const stud=element(bad,id=>id.startsWith('plan-front:stud-layout-'))
    stud.position.y+=10
    expect(code(bad,'STRUCTURAL_MISSING_BOTTOM_SUPPORT')
      .some(i=>i.affectedIds.includes(stud.elementId))).toBe(true)
    expect(code(bad,'STRUCTURAL_MISSING_TOP_CONTACT')
      .some(i=>i.affectedIds.includes(stud.elementId))).toBe(true)
    expect(validateProject(bad).valid).toBe(false)
  })
  it('finds volume overlap of two otherwise legitimate adjacent vertical studs',()=>{
    const {doc}=linked(false,false),bad=clone(doc)
    const studs=bad.assembly.elements.filter(e=>e.wallId==='plan-front'&&
      e.elementId.includes(':stud-layout-')).slice(0,2)
    expect(studs).toHaveLength(2)
    studs[1].position={...studs[0].position}
    const collisions=code(bad,'STRUCTURAL_TIMBER_COLLISION')
    expect(collisions).toHaveLength(1)
    expect(collisions[0].affectedIds).toEqual(
      expect.arrayContaining([studs[0].elementId,studs[1].elementId]))
  })
  it('detects a floating second top cap even though its local X position is valid',()=>{
    const {doc}=linked(),bad=clone(doc)
    const cap=element(bad,id=>id==='plan-back:plate-top-2')
    cap.position.y+=5
    expect(code(bad,'STRUCTURAL_UPPER_PLATE_UNSUPPORTED')
      .some(i=>i.affectedIds.includes(cap.elementId))).toBe(true)
  })
  it('rejects a missing or unilateral logical Haun joint',()=>{
    const {doc}=linked(),bad=clone(doc)
    const linkedCap=bad.assembly.elements.find(e=>
      e.elementId.includes(':plate-top-2') &&
      e.connectionIds.some(id=>id.includes(':plate-top-2')))!
    expect(linkedCap).toBeTruthy()
    const other=element(bad,id=>id===linkedCap.connectionIds[0])
    other.connectionIds=other.connectionIds.filter(id=>id!==linkedCap.elementId)
    expect(code(bad,'STRUCTURAL_ONE_WAY_CONNECTION').length).toBeGreaterThan(0)
    linkedCap.connectionIds.push('missing-timber-id')
    linkedCap.connectionIds.push(linkedCap.elementId)
    linkedCap.connectionIds.push(linkedCap.elementId)
    expect(code(bad,'STRUCTURAL_INVALID_CONNECTION').length).toBe(2)
    expect(code(bad,'STRUCTURAL_DUPLICATE_CONNECTION').length).toBe(1)
  })
  it('finds a backed wall joint whose linked members have separated in 3D',()=>{
    const {doc}=linked(),bad=clone(doc)
    const flat=element(bad,id=>id.includes(':partition-backing-')&&id.endsWith('-flat'))
    expect(flat.connectionIds.length).toBeGreaterThan(0)
    // Moving the flat nailer along the wall breaks its contact with both uprights.
    flat.position.z+=120
    expect(code(bad,'STRUCTURAL_JOINT_NOT_TOUCHING').some(i=>
      i.affectedIds.includes(flat.elementId))).toBe(true)
  })
  it('finds a jack disconnected from both header plies in world coordinates',()=>{
    const {doc}=linked(),bad=clone(doc)
    const jack=element(bad,id=>id==='plan-back:W01-jack-left')
    jack.position.z+=220
    expect(code(bad,'STRUCTURAL_JACK_NOT_SUPPORTING_HEADER')
      .some(i=>i.affectedIds.includes(jack.elementId))).toBe(true)
  })
  it('finds cripple not bearing on lintel and a window sill not borne by a cripple',()=>{
    const {doc}=linked(),bad=clone(doc)
    const top=element(bad,id=>id.includes('W01-cripple-top-layout-'))
    top.position.z+=220
    expect(code(bad,'STRUCTURAL_UPPER_CRIPPLE_UNSUPPORTED')
      .some(i=>i.affectedIds.includes(top.elementId))).toBe(true)
    const bottom=element(bad,id=>id.includes('W01-cripple-bottom-layout-'))
    bottom.position.z+=220
    expect(code(bad,'STRUCTURAL_SILL_UNSUPPORTED')
      .some(i=>i.affectedIds.includes(bottom.elementId))).toBe(true)
  })
  it('does not rewrite legacy standalone assemblies or assert engineering approval',()=>{
    const doc=createProjectFromCurrentState({
      length:6000,height:2700,spacing:600,openings:[],
    })
    expect(validateAssemblyContacts(doc)).toEqual([])
    expect(validateProject(doc).engineeringStatus).toBe('not_evaluated')
  })
})
