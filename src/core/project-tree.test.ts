import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState, buildProjectSnapshot } from './project-store'
import { buildProjectTree } from './project-tree'
import { rightCornerOrigin } from './corner'

function example() {
  const doc = createProjectFromCurrentState({
    projectId: 's06-tree', projectName: 'Дом с модулями',
    length: 6000, height: 2700, spacing: 600,
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  })
  const front = doc.building.walls[0]
  doc.building.walls.push({
    ...front, wallId: 'wall-002', orientation: 'z', lengthMm: 3000,
    origin: rightCornerOrigin(front, front), openings: [],
  })
  return buildProjectSnapshot(doc)
}

describe('S06.1 project tree is a read-only view of canonical JSON', () => {
  it('groups 46 distinct boards and 2 windows under their walls', () => {
    const doc = example()
    const before = JSON.stringify(doc)
    const tree = buildProjectTree(doc)
    expect(tree.name).toBe('Дом с модулями')
    expect(tree.walls).toHaveLength(2)
    expect(tree.walls[0].windows.map(window => window.id)).toEqual(['W01', 'W02'])
    expect(tree.walls[1].windows).toEqual([])
    expect(tree.walls[1].doors).toEqual([])
    expect(tree.walls.map(wall => wall.boards.length)).toEqual([37, 9])
    expect(tree.walls.flatMap(wall => wall.boards).map(board => board.elementId))
      .toEqual(doc.assembly.elements.map(board => board.elementId))
    expect(tree.connections).toEqual([{
      from: 'wall-001', to: 'wall-002', type: 'Калифорнийский угол',
    }])
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('assigns windows and doors only by their owning wallId', () => {
    const doc = example()
    const window = doc.building.openings.find(opening => opening.id === 'W02')!
    window.wallId = 'wall-002'
    doc.building.walls[0].openings = ['W01']
    doc.building.walls[1].openings = ['W02', 'D01']
    doc.building.openings.push({
      id: 'D01', wallId: 'wall-002', type: 'door',
      positionUmm: 100, widthMm: 900, heightMm: 2100, sillHeightMm: 0,
    })
    const tree = buildProjectTree(doc)
    expect(tree.walls[0].windows.map(item => item.id)).toEqual(['W01'])
    expect(tree.walls[0].doors).toHaveLength(0)
    expect(tree.walls[1].windows.map(item => item.id)).toEqual(['W02'])
    expect(tree.walls[1].doors.map(item => item.id)).toEqual(['D01'])
  })

  it('projects nine logical wall branches without changing the JSON schema', () => {
    const doc = example()
    const prototype = doc.building.walls[1]
    for (let number = 3; number <= 9; number++) {
      const wallId = 'wall-' + String(number).padStart(3, '0')
      doc.building.walls.push({ ...prototype, wallId, openings: [] })
    }
    const before = JSON.stringify(doc)
    const tree = buildProjectTree(doc)
    expect(tree.walls).toHaveLength(9)
    expect(new Set(tree.walls.map(node => node.wall.wallId)).size).toBe(9)
    expect(tree.walls[8].windows).toEqual([])
    expect(JSON.stringify(doc)).toBe(before)
    // Physical generation and validation remain limited to two walls in S06.1.
  })
})
