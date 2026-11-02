import { describe, it, expect } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from '../core/project-store'
import { rightCornerOrigin } from '../core/corner'
import { projectToScene } from './project-to-scene'
import { buildDimensionLayout, formatDimensionNumber, dimensionLabelYaw, exteriorExtensionFoot } from './dimension-model'

const create = (length = 4000) => createProjectFromCurrentState({
  projectId: 's06-5-coordinates', length, height: 2700, spacing: 600, openings: [],
})

describe('S06.5 coordinates and real dimensions', () => {
  it('aligns numeric labels along their own X and -Z wall, not a common axis', () => {
    const doc = create(6000)
    const first = doc.building.walls[0]
    doc.building.walls.push({
      ...first, wallId: 'wall-002', lengthMm: 3000, orientation: 'z',
      origin: rightCornerOrigin(first, first), openings: [],
    })
    const rebuilt = buildProjectSnapshot(doc)
    const layout = buildDimensionLayout(rebuilt.building.walls, projectToScene(rebuilt).elements)
    const xWall = layout.lines.find(line => line.id === 'wall-dim-wall-001')!
    const zWall = layout.lines.find(line => line.id === 'wall-dim-wall-002')!
    expect(dimensionLabelYaw(xWall)).toBeCloseTo(0, 8)
    expect(dimensionLabelYaw(zWall)).toBeCloseTo(Math.PI / 2, 8)
    expect(dimensionLabelYaw(layout.lines.find(line => line.id === 'overall-dimension-x')!))
      .toBeCloseTo(0, 8)
    expect(dimensionLabelYaw(layout.lines.find(line => line.id === 'overall-dimension-z')!))
      .toBeCloseTo(Math.PI / 2, 8)
  })

  it('puts the first wall dimension just 220 mm from its OWN timber even with a long second wall', () => {
    const doc = create(6000)
    const front = doc.building.walls[0]
    doc.building.walls.push({
      ...front, wallId: 'wall-002', lengthMm: 10000,
      orientation: 'z', origin: rightCornerOrigin(front, front), openings: [],
    })
    const rebuilt = buildProjectSnapshot(doc)
    const projection = projectToScene(rebuilt)
    expect(projection.elements.filter(element => element.wallId === 'wall-001').length).toBeGreaterThan(5)
    expect(projection.elements.filter(element => element.wallId === 'wall-002').length).toBeGreaterThan(5)
    const layout = buildDimensionLayout(rebuilt.building.walls, projection.elements)
    const facade = layout.lines[0]
    const side = layout.lines[1]
    const totalX = layout.lines[2]
    const totalZ = layout.lines[3]
    expect(facade.id).toBe('wall-dim-wall-001')
    expect(side.id).toBe('wall-dim-wall-002')
    // Local placements, not the 10-m global footprint!
    expect(facade.dimensionFrom.z).toBeGreaterThan(front.origin.z)
    expect(facade.dimensionFrom.z).toBeLessThan(front.origin.z + 400)
    expect(side.dimensionFrom.x).toBeGreaterThan(doc.building.walls[1].origin.x)
    expect(side.dimensionFrom.x).toBeLessThan(doc.building.walls[1].origin.x + 400)
    expect(facade.dimensionFrom.z - facade.extensionFrom.z).toBeCloseTo(175, 6)
    expect(side.dimensionFrom.x - side.extensionFrom.x).toBeCloseTo(175, 6)
    // Global exterior dimensions are a second tier, nearby, not opposite.
    expect(totalX.dimensionFrom.z).toBeGreaterThan(facade.dimensionFrom.z)
    expect(totalX.dimensionFrom.z - facade.dimensionFrom.z).toBeLessThan(320)
    expect(totalZ.dimensionFrom.x).toBeGreaterThan(side.dimensionFrom.x)
    expect(totalZ.dimensionFrom.x - side.dimensionFrom.x).toBeLessThan(320)
    expect(totalX.dimensionFrom.z - totalX.extensionFrom.z).toBeCloseTo(415, 6)
    expect(totalZ.dimensionFrom.x - totalZ.extensionFrom.x).toBeCloseTo(415, 6)
    for (const line of layout.lines) {
      for (const end of ['from', 'to'] as const) {
        const foot = exteriorExtensionFoot(line, layout.bounds, end)
        const towards = end === 'from' ? line.dimensionFrom : line.dimensionTo
        expect(foot.y).toBe(0)
        if (Math.abs(line.dimensionFrom.x - line.dimensionTo.x) > 0) {
          expect(foot.x).toBe(towards.x)
          expect(foot.z).toBeLessThan(towards.z)
        } else {
          expect(foot.z).toBe(towards.z)
          expect(foot.x).toBeLessThan(towards.x)
        }
      }
    }
  })

  it('keeps independent wall dimensions near their individual wall, not the global model boundary', () => {
    const doc = create()
    const first = doc.building.walls[0]
    doc.building.walls.push({
      ...first, wallId: 'wall-002', origin: { x: 9500, y: 0, z: -12000 },
      openings: [],
    })
    const rebuilt = buildProjectSnapshot(doc)
    const dims = buildDimensionLayout(rebuilt.building.walls, projectToScene(rebuilt).elements)
    expect(Math.abs(dims.lines[0].dimensionFrom.z - first.origin.z)).toBeLessThan(400)
    expect(Math.abs(dims.lines[1].dimensionFrom.z + 12000)).toBeLessThan(400)
    expect(dims.lines[0].dimensionFrom.z).toBeGreaterThan(dims.bounds.minZ + 10000)
    expect(dims.lines[1].dimensionFrom.z).toBeLessThan(dims.bounds.maxZ - 10000)
  })

  it('keeps render geometry and text metadata independent from JSON', () => {
    const doc = create()
    const before = JSON.stringify(doc)
    const layout = buildDimensionLayout(doc.building.walls, projectToScene(doc).elements)
    const yaw = dimensionLabelYaw(layout.lines[0])
    const feet = exteriorExtensionFoot(layout.lines[0], layout.bounds, 'from')
    expect(yaw).toBe(0)
    expect(feet.z).toBeGreaterThan(layout.bounds.maxZ)
    expect(JSON.stringify(doc)).toBe(before)
  })


  it('renders numerical millimetres only, without labels or units', () => {
    expect(formatDimensionNumber(4000)).toBe('4000')
    expect(formatDimensionNumber(3145.2)).toBe('3145')
    expect(formatDimensionNumber(12500)).toMatch(/^\d+$/)
    expect(() => formatDimensionNumber(Number.NaN)).toThrow()
    expect(() => formatDimensionNumber(-100)).toThrow()
  })

  it('projects every measurement and extension endpoint to the horizontal XZ plane', () => {
    const doc = create()
    const walls = doc.building.walls
    const dimensions = buildDimensionLayout(walls, projectToScene(doc).elements)
    for (const dimension of dimensions.lines) {
      for (const endpoint of [dimension.from, dimension.to,
        dimension.dimensionFrom, dimension.dimensionTo]) {
        expect(endpoint.y).toBe(0)
      }
      expect(formatDimensionNumber(dimension.valueMm)).toMatch(/^\d+$/)
    }
    expect(dimensions.lines.some(dim => 'label' in dim)).toBe(false)
  })

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
