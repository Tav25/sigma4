import { describe, it, expect } from 'vitest'
import { validateProject } from './frame-validator'
import { createProjectFromCurrentState } from './project-store'
import type { WindowOpening } from './window'

const DEFAULT_PARAMS = { length: 6000, height: 2700, spacing: 600 }
const DEFAULT_OPENINGS: WindowOpening[] = [
  { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
]

describe('FrameValidator - Level A: Structure', () => {
  it('validates required top-level sections', () => {
    const result = validateProject({})
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'MISSING_PROJECT')).toBe(true)
    expect(result.issues.some(i => i.code === 'MISSING_BUILDING')).toBe(true)
    expect(result.issues.some(i => i.code === 'MISSING_ASSEMBLY')).toBe(true)
    expect(result.issues.some(i => i.code === 'MISSING_VALIDATION')).toBe(true)
  })

  it('validates schema version', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.project.schemaVersion = '2.0.0'
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'UNSUPPORTED_SCHEMA_VERSION')).toBe(true)
  })

  it('validates positive dimensions', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.walls[0].lengthMm = 0
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'INVALID_POSITIVE_VALUE')).toBe(true)
  })

  it('validates unique IDs across walls', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.walls.push({ ...doc.building.walls[0], wallId: doc.building.walls[0].wallId })
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'DUPLICATE_WALL_ID')).toBe(true)
  })

  it('validates unique IDs across openings', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings.push({ ...doc.building.openings[0], id: doc.building.openings[0].id })
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'DUPLICATE_OPENING_ID')).toBe(true)
  })

  it('validates opening references existing wall', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings[0].wallId = 'non-existent'
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_REF_INVALID_WALL')).toBe(true)
  })

  it('validates marker references existing opening', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.markers[0].openingId = 'non-existent'
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'MARKER_REF_INVALID_OPENING')).toBe(true)
  })

  it('validates assembly element references', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.assembly.elements[0].wallId = 'non-existent'
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'ELEMENT_REF_INVALID_WALL')).toBe(true)
  })
})

describe('FrameValidator - Level B: Geometry & Construction', () => {
  it('validates opening within wall bounds', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings[0].positionUmm = -100
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_NEGATIVE_POSITION' || i.code === 'OPENING_OUT_OF_BOUNDS')).toBe(true)
  })

  it('validates opening not exceeding wall length', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings[0].positionUmm = 5000
    doc.building.openings[0].widthMm = 2000
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_OUT_OF_BOUNDS')).toBe(true)
  })

  it('validates opening height within wall height', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings[0].sillHeightMm = 2000
    doc.building.openings[0].heightMm = 1000
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_TOO_TALL')).toBe(true)
  })

  it('detects framing overlap between openings', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.building.openings[0].positionUmm = 1000
    doc.building.openings[0].widthMm = 2000
    doc.building.openings[1].positionUmm = 2500
    doc.building.openings[1].widthMm = 2000
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENINGS_FRAME_OVERLAP')).toBe(true)
  })

  it('detects element out of wall bounds', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.assembly.elements[0].position.x = -100
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'ELEMENT_OUT_OF_WALL_BOUNDS')).toBe(true)
  })

  it('detects duplicate element IDs in assembly', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    doc.assembly.elements.push({ ...doc.assembly.elements[0], elementId: doc.assembly.elements[0].elementId })
    const result = validateProject(doc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'DUPLICATE_ELEMENT_IN_ASSEMBLY')).toBe(true)
  })
})

describe('FrameValidator - Level C: Engineering Strength', () => {
  it('returns not_evaluated for engineering status', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    const result = validateProject(doc)
    expect(result.engineeringStatus).toBe('not_evaluated')
  })
})

describe('FrameValidator - ValidationResult structure', () => {
  it('returns proper structure with issues', () => {
    const doc = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS })
    const result = validateProject(doc)
    expect(result).toHaveProperty('valid')
    expect(result).toHaveProperty('issues')
    expect(result).toHaveProperty('engineeringStatus')
    expect(Array.isArray(result.issues)).toBe(true)
    result.issues.forEach(issue => {
      expect(issue).toHaveProperty('code')
      expect(issue).toHaveProperty('severity')
      expect(issue).toHaveProperty('path')
      expect(issue).toHaveProperty('messageRu')
      expect(issue).toHaveProperty('affectedIds')
      expect(Array.isArray(issue.affectedIds)).toBe(true)
    })
  })

  it('handles invalid JSON gracefully', () => {
    const result = validateProject(null)
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0].code).toBe('INVALID_DOCUMENT')
  })
})