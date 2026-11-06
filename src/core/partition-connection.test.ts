import { describe, expect, it } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import { planFrameOpeningSides, rectangularFrameSides } from './plan-frame'
import { partitionSides } from './partition-layout'
import { projectToScene } from '../scene/project-to-scene'
import { calculateWorldBounds } from '../scene/view-bounds'
import type { ProjectDocument } from './project'

const pt = (xMm: number, zMm: number) => ({ xMm, zMm })
type Edge = readonly [ReturnType<typeof pt>, ReturnType<typeof pt>]
function frameFor(edges: Edge[]): ProjectDocument {
  const store = createProjectStore(createProjectFromCurrentState({
    projectId: 'receiver-junction-fixture', projectName: 'Garage 10 x 7',
    length: 6000, height: 2700, spacing: 600, openings: [],
  }))
  for (const [xMm, zMm] of [[0, 0], [10000, 0], [10000, -7000], [0, -7000]]) {
    const result = store.dispatch({ type: 'PLAN_ADD_POINT', payload: { point: pt(xMm, zMm) } })
    expect(result.success, result.messageRu).toBe(true)
  }
  expect(store.dispatch({ type: 'PLAN_CLOSE', payload: {} }).success).toBe(true)
  for (const [start, end] of edges) {
    const result = store.dispatch({ type: 'PLAN_GRAPH_ADD_EDGE', payload: {
      start, end, thicknessMm: 100,
    } })
    expect(result.success, result.messageRu).toBe(true)
  }
  const enabled = store.dispatch({ type: 'PLAN_FRAME_ENABLE_PARTITIONS', payload: {} })
  expect(enabled.success, enabled.messageRu).toBe(true)
  const built = store.dispatch({ type: 'PLAN_FRAME_BUILD', payload: {} })
  expect(built.success, built.messageRu).toBe(true)
  return store.getSnapshot()
}
function assertNoPenetration(doc: ProjectDocument) {
  const elements = projectToScene(doc).elements
  const aabbs = elements.map(element => ({element, box: calculateWorldBounds([element])}))
  for (const [i, one] of aabbs.entries()) {
    if (!one.element.wallId?.startsWith('partition-')) continue
    const colliding = aabbs.slice(0, i).concat(aabbs.slice(i + 1)).filter(two =>
      (['x', 'y', 'z'] as const).every(axis =>
        Math.min(one.box.max[axis], two.box.max[axis]) -
        Math.max(one.box.min[axis], two.box.min[axis]) > 1e-6))
    expect(colliding.map(item => item.element.id),
      'Unexpected penetration by ' + one.element.id).toEqual([])
  }
}

describe('SIGMA4 exterior-to-interior stud receiver (top view)', () => {

  it('builds a flatwise three-stud channel at each exterior T-junction', () => {
    const doc=frameFor([
      [pt(0,-3000),pt(4000,-3000)],
      [pt(4000,-3000),pt(4000,0)],
    ])
    const receivers=doc.assembly.elements.filter(e=>e.elementId.includes(':partition-backing-'))
    expect(receivers).toHaveLength(6)
    expect(receivers.map(e=>e.wallId).sort()).toEqual([
      'plan-front','plan-front','plan-front','plan-left','plan-left','plan-left',
    ])
    const front=receivers.filter(e=>e.wallId==='plan-front')
    const left=front.find(e=>e.elementId.endsWith('-left'))!
    const right=front.find(e=>e.elementId.endsWith('-right'))!
    const flat=front.find(e=>e.elementId.endsWith('-flat'))!
    expect([left.position.x,right.position.x,flat.position.x]).toEqual([3927.5,4072.5,3950])
    expect([left.sectionMm,right.sectionMm,flat.sectionMm]).toEqual([
      {width:45,height:145},{width:45,height:145},{width:45,height:100},
    ])
    expect(flat.position.z).toBe(-50)
    expect(flat.orientation).toEqual({mode:'y',angle:0,roll:90})
    expect(front.every(e=>e.lengthMm===2565)).toBe(true)
    expect(left.connectionIds).toContain(flat.elementId)
    expect(right.connectionIds).toContain(flat.elementId)
    expect(flat.connectionIds).toEqual(expect.arrayContaining([left.elementId,right.elementId]))
    const tip=doc.assembly.elements.find(e=>e.wallId==='partition-I002'&&
      e.role==='stud'&&e.connectionIds.includes(flat.elementId))
    expect(tip).toBeDefined()
    expect(flat.connectionIds).toContain(tip!.elementId)
    const projected=projectToScene(doc).elements
    const world=(id:string)=>calculateWorldBounds(projected.filter(e=>e.id===id))
    const sideLeft=world(left.elementId),sideRight=world(right.elementId)
    const nailer=world(flat.elementId),end=world(tip!.elementId)
    const delta=(a:typeof sideLeft,b:typeof sideLeft,axis:'x'|'y'|'z')=>
      Math.min(a.max[axis],b.max[axis])-Math.max(a.min[axis],b.min[axis])
    expect(delta(sideLeft,nailer,'x')).toBeCloseTo(0,6)
    expect(delta(sideRight,nailer,'x')).toBeCloseTo(0,6)
    expect(delta(nailer,end,'z')).toBeCloseTo(0,6)
    expect(delta(nailer,end,'x')).toBeGreaterThan(0.09)
    expect(delta(nailer,end,'y')).toBeGreaterThan(2.5)
    expect(nailer.max.z-nailer.min.z).toBeCloseTo(0.045,6)
    expect(nailer.max.x-nailer.min.x).toBeCloseTo(0.1,6)
    assertNoPenetration(doc)
  })

  it('replaces the ordinary stud hidden in the receiving channel on a 600mm grid', () => {
    const doc=frameFor([[pt(4200,0),pt(4200,-2000)]])
    const front=doc.assembly.elements.filter(e=>e.wallId==='plan-front')
    const group=front.filter(e=>e.elementId.includes(':partition-backing-'))
    expect(group).toHaveLength(3)
    expect(group.filter(e=>e.elementId.endsWith('-flat'))).toHaveLength(1)
    expect(group.find(e=>e.elementId.endsWith('-left'))?.position.x).toBe(4127.5)
    expect(group.find(e=>e.elementId.endsWith('-right'))?.position.x).toBe(4272.5)
    expect(group.find(e=>e.elementId.endsWith('-flat'))?.position.x).toBe(4150)
    expect(front.some(e=>e.elementId.startsWith('plan-front:stud-')&&
      Math.abs(e.position.x-4222.5)<0.001)).toBe(false)
    expect(doc.validation.valid).toBe(true)
    assertNoPenetration(doc)
  })

  it('rebuilds the same three-stud source geometry after JSON import',()=>{
    const doc=frameFor([[pt(4200,0),pt(4200,-2000)]])
    const before=doc.assembly.elements.filter(e=>e.elementId.includes(':partition-backing-'))
    const store=createProjectStore(createProjectFromCurrentState({
      projectId:'channel-reimport',length:6000,height:2700,spacing:600,openings:[],
    }))
    expect(store.importJson(JSON.stringify(doc)).success).toBe(true)
    const after=store.getSnapshot().assembly.elements.filter(e=>e.elementId.includes(':partition-backing-'))
    expect(after).toEqual(before)
  })

  it('understands a graph-split T node: both through arms continue, the branch is inset and supported', () => {
    const doc = frameFor([
      [pt(0,-3000), pt(10000,-3000)],
      [pt(4000,0), pt(4000,-3000)],
    ])
    const plan = doc.building.floorPlan!
    const sides = planFrameOpeningSides(plan)
    const inner = sides.filter(s => s.wallId.startsWith('partition-'))
    expect(inner).toHaveLength(3)
    const vertical = inner.find(side => side.start.xMm===4000 && side.end.xMm===4000)!
    expect(vertical).toBeDefined()
    if (!vertical || !('endInsetMm' in vertical)) throw Error('Missing partition frame')
    expect(vertical.endInsetMm).toBe(50)
    expect(vertical.endHost?.wallId).toMatch(/^partition-/)
    expect(doc.building.walls.find(w => w.wallId === vertical.wallId)?.lengthMm).toBe(2805)
    const horizontal = inner.filter(side => side.start.zMm===-3000 && side.end.zMm===-3000)
    expect(horizontal).toHaveLength(2)
    expect(horizontal.every(side => 'endInsetMm' in side &&
      (side.start.xMm===4000 ? side.insetMm : side.endInsetMm) === 0)).toBe(true)
    const connectedEnd = doc.assembly.elements.find(e=>e.wallId===vertical.wallId &&
      e.role==='stud' && e.connectionIds.some(id=>id.startsWith('partition-')))
    expect(connectedEnd).toBeTruthy()
    assertNoPenetration(doc)
  })

  it('keeps a four-arm cross valid, chooses an X through-run, and trims both perpendicular arms', () => {
    const doc = frameFor([
      [pt(0,-3000), pt(10000,-3000)],
      [pt(4000,0), pt(4000,-7000)],
    ])
    const plan=doc.building.floorPlan!
    const sides=partitionSides(plan,rectangularFrameSides(plan),145)
    expect(sides).toHaveLength(4)
    const vertical = sides.filter(side=>side.start.xMm===4000 && side.end.xMm===4000)
    expect(vertical).toHaveLength(2)
    expect(vertical.every(side=>(side.start.zMm===-3000?side.insetMm:side.endInsetMm)===50)).toBe(true)
    const horizontal=sides.filter(side=>side.start.zMm===-3000 && side.end.zMm===-3000)
    expect(horizontal).toHaveLength(2)
    expect(horizontal.every(side=>(side.start.xMm===4000?side.insetMm:side.endInsetMm)===0)).toBe(true)
    expect(doc.validation.valid).toBe(true)
    assertNoPenetration(doc)
  })
})
