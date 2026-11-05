import { describe, it, expect } from 'vitest'
import { emptyFloorPlan, withPlanPoint, withPlanClosure, validateFloorPlan,
  planAreaM2, planPerimeterMm, planBounds, decimalMetersToMm, planSegmentsIntersect } from './floor-plan'

const p=(xMm:number,zMm:number)=>({xMm,zMm})
const outline=[p(0,0),p(6000,0),p(6000,-4000),p(0,-4000)]
describe('SIGMA4 0.1.0 canonical 2D floor plan',()=>{
  it('starts at origin and draws an accurate 6×4m perimeter',()=>{
    let doc=emptyFloorPlan()
    expect(validateFloorPlan(doc)).toEqual([])
    for(const node of outline) {
      doc=withPlanPoint(doc,node)
      expect(validateFloorPlan(doc)).toEqual([])
    }
    doc=withPlanClosure(doc)
    expect(validateFloorPlan(doc)).toEqual([])
    expect(planAreaM2(doc)).toBe(24)
    expect(planPerimeterMm(doc)).toBe(20000)
    expect(planBounds(doc.exterior)).toEqual({minX:0,maxX:6000,minZ:-4000,maxZ:0})
  })
  it('accepts exact decimal metres and rejects ambiguous/invalid values',()=>{
    expect(decimalMetersToMm('6')).toBe(6000)
    expect(decimalMetersToMm('3,275')).toBe(3275)
    expect(decimalMetersToMm('0.30')).toBe(300)
    expect(decimalMetersToMm('0.1')).toBeNull()
    expect(decimalMetersToMm('abc')).toBeNull()
    expect(decimalMetersToMm('2.1234')).toBeNull()
    expect(decimalMetersToMm('1000')).toBeNull()
  })
  it('rejects diagonal and too-short sides, crossings and repeated nodes',()=>{
    expect(validateFloorPlan({ exterior:[p(0,0),p(3000,2000)],closed:false,interiorWalls:[] })).not.toEqual([])
    expect(validateFloorPlan({ exterior:[p(0,0),p(200,0)],closed:false,interiorWalls:[] })).not.toEqual([])
    expect(validateFloorPlan({ exterior:[p(0,0),p(3000,0),p(3000,-2000),p(0,-2000),
      p(0,0)],closed:false,interiorWalls:[] })).not.toEqual([])
    expect(planSegmentsIntersect(p(0,0),p(4000,0),p(2000,-2000),p(2000,2000))).toBe(true)
    const crossing={exterior:[p(0,0),p(6000,0),p(6000,-4000),p(3000,-4000),
      p(3000,2000)],closed:false,interiorWalls:[]}
    expect(validateFloorPlan(crossing).some(x=>x.includes('самопересекаться'))).toBe(true)
  })
  it('prevents closure across a diagonal and corrupt internal walls',()=>{
    expect(validateFloorPlan({exterior:[p(0,0),p(6000,0),p(5000,-4000)],
      closed:true,interiorWalls:[]}).length).toBeGreaterThan(0)
    expect(validateFloorPlan({exterior:outline,closed:true,
      interiorWalls:[{id:'I1',start:p(0,0),end:p(1000,1000),thicknessMm:-5}]}).length)
      .toBeGreaterThan(0)
  })
  it('keeps future interior-wall list part of the same source of truth',()=>{
    const doc={exterior:outline,closed:true,interiorWalls:[]}
    const roundtrip=JSON.parse(JSON.stringify(doc))
    expect(validateFloorPlan(roundtrip)).toEqual([])
    expect(roundtrip.interiorWalls).toEqual([])
  })
})
