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

describe('S02.2 - Door Commands', () => {
  let store: ReturnType<typeof createProjectStore>

  beforeEach(() => {
    store = createProjectStore(createTestDoc())
  })

  it('should add a door via ADD_OPENING command', () => {
    const result = store.dispatch({
      type: 'ADD_OPENING',
      payload: {
        wallId: 'wall-001',
        opening: { id: 'D01', type: 'door', positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 }
      }
    })
    expect(result.success).toBe(true)
    
    const snapshot = store.getSnapshot()
    const doorOpening = snapshot.building.openings.find(o => o.id === 'D01')
    expect(doorOpening).toBeDefined()
    expect(doorOpening?.type).toBe('door')
    expect(doorOpening?.positionUmm).toBe(2700)
    expect(doorOpening?.widthMm).toBe(900)
    expect(doorOpening?.heightMm).toBe(2100)
    expect(doorOpening?.sillHeightMm).toBe(0)
    
    // Check wall references the door
    const wall = snapshot.building.walls[0]
    expect(wall.openings).toContain('D01')
    
    // Check marker was created
    const marker = snapshot.building.markers.find(m => m.openingId === 'D01')
    expect(marker).toBeDefined()
    
    // Check framing elements
    const elements = snapshot.assembly.elements
    const doorElements = elements.filter(e => e.elementId.startsWith('D01-'))
    expect(doorElements.length).toBeGreaterThan(0)
    expect(doorElements.find(e => e.role === 'king-stud' && e.elementId.includes('king-left'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'jack-stud' && e.elementId.includes('jack-left'))).toBeDefined()
    expect(doorElements.find(e => e.role === 'header')).toBeDefined()
  })

  it('should add a window via ADD_OPENING command', () => {
    const result = store.dispatch({
      type: 'ADD_OPENING',
      payload: {
        wallId: 'wall-001',
        opening: { id: 'W03', type: 'window', positionXmm: 2700, widthMm: 1000, heightMm: 1000, sillHeightMm: 800 }
      }
    })
    expect(result.success).toBe(true)
    
    const snapshot = store.getSnapshot()
    const windowOpening = snapshot.building.openings.find(o => o.id === 'W03')
    expect(windowOpening).toBeDefined()
    expect(windowOpening?.type).toBe('window')
  })

  it('should reject ADD_OPENING with invalid position', () => {
    const result = store.dispatch({
      type: 'ADD_OPENING',
      payload: {
        wallId: 'wall-001',
        opening: { id: 'D01', type: 'door', positionXmm: -100, widthMm: 900, heightMm: 2100, sillHeightMm: 0 }
      }
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('INVALID_POSITION')
  })

  it('should reject ADD_OPENING with duplicate ID', () => {
    store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D01', type: 'door', positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } }
    })
    const result = store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D01', type: 'door', positionXmm: 3000, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } }
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('DUPLICATE_OPENING_ID')
  })

  it('should reject ADD_OPENING with framing overlap', () => {
    // Add first door
    store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D01', type: 'door', positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } }
    })
    // Try to add second door too close
    const result = store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D02', type: 'door', positionXmm: 3300, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } }
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('OPENINGS_FRAME_OVERLAP')
  })

  it('should remove an opening via REMOVE_OPENING command', () => {
    // First add door
    store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D01', type: 'door', positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } }
    })
    
    const result = store.dispatch({ type: 'REMOVE_OPENING', payload: { openingId: 'D01' } })
    expect(result.success).toBe(true)
    
    const snapshot = store.getSnapshot()
    const doorOpening = snapshot.building.openings.find(o => o.id === 'D01')
    expect(doorOpening).toBeUndefined()
    
    // Check wall no longer references the door
    const wall = snapshot.building.walls[0]
    expect(wall.openings).not.toContain('D01')
    
    // Check marker was removed
    const marker = snapshot.building.markers.find(m => m.openingId === 'D01')
    expect(marker).toBeUndefined()
    
    // Check framing elements removed
    const elements = snapshot.assembly.elements
    const doorElements = elements.filter(e => e.elementId.startsWith('D01-'))
    expect(doorElements.length).toBe(0)
    
    // Bottom plate should be restored
    const bottomPlates = elements.filter(e => e.role === 'bottom-plate')
    expect(bottomPlates.length).toBe(1)
    expect(bottomPlates[0].lengthMm).toBe(6000)
  })

  it('should reject REMOVE_OPENING for non-existent opening', () => {
    const result = store.dispatch({ type: 'REMOVE_OPENING', payload: { openingId: 'NONEXISTENT' } })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('OPENING_NOT_FOUND')
  })
})