import { describe, expect, it } from 'vitest'
import { type FloorPlan, type PlanPoint, validateFloorPlan,
  snapPlanAnchor, planInteriorJunctions, nextInteriorWallId } from './floor-plan'

const p=(x:number,z:number):PlanPoint=>({xMm:x,zMm:z})
const outline=[p(0,0),p(6000,0),p(6000,-4000),p(0,-4000)]
const wall=(id:string,start:PlanPoint,end:PlanPoint,thicknessMm=100)=>
  ({id,start,end,thicknessMm})
const plan=(walls:ReturnType<typeof wall>[]=[],exterior=outline):FloorPlan=>
  ({exterior,closed:true,interiorWalls:walls})

describe('SIGMA4 0.1.1 internal floor-plan wall geometry',()=>{
  it('anchors a straight wall between two external segments and stores exact thickness',()=>{
    expect(validateFloorPlan(plan([wall('I001',p(3000,0),p(3000,-4000),150)]))).toEqual([])
  })
  it('accepts T-joints and cross-joints as derived deterministic intersections',()=>{
    const model=plan([
      wall('I001',p(3000,0),p(3000,-4000)),
      wall('I002',p(0,-2000),p(3000,-2000)),
      wall('I003',p(3000,-2000),p(6000,-2000)),
    ])
    expect(validateFloorPlan(model)).toEqual([])
    expect(planInteriorJunctions(model)).toEqual([p(3000,-2000)])
    expect(nextInteriorWallId(model)).toBe('I004')
    expect(validateFloorPlan(plan([
      wall('I001',p(3000,0),p(3000,-4000)),
      wall('I002',p(0,-2000),p(6000,-2000)),
    ]))).toEqual([])
  })
  it('snaps anchors to exterior or interior walls with orthogonal target',()=>{
    const model=plan([wall('I001',p(3000,0),p(3000,-4000))])
    expect(snapPlanAnchor(model,p(3010,20),200,250)).toEqual(p(3000,0))
    expect(snapPlanAnchor(model,p(3020,-1960),200,250,p(0,-2000))).toEqual(p(3000,-2000))
    expect(snapPlanAnchor(model,p(9000,-9000),200)).toBeNull()
  })
  it('rejects floating endpoints, duplicates, overlap, diagonal and invalid thickness',()=>{
    expect(validateFloorPlan(plan([wall('I001',p(2000,-1000),p(2000,-3000))])).length).toBeGreaterThan(0)
    expect(validateFloorPlan(plan([wall('I001',p(3000,0),p(3000,-2500))])).length).toBeGreaterThan(0)
    expect(validateFloorPlan(plan([wall('I001',p(1000,0),p(4000,-4000))])).length).toBeGreaterThan(0)
    expect(validateFloorPlan(plan([wall('I001',p(3000,0),p(3000,-4000),20)])).length).toBeGreaterThan(0)
    expect(validateFloorPlan(plan([
      wall('I001',p(3000,0),p(3000,-4000)),
      wall('I001',p(0,-2000),p(6000,-2000)),
    ])).some(e=>e.includes('ID'))).toBe(true)
    expect(validateFloorPlan(plan([
      wall('I001',p(3000,0),p(3000,-4000)),
      wall('I002',p(3000,-1000),p(3000,-3500)),
    ])).some(e=>e.includes('перекрывает'))).toBe(true)
  })
  it('prevents external-boundary crossing even within concave outlines',()=>{
    const notch=[p(0,0),p(8000,0),p(8000,-6000),p(5000,-6000),
      p(5000,-2000),p(3000,-2000),p(3000,-6000),p(0,-6000)]
    const model=plan([wall('I001',p(0,-4000),p(8000,-4000))],notch)
    expect(validateFloorPlan(model).some(e=>e.includes('пересекает'))).toBe(true)
  })
  it('rejects dangling walls on unclosed projects and malformed imports',()=>{
    const open=plan([wall('I001',p(3000,0),p(3000,-4000))])
    open.closed=false
    expect(validateFloorPlan(open).length).toBeGreaterThan(0)
    expect(validateFloorPlan(plan([wall('I001',p(3000,0),p(3000,-4000),100.5)])).length).toBeGreaterThan(0)
  })
})
