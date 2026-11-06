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
  it('builds paired transverse exterior backing under both interior partition endpoints', () => {
    const doc = frameFor([
      [pt(0, -3000), pt(4000, -3000)],
      [pt(4000, -3000), pt(4000, 0)],
    ])
    const receivers = doc.assembly.elements.filter(element => element.elementId.includes(':partition-backing-'))
    expect(receivers).toHaveLength(4)
    expect(receivers.map(element => element.wallId).sort()).toEqual([
      'plan-front', 'plan-front', 'plan-left', 'plan-left',
    ])
    const front = receivers.filter(e => e.wallId === 'plan-front').sort((a,b) => a.position.x-b.position.x)
    expect(front.map(e => e.sectionMm)).toEqual([
      {width:45,height:145},{width:45,height:145},
    ])
    expect(front.map(e => e.position.x)).toEqual([3972.5,4027.5])
    expect(front.every(e => e.orientation.mode === 'y' && e.lengthMm === 2565)).toBe(true)
    const branchEnd = doc.assembly.elements.find(e => e.wallId === 'partition-I002' &&
      e.role === 'stud' && e.connectionIds.some(id => front.some(outer => outer.elementId === id)))
    expect(branchEnd).toBeTruthy()
    expect(front.every(e => e.connectionIds.includes(branchEnd!.elementId))).toBe(true)

    // Physical contact, not just a logical link: the backing reaches the
    // inside face of the exterior wall, where the green end stud terminates.
    const projection = projectToScene(doc).elements
    const tip = projection.find(e => e.id === branchEnd!.elementId)!
    const tipBox = calculateWorldBounds([tip])
    expect(front.every(e => {
      const box = calculateWorldBounds(projection.filter(item => item.id === e.elementId))
      const xOverlap = Math.min(box.max.x, tipBox.max.x) - Math.max(box.min.x, tipBox.min.x)
      const yOverlap = Math.min(box.max.y, tipBox.max.y) - Math.max(box.min.y, tipBox.min.y)
      return xOverlap > 0.001 && yOverlap > 1 &&
        Math.abs(box.min.z - tipBox.max.z) < 1e-6
    })).toBe(true)
    assertNoPenetration(doc)
  })

  it('replaces an ordinary 600-mm exterior stud when a junction lands on the grid', () => {
    const doc = frameFor([[pt(4200, 0), pt(4200, -2000)]])
    const members = doc.assembly.elements.filter(e => e.wallId === 'plan-front' && e.role === 'stud')
    const positions = members.map(e => e.position.x)
    expect(positions).not.toContain(4222.5) // old stud at authored x=4200 starts at 4200
    expect(positions.filter(x => Math.abs(x - 4200) < 50)).toEqual([4172.5, 4227.5])
    expect(doc.assembly.elements.filter(e => e.elementId.includes('plan-front:partition-backing-')))
      .toHaveLength(2)
    assertNoPenetration(doc)
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
