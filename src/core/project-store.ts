import type { WindowOpening } from './window'
import type {
  ProjectDocument,
  Wall,
  Opening,
  Marker,
  Material,
  Assembly,
  ValidationResult,
} from './project'
import { validateProject } from './frame-validator'
import { generateWallModule } from './wall-module'
import { connectRightCaliforniaCorner } from './corner-connection'
import { effectiveConnections } from './wall-topology'
import { wallFrameInsets } from './wall-chain'
import { CURRENT_COORDINATE_SCHEMA, migrateLegacyWallOrigins } from './world-origin'

const SW = 45
const SH = 145

export function generateAssemblyFromDocument(doc: ProjectDocument): Assembly {
  // This generator knows nothing about wall numbers. Every instance uses the
  // same module; wallId ownership is preserved in each generated board.
  const elements = doc.building.walls.flatMap((wall, index) => {
    const { startMm, endMm } = wallFrameInsets(doc, wall.wallId)
    return generateWallModule(wall, doc.building.openings, {
      unprefixedIds: index === 0, startInsetMm: startMm, endInsetMm: endMm,
    })
  })
  // Physical joinery is independent of each individual wall's framing.
  const links = effectiveConnections(doc)
  for (const link of links) {
    if (link.type !== 'california-right') continue
    const from = doc.building.walls.find(w => w.wallId === link.fromWallId)
    const to = doc.building.walls.find(w => w.wallId === link.toWallId)
    if (from && to) connectRightCaliforniaCorner(elements, from, to)
  }
  return { elements }
}

function createDefaultMarkers(openings: Opening[]): Marker[] {
  return openings.map(o => ({
    openingId: o.id,
    anchor: 'center' as const,
    outsideOffsetMm: 50,
    elevationMm: o.sillHeightMm + o.heightMm / 2,
    visible: true,
    color: '#0066ff',
  }))
}

function createDefaultMaterials(): Material[] {
  return [
    { id: 'wood-c24', name: 'Сосна/Ель С24', densityKgM3: 420, strengthClass: 'C24' },
  ]
}

export function createProjectDocument(params: {
  projectId: string
  projectName: string
  wall: Wall
  openings: Opening[]
  materials?: Material[]
}): ProjectDocument {
  const materials = params.materials || createDefaultMaterials()
  const markers = createDefaultMarkers(params.openings)

  const doc: ProjectDocument = {
    project: {
      schemaVersion: CURRENT_COORDINATE_SCHEMA,
      projectId: params.projectId,
      projectName: params.projectName,
      units: 'mm',
      rulesetId: 'sigma4-ruleset',
      rulesetVersion: '1.0.0',
      generatorVersion: '1.0.0',
    },
    building: {
      materials,
      walls: [params.wall],
      openings: params.openings,
      markers,
    },
    assembly: { elements: [] },
    validation: { valid: true, issues: [], engineeringStatus: 'not_evaluated' },
  }

  doc.assembly = generateAssemblyFromDocument(doc)
  doc.validation = validateProject(doc)

  return doc
}

export function createProjectFromCurrentState(params: {
  length: number
  height: number
  spacing: number
  openings: WindowOpening[]
  projectId?: string
  projectName?: string
}): ProjectDocument {
  const wall: Wall = {
    wallId: 'wall-001',
    lengthMm: params.length,
    heightMm: params.height,
    thicknessMm: SH,
    studSpacingMm: params.spacing,
    sectionMm: { width: SW, height: SH },
    orientation: 'x',
    // Authored origin IS the physical outer lower-left corner.
    // Internal stud midplane offset is applied only during 3D projection.
    origin: { x: 0, y: 0, z: 0 },
    openings: params.openings.map(o => o.id),
  }

  const openings: Opening[] = params.openings.map(o => ({
    id: o.id,
    wallId: 'wall-001',
    type: o.type,
    positionUmm: o.positionXmm,
    widthMm: o.widthMm,
    heightMm: o.heightMm,
    sillHeightMm: o.sillHeightMm,
  }))

  return createProjectDocument({
    projectId: params.projectId || `proj-${Date.now()}`,
    projectName: params.projectName || 'SIGMA4 Project',
    wall,
    openings,
  })
}

export function serializeProject(doc: ProjectDocument): string {
  return JSON.stringify(doc, null, 2)
}

export function parseProject(json: string): ProjectDocument {
  const parsed = migrateLegacyWallOrigins(JSON.parse(json) as ProjectDocument)
  const rebuilt = buildProjectSnapshot(parsed)
  const validation = validateProject(rebuilt)
  if (!validation.valid) {
    const errors = validation.issues.filter(i => i.severity === 'error')
    throw new Error(`Invalid project: ${errors.map(e => e.messageRu).join('; ')}`)
  }
  return rebuilt
}

export function validateProjectSnapshot(doc: ProjectDocument): ValidationResult {
  return validateProject(doc)
}

export function buildProjectSnapshot(doc: ProjectDocument): ProjectDocument {
  const source = migrateLegacyWallOrigins(doc)
  // Legacy SIGMA4 documents stored the 45mm stud face as wall thickness,
  // even though the physical wall depth (stud section height) is 145mm.
  // Correct it during a validated rebuild/import without changing the
  // stud dimensions, wall placement, openings or the original input.
  const newDoc: ProjectDocument = {
    ...source,
    building: {
      ...source.building,
      walls: source.building.walls.map(wall => ({
        ...wall,
        thicknessMm: wall.sectionMm.height,
      })),
    },
  }
  newDoc.assembly = generateAssemblyFromDocument(newDoc)
  newDoc.validation = validateProject(newDoc)
  return newDoc
}