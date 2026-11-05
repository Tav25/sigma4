import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
const create=()=>{
 const store=createProjectStore(createProjectFromCurrentState({
   projectId:'interior-wall-tests',length:6000,height:2700,spacing:600,openings:[],
 }))
 for(const point of [p(0,0),p(6000,0),p(6000,-4000),p(0,-4000)]){
   expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
 }
 expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
 return store
}
const w=(id:string,start= p(3000,0),end=p(3000,-4000))=>
 ({id,start,end,thicknessMm:100})
describe('SIGMA4 0.1.1 atomic commands for inner walls',()=>{
 it('saves, exports, imports and undoes a partition without modifying the frame',()=>{
   const store=create()
   const boards=JSON.stringify(store.getSnapshot().assembly.elements)
   expect(store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:w('I001')}}).success).toBe(true)
   const saved=store.exportJson()
   expect(JSON.parse(saved).building.floorPlan.interiorWalls).toEqual([w('I001')])
   expect(JSON.stringify(store.getSnapshot().assembly.elements)).toEqual(boards)
   expect(store.undo().success).toBe(true)
   expect(store.getSnapshot().building.floorPlan?.interiorWalls).toEqual([])
   expect(store.redo().success).toBe(true)
   const copy=create()
   expect(copy.importJson(saved).success).toBe(true)
   expect(copy.getSnapshot().building.floorPlan?.interiorWalls).toEqual([w('I001')])
 })
 it('validates edits atomically and allows changing length by moving an anchored end',()=>{
   const store=create()
   store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:w('I001')}})
   const before=store.exportJson()
   const bad=store.dispatch({type:'PLAN_UPDATE_INTERIOR_WALL',payload:{
     id:'I001',start:p(3000,1000),end:p(3000,-4000),thicknessMm:100,
   }})
   expect(bad.success).toBe(false)
   expect(store.exportJson()).toBe(before)
   expect(store.dispatch({type:'PLAN_UPDATE_INTERIOR_WALL',payload:{
     id:'I001',start:p(3500,0),end:p(3500,-4000),thicknessMm:150,
   }}).success).toBe(true)
   expect(store.getSnapshot().building.floorPlan?.interiorWalls[0].thicknessMm).toBe(150)
 })
 it('preserves dependent T-joints, disallows orphaning them, supports safe removal',()=>{
   const store=create()
   expect(store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:w('I001')}}).success).toBe(true)
   expect(store.dispatch({type:'PLAN_ADD_INTERIOR_WALL',payload:{wall:w('I002',p(0,-2000),p(3000,-2000))}}).success).toBe(true)
   const before=store.exportJson()
   expect(store.dispatch({type:'PLAN_REMOVE_INTERIOR_WALL',payload:{id:'I001'}}).success).toBe(false)
   expect(store.exportJson()).toBe(before)
   expect(store.dispatch({type:'PLAN_REMOVE_INTERIOR_WALL',payload:{id:'I002'}}).success).toBe(true)
   expect(store.dispatch({type:'PLAN_REMOVE_INTERIOR_WALL',payload:{id:'I001'}}).success).toBe(true)
 })
 it('blocks bad imported inner walls before modifying valid project',()=>{
   const store=create()
   const json=store.exportJson()
   const bad=JSON.parse(json)
   bad.building.floorPlan.interiorWalls=[w('I001',p(1000,1000),p(4000,1000))]
   expect(store.importJson(JSON.stringify(bad)).success).toBe(false)
   expect(store.exportJson()).toBe(json)
 })
})
