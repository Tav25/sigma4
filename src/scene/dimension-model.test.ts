import { describe, it, expect } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from '../core/project-store'
import { rightCornerOrigin } from '../core/corner'
import { projectToScene } from './project-to-scene'
import { buildDimensionLayout } from './dimension-model'

const create = (length = 4000) => createProjectFromCurrentState({
  projectId: 's06-5-coordinates', length, height: 2700, spacing: 600, openings: [],
})

describe('S06.5 coordinates and real dimensions', () => {
  it('anchors the first wall at x=0 and extends exactly to x=4000', () => {
    const doc = create()
    const layout = buildDimensionLayout(doc.building.walls, projectToScene(doc).elements)
    expect(doc.building.walls[0].origin).toEqual({ x: 0, y: 0, z: 0 })
    const wall = layout.lines.find(l => l.id === 'wall-dim-wall-001')!
    expect(wall.from).toEqual({ x: 0, y: 0, z: 0 })
    expect(wall.to).toEqual({ x: 4000, y: 0, z: 0 })
    expect(wall.valueMm).toBe(4000)
    expect(layout.overallXmm).toBeCloseTo(4000, 6)
    expect(layout.bounds.minX).toBeCloseTo(0, 6)
    expect(layout.bounds.maxX).toBeCloseTo(4000, 6)
    expect(layout.overallZmm).toBeCloseTo(145, 6)
    expect(layout.lines.map(l => l.id)).toEqual([
      'wall-dim-wall-001', 'overall-dimension-x', 'overall-dimension-z',
    ])
  })

  it('includes the California corner and top-plate laps in the exterior AABB', () => {
    const doc = create(6000)
    const front = doc.building.walls[0]
    doc.building.walls.push({
      ...front, wallId: 'wall-002', lengthMm: 3000, orientation: 'z',
      origin: rightCornerOrigin(front, front), openings: [],
    })
    const rebuilt = buildProjectSnapshot(doc)
    const layout = buildDimensionLayout(rebuilt.building.walls, projectToScene(rebuilt).elements)
    const side = layout.lines.find(l => l.id === 'wall-dim-wall-002')!
    expect(side.valueMm).toBe(3000)
    expect(side.from.x).toBe(5927.5)
    expect(side.from.z).toBe(-72.5)
    expect(side.to.z).toBe(-3072.5)
    expect(layout.bounds.maxX).toBeCloseTo(6000, 6)
    expect(layout.bounds.minZ).toBeCloseTo(-3072.5, 6)
    expect(layout.overallXmm).toBeCloseTo(6000, 6)
    expect(layout.overallZmm).toBeCloseTo(3145, 6)
    expect(rebuilt.building.walls[0].origin.x).toBe(0)
  })

  it('recalculates when wall length changes, not when the camera moves', () => {
    const doc = create()
    const before = JSON.stringify(doc)
    const d1 = buildDimensionLayout(doc.building.walls, projectToScene(doc).elements)
    const doc2 = buildProjectSnapshot({
      ...doc, building: {
        ...doc.building,
        walls: doc.building.walls.map(w => ({ ...w, lengthMm: 5200 })),
      },
    })
    const d2 = buildDimensionLayout(doc2.building.walls, projectToScene(doc2).elements)
    expect(d1.overallXmm).toBeCloseTo(4000, 6)
    expect(d2.overallXmm).toBeCloseTo(5200, 6)
    expect(d2.lines[0].to.x).toBe(5200)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('preserves nonzero origins of imported projects rather than rebasing silently', () => {
    const doc = create()
    doc.building.walls[0].origin = { x: -1800, y: 0, z: 210 }
    const rebuilt = buildProjectSnapshot(doc)
    const dim = buildDimensionLayout(rebuilt.building.walls, projectToScene(rebuilt).elements)
    expect(dim.lines[0].from).toEqual({ x: -1800, y: 0, z: 210 })
    expect(dim.lines[0].to.x).toBe(2200)
    expect(dim.overallXmm).toBeCloseTo(4000, 6)
  })

  it('never repeats dimension IDs when nine walls share one direction', () => {
    const doc = create()
    const template = doc.building.walls[0]
    for (let i = 2; i <= 9; i++) {
      doc.building.walls.push({
        ...template, wallId: 'wall-' + String(i).padStart(3, '0'),
        origin: { x: (i - 1) * 4000, y: 0, z: 0 }, openings: [],
      })
    }
    const updated = buildProjectSnapshot(doc)
    const dims = buildDimensionLayout(updated.building.walls, projectToScene(updated).elements)
    expect(dims.lines).toHaveLength(11)
    expect(new Set(dims.lines.map(l => l.id)).size).toBe(11)
    expect(dims.overallXmm).toBeCloseTo(36000, 6)
  })
})
