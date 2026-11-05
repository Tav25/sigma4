export interface ProjectMeta {
  schemaVersion: string
  projectId: string
  projectName: string
  units: 'mm'
  rulesetId: string
  rulesetVersion: string
  generatorVersion: string
}

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Orientation {
  mode: 'x' | 'y' | 'z' | 'slope'
  angle: number
  roll: number
}

export interface Material {
  id: string
  name: string
  densityKgM3: number
  strengthClass?: string
}

export interface Wall {
  wallId: string
  lengthMm: number
  heightMm: number
  thicknessMm: number
  studSpacingMm: number
  sectionMm: { width: number; height: number }
  orientation: 'x' | 'y' | 'z'
  /** Lower OUTSIDE corner in global millimetres; NOT the stud midplane. */
  origin: Vector3
  openings: string[]
}

export interface WallConnection {
  fromWallId: string
  toWallId: string
  type: 'california-right' | 'end-to-end'
}

export interface GarageDoorSpec {
  installationProfile: 'clopay-standard-torsion'
  minSideRoomMm: number
  minHeadRoomMm: number
  minBackRoomExtraMm: number
  /** Preliminary drawing dimension: structural capacity NOT verified. */
  lintelPreviewDepthMm: number
  jackStudsPerSide: number
}

export interface Opening {
  id: string
  wallId: string
  type: 'window' | 'door' | 'garage-door'
  garage?: GarageDoorSpec
  positionUmm: number
  widthMm: number
  heightMm: number
  sillHeightMm: number
}

export type WindowOpening = Opening

export interface Marker {
  openingId: string
  anchor: 'center' | 'left' | 'right'
  outsideOffsetMm: number
  elevationMm: number
  visible: boolean
  color: string
}

export interface TimberElement {
  elementId: string
  wallId: string
  role: 'stud' | 'king-stud' | 'jack-stud' | 'cripple-stud' | 'cripple-bottom' | 'cripple-top' | 'bottom-plate' | 'top-plate' | 'header' | 'sill' | 'corner-backing' | 'garage-lintel-preview'
  sectionMm: { width: number; height: number }
  lengthMm: number
  orientation: Orientation
  position: Vector3
  connectionIds: string[]
  generated: boolean
}

export interface Assembly {
  elements: TimberElement[]
}

export interface ValidationIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  path: string
  messageRu: string
  affectedIds: string[]
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  engineeringStatus: 'not_evaluated' | 'passed' | 'failed'
}

export interface ProjectDocument {
  project: ProjectMeta
  building: {
    materials: Material[]
    walls: Wall[]
    /** Optional for backward compatibility with legacy two-wall projects. */
    connections?: WallConnection[]
    openings: Opening[]
    markers: Marker[]
  }
  assembly: Assembly
  validation: ValidationResult
}