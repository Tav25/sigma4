import { describe, it, expect } from 'vitest'
import {
  type FloorPlan, type PlanPoint, planWallClearances, moveInteriorWallWithDependents,
  moveWallToClearance, exteriorWallStrips, validateFloorPlan, planAreaM2,
} from './floor-plan'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'

const p=(xMm:number,zMm:number):PlanPoint=>({xMm,zMm})
const contour=[p(0,0),p(10000,0),p(10000,-8000),p(0,-8000)]
const model=():FloorPlan=>({
  exterior:contour,closed:true,interiorWalls:[
    {id:'I001',start:p(4000,0),end:p(4000,-8000),thicknessMm:150},
    {id:'I002',start:p(0,-3000),end:p(4000,-3000),thicknessMm:100},
    {id:'I003',start:p(4000,-5000),end:p(10000,-5000),thicknessMm:100},
  ],
})
function project() {
  const store=createProjectStore(createProjectFromCurrentState({
    projectId:'plan-0.1.11-tests',length:6000,height:2700,spacing:600,openings:[],
  }))
  for(const point of contour) expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
  expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
  for(const wall of model().interiorWalls)
    expect(store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall}}).success).toBe(true)
  return store
}
describe('SIGMA4 0.1.11 metric drawing and dependent wall edits',()=>{
  it('calculates both adjacent bays from real walls, not bounding-box text',()=>{
    const m=model()
    const dim=planWallClearances(m,'I001')
    expect(dim?.axis).toBe('x')
    expect(dim?.negative).toEqual({referenceMm:0,distanceMm:4000})
    expect(dim?.positive).toEqual({referenceMm:10000,distanceMm:6000})
    expect(planWallClearances(m,'I002')?.negative?.distanceMm).toBe(5000)
    expect(planWallClearances(m,'I002')?.positive?.distanceMm).toBe(3000)
  })
  it('clickable 4.00 m dimension produces 4.50 / 5.50 m and follows both T joints',()=>{
    const moved=moveWallToClearance(model(),'I001','negative',4500)!
    expect(validateFloorPlan(moved)).toEqual([])
    expect(moved.interiorWalls[0].start.xMm).toBe(4500)
    expect(moved.interiorWalls[1].end).toEqual(p(4500,-3000))
    expect(moved.interiorWalls[2].start).toEqual(p(4500,-5000))
    expect(planWallClearances(moved,'I001')?.positive?.distanceMm).toBe(5500)
    expect(planAreaM2(moved)).toBe(80)
    expect(model().interiorWalls[0].start.xMm).toBe(4000) // no mutation
  })
  it('edit from the right also moves the same dependent endpoints',()=>{
    const moved=moveWallToClearance(model(),'I001','positive',5500)!
    expect(moved.interiorWalls[0].start.xMm).toBe(4500)
    expect(moved.interiorWalls[1].end.xMm).toBe(4500)
    expect(validateFloorPlan(moved)).toEqual([])
  })
  it('supports negative (left/up) displacement, and no-op',()=>{
    expect(moveInteriorWallWithDependents(model(),'I001',-500)?.interiorWalls[0].start.xMm).toBe(3500)
    expect(moveInteriorWallWithDependents(model(),'I001',0)).toEqual(model())
    expect(moveInteriorWallWithDependents(model(),'unknown',250)).toBeNull()
    expect(moveInteriorWallWithDependents(model(),'I001',100.5)).toBeNull()
    expect(moveWallToClearance(model(),'I001','negative',100)).toBeNull()
  })
  it('does not claim a move valid if it disconnects or crosses the outside',()=>{
    const moved=moveInteriorWallWithDependents(model(),'I001',8000)!
    expect(validateFloorPlan(moved).length).toBeGreaterThan(0)
  })
  it('draws 150mm outside wall bands to the inside and respects custom width',()=>{
    const m=model()
    expect(exteriorWallStrips(m)[0]).toEqual([
      p(0,0),p(10000,0),p(10000,-150),p(0,-150),
    ])
    m.exteriorThicknessMm=200
    expect(exteriorWallStrips(m)[0][2].zMm).toBe(-200)
    expect(validateFloorPlan(m)).toEqual([])
    m.exteriorThicknessMm=25
    expect(validateFloorPlan(m).some(x=>x.includes('Толщина наружной'))).toBe(true)
    delete m.exteriorThicknessMm
    expect(validateFloorPlan(m)).toEqual([])
  })
  it('commits moves in ONE history entry, supports undo, redo and JSON roundtrip',()=>{
    const store=project()
    const assembly=JSON.stringify(store.getSnapshot().assembly.elements)
    const first=store.exportJson()
    expect(store.dispatch({type:'PLAN_SET_INTERIOR_CLEARANCE',payload:{
      id:'I001',side:'negative',distanceMm:4500,
    }}).success).toBe(true)
    const moved=store.getSnapshot().building.floorPlan!
    expect(moved.interiorWalls[0].start.xMm).toBe(4500)
    expect(moved.interiorWalls[1].end.xMm).toBe(4500)
    expect(moved.interiorWalls[2].start.xMm).toBe(4500)
    expect(JSON.stringify(store.getSnapshot().assembly.elements)).toBe(assembly)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(first)
    expect(store.redo().success).toBe(true)
    const copy=project()
    expect(copy.importJson(store.exportJson()).success).toBe(true)
    expect(copy.getSnapshot().building.floorPlan!.interiorWalls[1].end.xMm).toBe(4500)
  })
  it('saves outer wall width without rewriting prior geometry, and undo restores it',()=>{
    const store=project()
    const original=store.exportJson()
    const result=store.dispatch({type:'PLAN_SET_EXTERIOR_THICKNESS',payload:{thicknessMm:200}})
    expect(result.success).toBe(true)
    expect(store.getSnapshot().building.floorPlan!.exteriorThicknessMm).toBe(200)
    const exported=store.exportJson()
    const copy=project()
    expect(copy.importJson(exported).success).toBe(true)
    expect(copy.getSnapshot().building.floorPlan!.exteriorThicknessMm).toBe(200)
    expect(store.dispatch({type:'PLAN_SET_EXTERIOR_THICKNESS',payload:{thicknessMm:5}}).success).toBe(false)
    expect(store.exportJson()).toBe(exported)
    expect(store.undo().success).toBe(true)
    expect(store.exportJson()).toBe(original)
  })
  it('rejects invalid moves atomically and retains dependent geometry',()=>{
    const store=project()
    const original=store.exportJson()
    expect(store.dispatch({type:'PLAN_MOVE_INTERIOR_WALL',payload:{id:'I001',offsetMm:9000}}).success).toBe(false)
    expect(store.exportJson()).toBe(original)
    expect(store.dispatch({type:'PLAN_SET_INTERIOR_CLEARANCE',payload:{
      id:'I001',side:'negative',distanceMm:100,
    }}).success).toBe(false)
    expect(store.exportJson()).toBe(original)
    expect(store.dispatch({type:'PLAN_MOVE_INTERIOR_WALL',payload:{id:'I001',offsetMm:500}}).success).toBe(true)
    expect(store.getSnapshot().validation.valid).toBe(true)
  })
})
