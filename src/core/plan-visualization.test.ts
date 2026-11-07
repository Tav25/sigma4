import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTERIOR_THICKNESS_MM, exteriorWallStrips, type FloorPlan, type PlanPoint } from './floor-plan'
import { FRAME_SECTION } from './plan-frame'
import { deriveFloorRooms } from './rooms'
import { exteriorDimensionNormal, planGridMetrics, roomLabelKind, zoomPlanAround } from './plan-visualization'
const p = (xMm: number, zMm: number): PlanPoint => ({ xMm, zMm })
const rectangle = [p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)]
describe('SIGMA4 0.1.35: exact metric viewport display', () => {
  it('uses the same default depth before and after building a 145mm exterior frame', () => {
    expect(DEFAULT_EXTERIOR_THICKNESS_MM).toBe(FRAME_SECTION.height)
    const model: FloorPlan = { exterior: rectangle, closed: true, interiorWalls: [] }
    expect(exteriorWallStrips(model)[0][2].zMm).toBe(-FRAME_SECTION.height)
  })
  it('draws dimensions outward for both winding directions', () => {
    expect(exteriorDimensionNormal(rectangle,0)).toEqual({x:0,y:1})
    expect(exteriorDimensionNormal(rectangle,1)).toEqual({x:1,y:0})
    const clockwise=[rectangle[0],rectangle[3],rectangle[2],rectangle[1]]
    expect(exteriorDimensionNormal(clockwise,0)).toEqual({x:-1,y:0})
  })
  it('uses polygon winding rather than bounding-box centre at concave L corners', () => {
    const l=[p(0,0),p(9000,0),p(9000,-3000),p(5000,-3000),p(5000,-6000),p(0,-6000)]
    expect(exteriorDimensionNormal(l,2)).toEqual({x:0,y:-1})
    expect(exteriorDimensionNormal(l,3)).toEqual({x:1,y:0})
  })
  it('makes minor grid spacing track the selected snap, while hiding unreadable lines', () => {
    expect(planGridMetrics(64,250)).toEqual({minorPx:16,majorPx:64,showMinor:true})
    expect(planGridMetrics(64,100).minorPx).toBeCloseTo(6.4)
    expect(planGridMetrics(20,100).showMinor).toBe(false)
    expect(planGridMetrics(64,1000).showMinor).toBe(false)
  })
  it('keeps the point below the pointer fixed while zooming in either direction', () => {
    const anchor={x:750,y:335},pan={x:41,y:-28},offset={x:220,y:565},base=64
    const before={x:(anchor.x-offset.x-pan.x)/base,y:(anchor.y-offset.y-pan.y)/base}
    const next=zoomPlanAround(1,pan,anchor,1.4,offset)
    const after={x:(anchor.x-offset.x-next.pan.x)/(base*next.zoom),
      y:(anchor.y-offset.y-next.pan.y)/(base*next.zoom)}
    expect(after.x).toBeCloseTo(before.x,12)
    expect(after.y).toBeCloseTo(before.y,12)
    expect(zoomPlanAround(2.8,pan,anchor,2,offset).zoom).toBe(2.8)
    expect(zoomPlanAround(.32,pan,anchor,.5,offset).zoom).toBe(.32)
  })
  it('shows room text only when there is sufficient usable space', () => {
    const model:FloorPlan={exterior:rectangle,closed:true,interiorWalls:[]}
    const room=deriveFloorRooms(model)[0]
    expect(roomLabelKind(room,64)).toBe('full')
    expect(roomLabelKind(room,12)).toBe('compact')
    expect(roomLabelKind(room,7)).toBe('marker')
  })
})
