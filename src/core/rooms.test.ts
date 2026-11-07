import {describe,expect,it} from 'vitest'
import {deriveFloorRooms,totalRoomAreaM2} from './rooms'
import {addGraphSegment,graphView,moveGraphEdge} from './plan-graph'
import {emptyFloorPlan,type FloorPlan,type PlanPoint} from './floor-plan'
const p=(xMm:number,zMm:number):PlanPoint=>({xMm,zMm})
const rectangle=(w=9000,h=6000):FloorPlan=>({
  ...emptyFloorPlan(),closed:true,exterior:[p(0,0),p(w,0),p(w,-h),p(0,-h)],
  exteriorThicknessMm:150,
})
const v=[p(3000,0),p(3000,-6000)] as const
const h=[p(0,-3000),p(3000,-3000)] as const
const add=(plan:FloorPlan,a:PlanPoint,b:PlanPoint,t=100)=>
  addGraphSegment(plan,a,b,t)
const areas=(plan:FloorPlan)=>deriveFloorRooms(plan).map(room=>room.areaM2)
describe('SIGMA4 0.1.32: canonical wall-face room area geometry',()=>{
  it('ignores an open plan and measures one enclosed net floor area',()=>{
    expect(deriveFloorRooms(emptyFloorPlan())).toEqual([])
    expect(areas(rectangle())).toEqual([49.59])
    expect(areas({...rectangle(),exteriorThicknessMm:200})).toEqual([48.16])
  })
  it('splits one 9×6 space by a 100mm wall: 15.96+33.06 m²',()=>{
    const plan=add(rectangle(),...v)
    const rooms=deriveFloorRooms(plan)
    expect(rooms.map(x=>x.areaM2)).toEqual([15.96,33.06])
    expect(rooms.every(r=>r.rectangles.some(x=>r.center.xMm>=x.minXmm&&
      r.center.xMm<=x.maxXmm&&r.center.zMm>=x.minZmm&&r.center.zMm<=x.maxZmm)))
      .toBe(true)
    expect(totalRoomAreaM2(rooms)).toBeCloseTo(49.02,8)
  })
  it('forms 3 rooms at an internal T; deterministic when graph draw order changes',()=>{
    let first=add(rectangle(),...v)
    first=add(first,...h)
    let reverse=add(rectangle(),...h)
    reverse=add(reverse,...v)
    const r1=deriveFloorRooms(first),r2=deriveFloorRooms(reverse)
    expect(r1.map(r=>r.areaM2)).toEqual([7.84,7.84,33.06])
    expect(r2.map(r=>r.areaM2)).toEqual([7.84,7.84,33.06])
    expect(r1.map(r=>r.id)).toEqual(['R01','R02','R03'])
    expect(r1.map(r=>r.rectangles.reduce((sum,box)=>sum+
      (box.maxXmm-box.minXmm)*(box.maxZmm-box.minZmm),0)))
      .toEqual(r1.map(r=>r.areaMm2))
  })
  it('forms 4 net rooms for an X junction without counting wall intersections twice',()=>{
    let plan=add(rectangle(),...v)
    plan=add(plan,p(0,-3000),p(9000,-3000))
    expect(areas(plan)).toEqual([7.84,7.84,16.24,16.24])
  })
  it('does not invent a closed room for a partial T branch with a gap',()=>{
    let plan=add(rectangle(),...v)
    plan=add(plan,p(0,-3000),p(2800,-3000))
    const rooms=deriveFloorRooms(plan)
    expect(rooms).toHaveLength(2)
    expect(rooms[0].areaM2).toBeCloseTo(15.695,8)
  })
  it('a door/window does not connect separate rooms or alter their area',()=>{
    const plan=add(rectangle(),...v)
    const withDoor:FloorPlan={
      ...plan,frame:{built:true,partitions:true,openings:[{
        id:'D01',wallId:'partition-I001',type:'door',
        positionUmm:1500,widthMm:900,heightMm:2100,sillHeightMm:0,
      }]},
    }
    expect(deriveFloorRooms(withDoor)).toEqual(deriveFloorRooms(plan))
  })
  it('uses changed wall position and thickness, not cached area data',()=>{
    const original=add(rectangle(),...v)
    const id=graphView(original).interiorWalls[0].id
    const moved=moveGraphEdge(original,id,250)!
    expect(areas(original)).toEqual([15.96,33.06])
    expect(areas(moved)).toEqual([17.385,31.635])
    const thicker=add(rectangle(),v[0],v[1],200)
    expect(areas(thicker)).toEqual([15.675,32.775])
  })
  it('supports a concave orthogonal exterior contour and conserves net area',()=>{
    const shape:FloorPlan={...emptyFloorPlan(),closed:true,exterior:[
      p(0,0),p(9000,0),p(9000,-3000),p(5000,-3000),
      p(5000,-6000),p(0,-6000),
    ],exteriorThicknessMm:150}
    const rooms=deriveFloorRooms(shape)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].areaM2).toBeGreaterThan(0)
    expect(rooms[0].areaM2).toBeLessThan(42)
    expect(rooms[0].rectangles.reduce((sum,r)=>sum+
      (r.maxXmm-r.minXmm)*(r.maxZmm-r.minZmm),0)).toBeCloseTo(rooms[0].areaMm2,5)
  })
})
