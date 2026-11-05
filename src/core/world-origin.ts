import type { ProjectDocument, Vector3, Wall } from './project'

/**
 * SIGMA4 schema 1.1.0: wall.origin is the actual lower OUTSIDE corner,
 * not the middle of a 145-mm stud. All coordinates remain millimetres.
 * +X facade extends inward to -Z; -Z wall extends inward to -X.
 */
export const CURRENT_COORDINATE_SCHEMA = '1.1.0'

export function wallMidplaneOrigin(wall: Pick<Wall, 'origin' | 'orientation' | 'sectionMm'>): Vector3 {
  const half = wall.sectionMm.height / 2
  return wall.orientation === 'z'
    ? { ...wall.origin, x: wall.origin.x - half }
    : wall.orientation === 'x'
      ? { ...wall.origin, z: wall.origin.z - half }
      : { ...wall.origin }
}

/** World-space physical outside lower-left corner of the first +X wall. */
export function firstWallExteriorLowerLeft(wall: Wall): Vector3 {
  if (wall.orientation !== 'x') {
    throw new Error('Exterior corner requires the first wall along +X')
  }
  return { ...wall.origin }
}

/**
 * Legacy 1.0.0 authored origins referred to stud *middle planes*.
 * Translate source origins (not geometry) to new outside-face coordinates
 * so the entire physical world assembly remains EXACTLY where it was.
 * Geometry, local openings and connections are regenerated downstream.
 */
export function migrateLegacyWallOrigins(doc: ProjectDocument): ProjectDocument {
  if (doc.project.schemaVersion !== '1.0.0') return doc
  return {
    ...doc,
    project: { ...doc.project, schemaVersion: CURRENT_COORDINATE_SCHEMA },
    building: {
      ...doc.building,
      walls: doc.building.walls.map(wall => {
        const half = wall.sectionMm.height / 2
        return {
          ...wall,
          origin: wall.orientation === 'z'
            ? { ...wall.origin, x: wall.origin.x + half }
            : wall.orientation === 'x'
              ? { ...wall.origin, z: wall.origin.z + half }
              : { ...wall.origin },
        }
      }),
    },
  }
}

/** Move all wall origins rigidly to place first physical corner at world zero. */
export function translateWallsToExteriorZero(walls: Wall[]): string[] {
  if (!walls.length) throw new Error('No walls to align')
  const corner = firstWallExteriorLowerLeft(walls[0])
  if (![corner.x, corner.y, corner.z].every(Number.isFinite)) {
    throw new Error('Invalid wall origin')
  }
  for (const wall of walls) {
    wall.origin = {
      x: wall.origin.x - corner.x,
      y: wall.origin.y - corner.y,
      z: wall.origin.z - corner.z,
    }
  }
  return walls.map(wall => wall.wallId)
}
