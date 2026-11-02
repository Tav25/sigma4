import { describe, it, expect } from 'vitest'
import { createProjectFromCurrentState, generateAssemblyFromDocument, buildProjectSnapshot } from './project-store'
import { generateWallModule } from './wall-module'
import { rightCornerOrigin } from './corner'

const sample = () => createProjectFromCurrentState({
  projectId: 's06-modules',
  length: 6000, height: 2700, spacing: 600, openings: [
    { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
    { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  ],
})

describe('S06.1 reusable wall module', () => {
  it('generates the same independent wall without altering the source', () => {
    const doc = sample()
    const before = JSON.stringify(doc)
    const boards = generateWallModule(doc.building.walls[0], doc.building.openings, { unprefixedIds: true })
    expect(boards).toEqual(doc.assembly.elements)
    expect(JSON.stringify(doc)).toBe(before)
    expect(boards.every(board => board.wallId === 'wall-001')).toBe(true)
  })

  it('isolates each wall by wallId even when the opening array is shared', () => {
    const doc = sample()
    const front = doc.building.walls[0]
    const side = { ...front, wallId: 'wall-002', lengthMm: 3000,
      orientation: 'z' as const, origin: rightCornerOrigin(front, front), openings: [] }
    const sideBoards = generateWallModule(side, doc.building.openings)
    expect(sideBoards).toHaveLength(9)
    expect(sideBoards.every(board => board.wallId === 'wall-002' && board.elementId.startsWith('wall-002:'))).toBe(true)
    expect(sideBoards.some(board => board.elementId.includes('W01'))).toBe(false)
  })

  it('uses the same local framing algorithm for windows and doors on any wall', () => {
    const doc = sample()
    const front = doc.building.walls[0]
    const side = { ...front, wallId: 'wall-002', lengthMm: 6000,
      orientation: 'z' as const, origin: rightCornerOrigin(front, front), openings: ['W03', 'D01'] }
    const sideOpenings = [
      { id: 'W03', wallId: 'wall-002', positionUmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' as const },
      { id: 'D01', wallId: 'wall-002', positionUmm: 3300, widthMm: 900, heightMm: 2100, sillHeightMm: 0, type: 'door' as const },
    ]
    const boards = generateWallModule(side, [...doc.building.openings, ...sideOpenings])
    expect(boards.some(board => board.elementId.includes('W03-king-left'))).toBe(true)
    expect(boards.some(board => board.elementId.includes('D01-king-left'))).toBe(true)
    expect(boards.every(board => board.wallId === 'wall-002')).toBe(true)
    expect(doc.building.openings).toHaveLength(2)
  })

  it('retains California corner geometry and connections after regeneration', () => {
    const doc = sample()
    const front = doc.building.walls[0]
    const second = { ...front, wallId: 'wall-002', lengthMm: 3000,
      orientation: 'z' as const, origin: rightCornerOrigin(front, front), openings: [] }
    doc.building.walls.push(second)
    const rebuilt = buildProjectSnapshot(doc)
    expect(rebuilt.assembly.elements).toHaveLength(46)
    const backing = rebuilt.assembly.elements.find(element => element.elementId === 'warm-corner-stud')!
    expect(backing.position.x).toBe(5810)
    expect(backing.connectionIds).toEqual(['stud-11', 'wall-002:stud-01'])
    expect(generateAssemblyFromDocument(rebuilt)).toEqual(rebuilt.assembly)
  })
})
