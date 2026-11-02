import { describe, it, expect, beforeEach } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'

const createTestDoc = () => createProjectFromCurrentState({
  length: 6000,
  height: 2700,
  spacing: 600,
  openings: [
    { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
    { id: 'W02', positionXmm: 4380, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  ],
  projectId: 'test-door-001',
  projectName: 'Test Door Project',
})

describe('S02.2 - Door Framing Synchronization', () => {
  let store: ReturnType<typeof createProjectStore>
  let initialDoc: ReturnType<typeof createTestDoc>

  beforeEach(() => {
    initialDoc = createTestDoc()
    store = createProjectStore(initialDoc)
  })

  it('should reproduce the bug: door not in ProjectStore openings', () => {
    // The door is NOT in the store's openings
    const openings = store.getSnapshot().building.openings
    const doorOpening = openings.find(o => o.id === 'D01')
    expect(doorOpening).toBeUndefined() // This is the bug!
  })

  it('should have door framing elements when door is in openings', () => {
    // Manually add door to openings via REPLACE_PROJECT to test framing generation
    const docWithDoor = store.getSnapshot()
    docWithDoor.building.openings.push({
      id: 'D01',
      wallId: 'wall-001',
      type: 'door',
      positionUmm: 2700,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
    })
    
    const result = store.dispatch({ type: 'REPLACE_PROJECT', payload: { document: docWithDoor } })
    expect(result.success).toBe(true)
    
    const elements = store.getSnapshot().assembly.elements
    const doorElements = elements.filter(e => e.elementId.startsWith('D01-'))
    
    // Check for required door framing elements
    expect(doorElements.find(e => e.role === 'king-stud' && e.elementId.includes('king-left'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'king-stud' && e.elementId.includes('king-right'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'jack-stud' && e.elementId.includes('jack-left'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'jack-stud' && e.elementId.includes('jack-right'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'header')).toBeDefined()
    
    // Check bottom plate is split
    const bottomPlates = elements.filter(e => e.role === 'bottom-plate')
    const leftPlate = bottomPlates.find(e => e.elementId.includes('left'))
    const rightPlate = bottomPlates.find(e => e.elementId.includes('right'))
    expect(leftPlate).toBeDefined()
    expect(rightPlate).toBeDefined()
    // Left plate should end at door start (2700)
    expect(leftPlate?.lengthMm).toBe(2700)
    // Right plate should start at door end (3600) and go to wall end (6000)
    expect(rightPlate?.position.x).toBe(3600)
    
    // No studs inside door opening
    const studsInDoor = elements.filter(e => 
      e.role === 'stud' && 
      e.position.x > 2700 && 
      e.position.x < 3600
    )
    expect(studsInDoor.length).toBe(0)
  })

  it('should remove door framing when door is removed', () => {
    // First add door
    let docWithDoor = store.getSnapshot()
    docWithDoor.building.openings.push({
      id: 'D01',
      wallId: 'wall-001',
      type: 'door',
      positionUmm: 2700,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
    })
    store.dispatch({ type: 'REPLACE_PROJECT', payload: { document: docWithDoor } })
    
    // Then remove door
    const docWithoutDoor = store.getSnapshot()
    docWithoutDoor.building.openings = docWithoutDoor.building.openings.filter(o => o.id !== 'D01')
    store.dispatch({ type: 'REPLACE_PROJECT', payload: { document: docWithoutDoor } })
    
    const elements = store.getSnapshot().assembly.elements
    const doorElements = elements.filter(e => e.elementId.startsWith('D01-'))
    expect(doorElements.length).toBe(0)
    
    // Bottom plate should be restored to single piece (single sill plate)
    const bottomPlates = elements.filter(e => e.role === 'bottom-plate')
    expect(bottomPlates.length).toBe(1) // single sill plate
    const fullBottomPlate = bottomPlates.find(e => e.role === 'bottom-plate' && e.lengthMm === 6000)
    expect(fullBottomPlate).toBeDefined()
    
    // Top plates should be double (2 pieces)
    const topPlates = elements.filter(e => e.role === 'top-plate')
    expect(topPlates.length).toBe(2)
  })
})