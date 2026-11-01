export type UUID = string;

export interface Vec2 { x: number; z: number; }
export interface Vec3 { x: number; y: number; z: number; }

export interface Section { w: number; h: number; }

export interface LumberMaterial {
  id: UUID;
  name: string;
  width: number;
  height: number;
  lengths: number[];
  density?: number;
  price?: number;
  available: boolean;
}

export interface SheetMaterial {
  id: UUID;
  name: string;
  width: number;
  length: number;
  thickness: number;
  available: boolean;
}

export type OpeningType = 'window' | 'door';

export interface Opening {
  id: UUID;
  type: OpeningType;
  wallId: UUID;
  x: number;
  width: number;
  height: number;
  sillHeight: number;
}

export interface Wall {
  id: UUID;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
}

export type RoofType = 'shed' | 'gable';

export interface Roof {
  type: RoofType;
  pitchDeg: number;
  overhang: { front: number; back: number; left: number; right: number };
  rafterSpacing: number;
  rafterSection: Section;
}

export interface Building {
  id: UUID;
  length: number;
  width: number;
  wallHeight: number;
  walls: Wall[];
  openings: Opening[];
  roof: Roof;
  floorLevel: number;
  studSpacing: number;
  plateCountTop: 1 | 2;
  cornerType: '2-stud' | '3-stud';
  lumberMaterialId: UUID;
  sheetMaterialId?: UUID;
  wallThickness: number;
  structuralThickness: number;
}

export interface FrameElement {
  id: UUID;
  kind: string;
  role?: string;
  assemblyId?: UUID;
  wallId?: UUID;
  materialId: UUID;
  section: Section;
  length: number;
  lengthMm?: number;
  count: number;
  position: Vec3;
  startMm?: Vec3;
  endMm?: Vec3;
  localAxes?: { x: Vec3; y: Vec3; z: Vec3 };
  jointStart?: string;
  jointEnd?: string;
  cutGeometry?: string;
  stockLengthMm?: number;
  verificationStatus?: 'passed' | 'failed' | 'insufficient' | 'unsupported';
}

export interface Project {
  schemaVersion: number;
  id: UUID;
  name: string;
  units: 'mm' | 'm';
  building: Building;
  materials: { lumber: LumberMaterial[]; sheets: SheetMaterial[] };
}
