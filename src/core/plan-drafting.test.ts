import { describe, it, expect } from 'vitest'
import { createDefaultProject } from './default-project'
import { draftingChains, outwardDoorSwingMm } from './plan-drafting'
import { deriveFloorRooms } from './rooms'
import { createProjectStore } from './ProjectStore'
import { planFrameOpeningSides } from './plan-frame'

describe('US framing plan dimension references', () => {
  it('opens the supplied 11 x 7m project with all five openings and three rooms', () => {
    const doc = createDefaultProject()
    expect(doc.building.floorPlan?.exterior).toEqual([
      {xMm:0,zMm:0},{xMm:11000,zMm:0},{xMm:11000,zMm:-7000},{xMm:0,zMm:-7000},
    ])
    expect(doc.building.openings.map(o=>o.id).sort()).toEqual(['D01','D02','D03','G01','W01'])
    expect(deriveFloorRooms(doc.building.floorPlan)).toHaveLength(3)
    expect(createProjectStore(doc).getValidation().valid).toBe(true)
    expect(doc.building.floorPlan?.frame?.openings.find(o=>o.id==='D02')?.wallId).toBe('partition-I002')
  })
  it('uses rough opening jambs from the outer corner, not shortened physical wall origin', () => {
    const plan=createDefaultProject().building.floorPlan!
    const chain=draftingChains(plan,1,planFrameOpeningSides(plan,true),plan.frame!.openings)
    expect(chain.find(c=>c.kind==='openings')?.stationsMm).toEqual([0,1900,2800,3200,6200,7000])
    expect(chain.find(c=>c.kind==='overall')?.stationsMm).toEqual([0,7000])
  })
  it('locates partition axes separately from openings and outer dimensions', () => {
    const plan=createDefaultProject().building.floorPlan!
    const chain=draftingChains(plan,2,planFrameOpeningSides(plan,true),plan.frame!.openings)
    expect(chain.find(c=>c.kind==='axes')?.stationsMm).toEqual([0,6500,11000])
    expect(chain.find(c=>c.kind==='openings')?.stationsMm).toEqual([0,8600,9800,11000])
    const original=JSON.stringify(plan)
    draftingChains(plan,0,planFrameOpeningSides(plan,true),plan.frame!.openings)
    expect(JSON.stringify(plan)).toBe(original)
  })
  it('does not invent opening dimensions on unrelated edges', () => {
    const plan=createDefaultProject().building.floorPlan!
    expect(draftingChains(plan,0,planFrameOpeningSides(plan,true),plan.frame!.openings).map(c=>c.kind)).toEqual(['axes','overall'])
    expect(draftingChains(plan,-1,[],[])).toEqual([])
  })
  it('returns independent fresh documents',()=>{
    const a=createDefaultProject(); a.building.floorPlan!.exterior[0].xMm=999
    expect(createDefaultProject().building.floorPlan!.exterior[0].xMm).toBe(0)
  })
  it('clears the outward 900mm door even when the exterior winding is reversed',()=>{
    const plan=createDefaultProject().building.floorPlan!
    expect(outwardDoorSwingMm(plan,1,planFrameOpeningSides(plan,true),plan.frame!.openings)).toBe(900)
    const reverse={...plan,exterior:[...plan.exterior].reverse()}
    expect(outwardDoorSwingMm(reverse,1,planFrameOpeningSides(reverse,true),plan.frame!.openings)).toBe(900)
    const inward=plan.frame!.openings.map(o=>o.id==='D03'?{...o,swing:{hinge:'start' as const,side:'left' as const}}:o)
    expect(outwardDoorSwingMm(plan,1,planFrameOpeningSides(plan,true),inward)).toBe(0)
  })
  it('keeps the imported authored graph and opening positions intact after regeneration',()=>{
    const doc=createDefaultProject(),store=createProjectStore(doc)
    const graph=JSON.stringify(doc.building.floorPlan)
    const result=store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}})
    expect(result.success).toBe(true)
    expect(JSON.stringify(store.getSnapshot().building.floorPlan)).toBe(graph)
  })

})
