import {describe,expect,it} from 'vitest'
import {roomFloorPlanes} from './room-overlay'
import {deriveFloorRooms} from '../core/rooms'
import {emptyFloorPlan} from '../core/floor-plan'
import {addGraphSegment} from '../core/plan-graph'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
describe('SIGMA4 0.1.33: 3D floor overlays use the same derived 2D dimensions',()=>{
  it('projects 9×6 T-room areas into exact world metres',()=>{
    let plan={...emptyFloorPlan(),closed:true,
      exterior:[p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)],
      exteriorThicknessMm:150}
    plan=addGraphSegment(plan,p(3000,0),p(3000,-6000),100)
    plan=addGraphSegment(plan,p(0,-3000),p(3000,-3000),100)
    const rooms=deriveFloorRooms(plan)
    const planes=roomFloorPlanes(rooms)
    expect(rooms.map(r=>r.areaM2)).toEqual([7.84,7.84,33.06])
    expect(planes.map(x=>x.widthM*x.depthM).reduce((a,b)=>a+b,0))
      .toBeCloseTo(48.74,10)
    for(const plane of planes){
      expect(plane.widthM).toBeGreaterThan(0)
      expect(plane.depthM).toBeGreaterThan(0)
      expect(plane.xM).toBeGreaterThanOrEqual(0.15)
      expect(plane.xM).toBeLessThanOrEqual(8.85)
      expect(plane.zM).toBeLessThanOrEqual(-0.15)
      expect(plane.zM).toBeGreaterThanOrEqual(-5.85)
    }
    expect(new Set(planes.map(x=>x.color)).size).toBe(3)
  })
})
