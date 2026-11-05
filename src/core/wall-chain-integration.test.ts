import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { createProjectStore } from './ProjectStore'
import { chainJointOrigin, previewChainClosure, rotatedDirection, wallFrameInsets } from './wall-chain'
import { calculateWorldBounds } from '../scene/view-bounds'
import { projectToScene } from '../scene/project-to-scene'
import { wallFootprint } from './wall-topology'
import type { Wall, WallConnection, ProjectDocument } from './project'

function starter() {
  const doc=createProjectFromCurrentState({projectId:'chain-roundtrip',
    length:6000,height:2700,spacing:600,openings:[]})
  return createProjectStore(doc)
}
function add(store:ReturnType<typeof starter>,turn:'right'|'straight'|'left',len:number) {
  const doc=store.getSnapshot(),parent=doc.building.walls[doc.building.walls.length-1]
  const direction=rotatedDirection(parent.orientation as 'x'|'z'|'-x'|'+z',turn)
  const wallId='wall-'+String(doc.building.walls.length+1).padStart(3,'0')
  const draft:Wall={...parent,wallId,orientation:direction,lengthMm:len,
    sectionMm:{...parent.sectionMm},openings:[]}
  const first=doc.building.walls.length===1
  const connection:WallConnection={fromWallId:parent.wallId,toWallId:wallId,
    type:first?'california-right':turn==='right'?'chain-turn-right'
      :turn==='left'?'chain-turn-left':'end-to-end'}
  const origin=first?{x:6000,y:0,z:-145}:chainJointOrigin(parent,draft,turn)
  const result=store.dispatch({type:'ADD_WALL',payload:{wall:{...draft,origin},connection}})
  expect(result.success,result.messageRu).toBe(true)
}
function closeRect() {
  const store=starter()
  add(store,'right',3000)
  add(store,'right',6000)
  return store
}
function footprints(doc:ProjectDocument) {
  return doc.building.walls.map(w=>wallFootprint(w,wallFrameInsets(doc,w.wallId)))
}
describe('S07 option 1: sequential, exact, physically nonintersecting closed wall chain',()=>{
  it('closes 6000x3145 mm rectangle from 6000,3000,6000 and a calculated 3145 segment',()=>{
    const store=closeRect()
    expect(previewChainClosure(store.getSnapshot())).toEqual({
      valid:true,direction:'+z',lengthMm:3145,reason:''})
    const result=store.dispatch({type:'CLOSE_CHAIN',payload:{}})
    expect(result.success,result.messageRu).toBe(true)
    const doc=store.getSnapshot()
    expect(doc.validation.valid).toBe(true)
    expect(doc.building.walls.map(w=>[w.orientation,w.lengthMm,w.origin.x,w.origin.z]))
      .toEqual([
        ['x',6000,0,0],['z',3000,6000,-145],
        ['-x',6000,6000,-3145],['+z',3145,0,-3145],
      ])
    expect(doc.building.connections?.map(c=>c.type)).toEqual([
      'california-right','chain-turn-right','chain-turn-right'])
    expect(doc.building.closure).toEqual({
      fromWallId:'wall-004',toWallId:'wall-001',type:'butt-right'})
    expect(wallFrameInsets(doc,'wall-003')).toEqual({startMm:145,endMm:0})
    expect(wallFrameInsets(doc,'wall-004')).toEqual({startMm:145,endMm:145})
    const bounds=calculateWorldBounds(projectToScene(doc).elements)
    expect(bounds.min.x*1000).toBeCloseTo(0,5)
    expect(bounds.max.x*1000).toBeCloseTo(6000,5)
    expect(bounds.min.z*1000).toBeCloseTo(-3145,5)
    expect(bounds.max.z*1000).toBeCloseTo(0,5)
    const footprintsArr=footprints(doc)
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
      if(i===0&&j===1)continue // existing certified California joint
      const a=footprintsArr[i],b=footprintsArr[j]
      const dx=Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)
      const dz=Math.min(a.maxZ,b.maxZ)-Math.max(a.minZ,b.minZ)
      expect(dx>0.01&&dz>0.01).toBe(false)
    }
    expect(new Set(doc.assembly.elements.map(e=>e.elementId)).size).toBe(doc.assembly.elements.length)
    const json=store.exportJson()
    const clone=starter()
    expect(clone.importJson(json).success).toBe(true)
    expect(clone.exportJson()).toBe(json)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.closure).toBeUndefined()
    expect(store.getSnapshot().building.walls).toHaveLength(3)
    expect(store.redo().success).toBe(true)
    expect(store.getSnapshot().building.closure?.fromWallId).toBe('wall-004')
  })
  it('prevents early/misaligned closure and corrupted closed JSON',()=>{
    const store=starter()
    expect(previewChainClosure(store.getSnapshot()).valid).toBe(false)
    add(store,'right',3000)
    expect(store.dispatch({type:'CLOSE_CHAIN',payload:{}}).success).toBe(false)
    add(store,'right',5500)
    expect(previewChainClosure(store.getSnapshot()).valid).toBe(false)
    const bad=store.exportJson()
    expect(store.dispatch({type:'CLOSE_CHAIN',payload:{}}).success).toBe(false)
    expect(store.exportJson()).toBe(bad)
  })
  it('rejects illegal overlaps and length changes after closure without corrupting history',()=>{
    const store=closeRect()
    expect(store.dispatch({type:'CLOSE_CHAIN',payload:{}}).success).toBe(true)
    const saved=store.exportJson()
    const change=store.dispatch({type:'SET_WALL_LENGTH',
      payload:{wallId:'wall-003',lengthMm:5700}})
    expect(change.success).toBe(false)
    expect(store.exportJson()).toBe(saved)
    expect(store.dispatch({type:'REOPEN_CHAIN',payload:{}}).success).toBe(true)
    expect(store.getSnapshot().building.closure).toBeUndefined()
    expect(store.getSnapshot().building.walls).toHaveLength(3)
    expect(store.undo().success).toBe(true)
    expect(store.getSnapshot().building.closure?.fromWallId).toBe('wall-004')
  })
  it('works with independent windows on -X and +Z after closing',()=>{
    const store=closeRect()
    expect(store.dispatch({type:'CLOSE_CHAIN',payload:{}}).success).toBe(true)
    for(const [id,wallId] of [['W04','wall-003'],['W05','wall-004']] as const){
      const result=store.dispatch({type:'ADD_OPENING',payload:{wallId,
        opening:{id,type:'window',positionXmm:700,widthMm:650,
          heightMm:900,sillHeightMm:850}}})
      expect(result.success,result.messageRu).toBe(true)
    }
    expect(store.getSnapshot().validation.valid).toBe(true)
    const rendered=projectToScene(store.getSnapshot())
    expect(rendered.sceneOpenings.map(w=>w.wallOrientation)).toEqual(['-x','+z'])
    expect(new Set(store.getSnapshot().assembly.elements.map(x=>x.elementId)).size)
      .toBe(store.getSnapshot().assembly.elements.length)
  })
})
