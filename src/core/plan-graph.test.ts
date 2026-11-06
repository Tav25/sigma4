import { describe,it,expect } from 'vitest'
import {type FloorPlan, type PlanPoint, planAreaM2, validateFloorPlan} from './floor-plan'
import {
  addGraphPoint, addGraphSegment, splitGraphEdge, deleteGraphEdge,
  deleteGraphPoint, moveGraphPoint, moveGraphEdge, ensureWallGraph,
  graphView, validatePlanGraph,
} from './plan-graph'
const p=(xMm:number,zMm:number):PlanPoint=>({xMm,zMm})
const garage=():FloorPlan=>({
  exterior:[p(0,0),p(10000,0),p(10000,-7000),p(0,-7000)],
  closed:true,interiorWalls:[],
})
const segments=(plan:FloorPlan)=>graphView(plan).interiorWalls

describe('SIGMA4 0.1.12 canonical free points and segment graph',()=>{
  it('places truly free points in garage and keeps isolated points without walls',()=>{
    const doc=addGraphPoint(garage(),p(4700,-2000))
    expect(doc.graph?.nodes).toMatchObject([{xMm:4700,zMm:-2000}])
    expect(doc.graph?.edges).toHaveLength(0)
    expect(doc.interiorWalls).toEqual([])
    expect(validateFloorPlan(doc)).toEqual([])
    expect(planAreaM2(doc)).toBe(70)
  })
  it('creates an L-shaped storage room without forcing wall-to-wall construction',()=>{
    let doc=addGraphSegment(garage(),p(0,-2000),p(4700,-2000),100)
    doc=addGraphSegment(doc,p(4700,0),p(4700,-2000),100)
    expect(segments(doc)).toHaveLength(2)
    expect(segments(doc).some(e=>e.start.xMm===0&&e.end.xMm===4700)).toBe(true)
    expect(segments(doc).some(e=>e.start.xMm===4700&&e.end.zMm===-2000)).toBe(true)
    expect(validateFloorPlan(doc)).toEqual([])
    expect(doc.interiorWalls).toEqual([])
    expect(planAreaM2(doc)).toBe(70)
  })
  it('automatically splits a horizontal wall at a new vertical junction, then erases only its right part',()=>{
    let doc=addGraphSegment(garage(),p(0,-2000),p(10000,-2000),100)
    doc=addGraphSegment(doc,p(4700,0),p(4700,-2000),150)
    expect(segments(doc)).toHaveLength(3)
    const joint=doc.graph!.nodes.filter(n=>n.xMm===4700&&n.zMm===-2000)
    expect(joint).toHaveLength(1)
    expect(doc.graph!.edges.filter(e=>e.a===joint[0].id||e.b===joint[0].id)).toHaveLength(3)
    const right=segments(doc).find(w=>w.start.xMm===4700 && w.end.xMm===10000)!
    doc=deleteGraphEdge(doc,right.id)
    expect(segments(doc)).toHaveLength(2)
    expect(segments(doc).some(w=>w.start.xMm===0&&w.end.xMm===4700)).toBe(true)
    expect(segments(doc).some(w=>w.start.xMm===4700&&w.end.xMm===10000)).toBe(false)
    expect(validateFloorPlan(doc)).toEqual([])
  })
  it('explicit scissors split a long segment into two; Delete acts only on the selected segment',()=>{
    let doc=addGraphSegment(garage(),p(0,-3000),p(10000,-3000),100)
    const id=doc.graph!.edges[0].id
    doc=splitGraphEdge(doc,id,p(4500,-3000))
    expect(segments(doc).map(w=>Math.abs(w.end.xMm-w.start.xMm))).toEqual([4500,5500])
    const unwanted=segments(doc).find(w=>Math.max(w.start.xMm,w.end.xMm)===10000)!
    doc=deleteGraphEdge(doc,unwanted.id)
    expect(segments(doc)).toHaveLength(1)
    expect(segments(doc)[0].end.xMm).toBe(4500)
    expect(validateFloorPlan(doc)).toEqual([])
  })
  it('placing a point on an existing segment also splits it at that exact point',()=>{
    let doc=addGraphSegment(garage(),p(0,-2000),p(10000,-2000),100)
    doc=addGraphPoint(doc,p(4750,-2000))
    expect(segments(doc)).toHaveLength(2)
    expect(doc.graph!.nodes.filter(n=>n.xMm===4750&&n.zMm===-2000)).toHaveLength(1)
    expect(validateFloorPlan(doc)).toEqual([])
  })
  it('moves the complete connected collinear chain and preserves horizontal T attachments',()=>{
    let doc=addGraphSegment(garage(),p(0,-2000),p(10000,-2000),100)
    doc=addGraphSegment(doc,p(4700,0),p(4700,-2000),150)
    const edge=segments(doc).find(w=>w.start.zMm===0&&w.end.zMm===-2000)!
    const moved=moveGraphEdge(doc,edge.id,500)
    expect(validateFloorPlan(moved)).toEqual([])
    expect(segments(moved).some(w=>w.start.xMm===5200&&w.end.xMm===5200)).toBe(true)
    expect(segments(moved).some(w=>w.end.xMm===5200&&w.start.xMm===0)).toBe(true)
    expect(segments(doc).some(w=>w.end.xMm===4700)).toBe(true)
  })
  it('supports repositioning isolated points, rejects out-of-bounds or diagonal connections',()=>{
    let doc=addGraphPoint(garage(),p(1200,-1300))
    const id=doc.graph!.nodes[0].id
    doc=moveGraphPoint(doc,id,p(1450,-1900))
    expect(validateFloorPlan(doc)).toEqual([])
    expect(doc.graph!.nodes[0].xMm).toBe(1450)
    doc=deleteGraphPoint(doc,id)
    expect(doc.graph!.nodes).toEqual([])
    const bad=addGraphPoint(garage(),p(11000,-1000))
    expect(validateFloorPlan(bad).some(x=>x.includes('периметр'))).toBe(true)
    const joined=addGraphSegment(garage(),p(1000,-1000),p(4000,-1000),100)
    const movingId=joined.graph!.nodes[0].id
    expect(validateFloorPlan(moveGraphPoint(joined,movingId,p(1000,-1200))).length).toBeGreaterThan(0)
    expect(()=>deleteGraphPoint(joined,movingId)).toThrow()
  })
  it('migrates legacy wall coordinates once and resolves crossings into shared nodes',()=>{
    const old:FloorPlan={...garage(),interiorWalls:[
      {id:'I001',start:p(0,-2000),end:p(10000,-2000),thicknessMm:100},
      {id:'I002',start:p(4700,0),end:p(4700,-7000),thicknessMm:150},
    ]}
    const migrated=ensureWallGraph(old)
    expect(migrated.interiorWalls).toEqual([])
    expect(migrated.graph!.edges).toHaveLength(4)
    expect(migrated.graph!.nodes.filter(n=>n.xMm===4700&&n.zMm===-2000)).toHaveLength(1)
    expect(validateFloorPlan(migrated)).toEqual([])
    expect(old.graph).toBeUndefined()
    expect(old.interiorWalls).toHaveLength(2)
  })
  it('validates corrupted JSON instead of accepting duplicate nodes, missing refs, intersections or dual sources',()=>{
    let doc=addGraphSegment(garage(),p(0,-2000),p(10000,-2000),100)
    const malformed=JSON.parse(JSON.stringify(doc)) as FloorPlan
    malformed.graph!.nodes.push({...malformed.graph!.nodes[0],id:'N999'})
    expect(validatePlanGraph(malformed).some(x=>x.includes('Дублирующие'))).toBe(true)
    malformed.graph!.nodes.pop()
    malformed.graph!.edges[0].b='MISSING'
    expect(validateFloorPlan(malformed).some(x=>x.includes('отсутствующую'))).toBe(true)
    const dual=JSON.parse(JSON.stringify(doc)) as FloorPlan
    dual.interiorWalls=[{id:'bad',start:p(0,-3000),end:p(10000,-3000),thicknessMm:100}]
    expect(validateFloorPlan(dual).some(x=>x.includes('две независимые'))).toBe(true)
    const crossed=JSON.parse(JSON.stringify(doc)) as FloorPlan
    crossed.graph!.nodes.push({id:'N900',xMm:4700,zMm:0},{id:'N901',xMm:4700,zMm:-7000})
    crossed.graph!.edges.push({id:'I900',a:'N900',b:'N901',thicknessMm:100})
    expect(validateFloorPlan(crossed).some(x=>x.includes('общим узлом'))).toBe(true)
    expect(validateFloorPlan(doc)).toEqual([])
  })
  it('rejects segment overlaps and crossing the outside concave boundary',()=>{
    const first=addGraphSegment(garage(),p(0,-2000),p(10000,-2000),100)
    const overlap=addGraphSegment(first,p(1500,-2000),p(5000,-2000),100)
    expect(validateFloorPlan(overlap).some(x=>x.includes('перекрывают'))).toBe(true)
    const notch:FloorPlan={
      exterior:[p(0,0),p(10000,0),p(10000,-7000),p(7000,-7000),
        p(7000,-3000),p(4000,-3000),p(4000,-7000),p(0,-7000)],
      closed:true,interiorWalls:[],
    }
    const cross=addGraphSegment(notch,p(0,-5000),p(10000,-5000),100)
    expect(validateFloorPlan(cross).some(x=>x.includes('наружную границу'))).toBe(true)
  })
})
