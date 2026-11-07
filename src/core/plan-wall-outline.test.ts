import { describe, expect, it } from 'vitest'
import { unionWallRectangles, planWallDrawing } from './plan-wall-outline'
import { createDefaultProject } from './default-project'

describe('joined wall drawing',()=>{
  it('removes the cross seam at a T while retaining its exposed edges',()=>{
    const out=unionWallRectangles([{minX:0,maxX:1000,minZ:0,maxZ:100},{minX:450,maxX:550,minZ:0,maxZ:1000}])
    expect(out.areaMm2).toBe(190000)
    expect(out.edges.some(e=>e.a.zMm===100&&e.b.zMm===100&&Math.min(e.a.xMm,e.b.xMm)<550&&Math.max(e.a.xMm,e.b.xMm)>450)).toBe(false)
    expect(out.edges.some(e=>e.a.xMm===450&&e.b.xMm===450&&e.a.zMm>=100)).toBe(true)
  })
  it('joins an L without erasing its outside corner or inside return',()=>{
    const out=unionWallRectangles([{minX:0,maxX:1000,minZ:0,maxZ:100},{minX:0,maxX:100,minZ:0,maxZ:1000}])
    expect(out.areaMm2).toBe(190000)
    expect(out.edges.some(e=>e.a.xMm===100&&e.b.xMm===100&&Math.max(e.a.zMm,e.b.zMm)<=100)).toBe(false)
    expect(out.edges.some(e=>e.a.xMm===0&&e.b.xMm===0)).toBe(true)
  })
  it('keeps a free wall end and handles an X without internal seams',()=>{
    const out=unionWallRectangles([{minX:0,maxX:1000,minZ:450,maxZ:550},{minX:450,maxX:550,minZ:0,maxZ:1000}])
    expect(out.areaMm2).toBe(190000)
    expect(out.edges.filter(e=>e.a.xMm===0&&e.b.xMm===0)).toHaveLength(1)
    expect(out.edges.some(e=>e.a.zMm===450&&e.b.zMm===450&&Math.min(e.a.xMm,e.b.xMm)<550&&Math.max(e.a.xMm,e.b.xMm)>450)).toBe(false)
    expect(unionWallRectangles([])).toEqual({rectangles:[],edges:[],areaMm2:0})
  })
  it('preserves the supplied model and leaves no line through its exterior T attachment',()=>{
    const plan=createDefaultProject().building.floorPlan!,before=JSON.stringify(plan)
    const out=planWallDrawing(plan)
    expect(JSON.stringify(plan)).toBe(before)
    expect(out.edges.some(e=>e.a.zMm===-6855&&e.b.zMm===-6855&&Math.min(e.a.xMm,e.b.xMm)<4550&&Math.max(e.a.xMm,e.b.xMm)>4450)).toBe(false)
    expect(out.areaMm2).toBeGreaterThan(0)
  })
})
