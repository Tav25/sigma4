import {
  generateWallPanel,
  type WallPanelParams,
} from './wall'
import {
  generateWallWithOpenings,
  type WindowOpening,
} from './window'
import type {
  ProjectDocument,
  Wall,
  Opening,
  Marker,
  Material,
  TimberElement,
  Assembly,
  ValidationResult,
  Vector3,
  Orientation,
} from './project'
import { validateProject } from './frame-validator'

const SW = 45
const SH = 145

function createTimberElement(params: {
  elementId: string
  wallId: string
  role: TimberElement['role']
  sectionMm: { width: number; height: number }
  lengthMm: number
  orientation: Orientation
  position: Vector3
  connectionIds?: string[]
  generated?: boolean
}): TimberElement {
  return {
    elementId: params.elementId,
    wallId: params.wallId,
    role: params.role,
    sectionMm: params.sectionMm,
    lengthMm: params.lengthMm,
    orientation: params.orientation,
    position: params.position,
    connectionIds: params.connectionIds || [],
    generated: params.generated ?? true,
  }
}

export function generateAssemblyFromDocument(doc: ProjectDocument): Assembly {
  const { building } = doc
  const allElements: TimberElement[] = []

  building.walls.forEach((wall, wallIndex) => {
    const params: WallPanelParams = {
      length: wall.lengthMm,
      height: wall.heightMm,
      sectionWidth: wall.sectionMm.width,
      sectionHeight: wall.sectionMm.height,
      spacing: wall.studSpacingMm,
      topLayers: 2,
    }

    const wallOpenings: WindowOpening[] = building.openings
      .filter(o => o.wallId === wall.wallId)
      .map(o => ({
        id: o.id,
        positionXmm: o.positionUmm,
        widthMm: o.widthMm,
        heightMm: o.heightMm,
        sillHeightMm: o.sillHeightMm,
        type: o.type,
      }))
      .sort((a, b) => a.positionXmm - b.positionXmm)

    let assembly: { elements: any[] }
    if (wallOpenings.length > 0) {
      assembly = generateWallWithOpenings(params, wallOpenings)
    } else {
      assembly = generateWallPanel(params)
    }

    // Warm right-angle junction: the lower top plates meet at the faces.
    // The uppermost plates lap: front stops one stud-depth before the end,
    // side crosses over it by that depth, at the same Y level.
    const inCorner = building.walls.length === 2
    const front = inCorner && wallIndex === 0
    const right = inCorner && wallIndex === 1
    if (front) {
      const top = assembly.elements.find(el => el.id === 'plate-top-2')
      if (top) top.length -= wall.sectionMm.height
      // The Canadian warm corner needs an inner nailer/support stud as well:
      // two 45-mm facade uprights joined edge-to-edge, backed
      // by the perpendicular wall's start stud. The next bay stays insulated.
      // Unlike the old 20-mm cleat, this is a real 45x145 framing member.
      assembly.elements.push({
        id: 'warm-corner-stud',
        role: 'corner-backing',
        length: wall.heightMm - wall.sectionMm.width * 3,
        width: wall.sectionMm.width,
        height: wall.sectionMm.height,
        position: {
          x: wall.lengthMm - wall.sectionMm.width * 2 + wall.sectionMm.width / 2,
          y: wall.sectionMm.width,
          z: -wall.sectionMm.height / 2,
        },
        orientation: { mode: 'y', angle: 0, roll: 0 },
      })
    }
    if (right) {
      const top = assembly.elements.find(el => el.id === 'plate-top-2')
      if (top) {
        top.position = { ...top.position, x: -wall.sectionMm.height }
        top.length += wall.sectionMm.height
      }
    }

    assembly.elements.forEach((el: any) => {
      const timberEl = createTimberElement({
        elementId: wallIndex === 0 ? el.id : `${wall.wallId}:${el.id}`,
        wallId: wall.wallId,
        role: el.role,
        sectionMm: { width: el.width, height: el.height },
        lengthMm: el.length,
        orientation: el.orientation,
        position: el.position,
        connectionIds: [],
        generated: true,
      })
      allElements.push(timberEl)
    })
  })

  if (building.walls.length === 2) {
    const front = building.walls[0]
    const right = building.walls[1]
    const firstEnd = allElements
      .filter(e => e.wallId === front.wallId && e.role === 'stud')
      .sort((a, b) => b.position.x - a.position.x)[0]
    const rightStart = allElements
      .filter(e => e.wallId === right.wallId && e.role === 'stud')
      .sort((a, b) => a.position.x - b.position.x)[0]
    if (firstEnd && rightStart) {
      firstEnd.connectionIds = [rightStart.elementId]
      rightStart.connectionIds = [firstEnd.elementId]
    }
    const insideStud = allElements.find(e => e.wallId === front.wallId && e.elementId === 'warm-corner-stud')
    if (insideStud && rightStart && firstEnd) {
      // All three physically meet at their faces; the inner stud must not
      // stand separately in the preceding stud bay.
      insideStud.connectionIds = [firstEnd.elementId, rightStart.elementId]
      firstEnd.connectionIds.push(insideStud.elementId)
      rightStart.connectionIds.push(insideStud.elementId)
    }
    const frontUpper = allElements.find(e => e.wallId === front.wallId && e.elementId === 'plate-top-2')
    const rightUpper = allElements.find(e => e.wallId === right.wallId && e.elementId === `${right.wallId}:plate-top-2`)
    if (frontUpper && rightUpper) {
      frontUpper.connectionIds = [rightUpper.elementId]
      rightUpper.connectionIds = [frontUpper.elementId]
    }
  }
  return { elements: allElements }
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
      schemaVersion: '1.0.0',
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
  const parsed = JSON.parse(json)
  const validation = validateProject(parsed)
  if (!validation.valid) {
    const errors = validation.issues.filter(i => i.severity === 'error')
    throw new Error(`Invalid project: ${errors.map(e => e.messageRu).join('; ')}`)
  }
  return parsed as ProjectDocument
}

export function validateProjectSnapshot(doc: ProjectDocument): ValidationResult {
  return validateProject(doc)
}

export function buildProjectSnapshot(doc: ProjectDocument): ProjectDocument {
  // Legacy SIGMA4 documents stored the 45mm stud face as wall thickness,
  // even though the physical wall depth (stud section height) is 145mm.
  // Correct it during a validated rebuild/import without changing the
  // stud dimensions, wall placement, openings or the original input.
  const newDoc: ProjectDocument = {
    ...doc,
    building: {
      ...doc.building,
      walls: doc.building.walls.map(wall => ({
        ...wall,
        thicknessMm: wall.sectionMm.height,
      })),
    },
  }
  newDoc.assembly = generateAssemblyFromDocument(newDoc)
  newDoc.validation = validateProject(newDoc)
  return newDoc
}