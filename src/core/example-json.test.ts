import { describe, it, expect } from 'vitest'
import { serializeProject, createProjectFromCurrentState } from './project-store'
import * as fs from 'node:fs'

describe('example.sigma4.json generation', () => {
  it('should generate and save example.sigma4.json', () => {
    const doc = createProjectFromCurrentState({
      length: 6000,
      height: 2700,
      spacing: 600,
      openings: [
        { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
        { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' }
      ],
      projectId: 'example-001',
      projectName: 'SIGMA4 Example Project'
    })

    const json = serializeProject(doc)
    fs.writeFileSync('example.sigma4.json', json, 'utf8')
    
    expect(json).toContain('"schemaVersion": "1.0.0"')
    expect(json).toContain('"projectId": "example-001"')
    expect(json).toContain('"projectName": "SIGMA4 Example Project"')
  })

  it('should validate generated example.sigma4.json', () => {
    const doc = createProjectFromCurrentState({
      length: 6000,
      height: 2700,
      spacing: 600,
      openings: [
        { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
        { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' }
      ],
      projectId: 'example-001',
      projectName: 'SIGMA4 Example Project'
    })

    const json = serializeProject(doc)
    const reparsed = JSON.parse(json)
    
    expect(reparsed.project.projectId).toBe('example-001')
    expect(reparsed.project.projectName).toBe('SIGMA4 Example Project')
    expect(reparsed.project.schemaVersion).toBe('1.0.0')
    expect(reparsed.project.units).toBe('mm')
    expect(reparsed.building.walls.length).toBe(1)
    expect(reparsed.building.walls[0].wallId).toBe('wall-001')
    expect(reparsed.building.walls[0].lengthMm).toBe(6000)
    expect(reparsed.building.openings.length).toBe(2)
    expect(reparsed.building.openings[0].id).toBe('W01')
    expect(reparsed.building.openings[1].id).toBe('W02')
    expect(reparsed.building.markers.length).toBe(2)
    expect(reparsed.validation.valid).toBe(true)
    expect(reparsed.validation.engineeringStatus).toBe('not_evaluated')
  })
})