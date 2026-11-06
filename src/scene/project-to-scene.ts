import type { ProjectDocument } from '../core/project'
import type { TimberElement as SceneTimberElement } from '../core/timber'
import type { WindowOpening } from '../core/window'
import { wallLocalToWorld, wallMidplaneOrigin } from '../core/world-origin'

export interface SceneOpening3D extends WindowOpening {
  wallId: string
  wallLengthMm: number
  wallOrigin: { x: number; y: number; z: number }
  wallOrientation: 'x' | 'z'
  reversed?: true
}

export interface OpeningMarker {
  openingId: string
  position: { x: number; y: number; z: number } // millimetres
  visible: boolean
  color: string
}

export interface SceneProjection {
  elements: SceneTimberElement[]
  openings: WindowOpening[]
  sceneOpenings: SceneOpening3D[]
  markers: OpeningMarker[]
}

/** A read-only-by-convention, detached 3D projection of canonical project data.
 * Dimensions and positions remain millimetres until SceneView renders them.
 */
export function projectToScene(document: ProjectDocument): SceneProjection {
  const walls = new Map(document.building.walls.map(wall => [wall.wallId, wall]))
  const openings = new Map(document.building.openings.map(opening => [opening.id, opening]))
  return {
    elements: document.assembly.elements.map(element => ({
      id: element.elementId,
      wallId: element.wallId,
      role: element.role,
      length: element.lengthMm,
      width: element.sectionMm.width,
      height: element.sectionMm.height,
      position: { ...element.position },
      orientation: { ...element.orientation },
      material: 'wood',
      wallTransform: (() => {
        const wall = walls.get(element.wallId)
        return wall ? { origin: wallMidplaneOrigin(wall), orientation: wall.orientation === 'z' ? 'z' as const : 'x' as const, ...(wall.reversed ? { reversed: wall.reversed } : {}) } : undefined
      })(),
    })),
    openings: document.building.openings.map(opening => ({
      id: opening.id,
      positionXmm: opening.positionUmm,
      widthMm: opening.widthMm,
      heightMm: opening.heightMm,
      sillHeightMm: opening.sillHeightMm,
      type: opening.type,
      ...(opening.garage ? { garage: { ...opening.garage } } : {}),
    })),
    // The independent 3D projection carries wall identity and transform.
    // The editor's existing 'openings' collection stays backward compatible.
    sceneOpenings: document.building.openings.flatMap(opening => {
      const wall = walls.get(opening.wallId)
      if (!wall) return []
      return [{
        id: opening.id,
        wallId: wall.wallId,
        wallLengthMm: wall.lengthMm,
        // Only this derived 3D hit plane needs the wall midplane;
        // the source building.walls[*].origin stays the exterior corner.
        wallOrigin: wallMidplaneOrigin(wall),
        wallOrientation: wall.orientation === 'z' ? 'z' as const : 'x' as const,
        ...(wall.reversed ? { reversed: wall.reversed } : {}),
        positionXmm: opening.positionUmm,
        widthMm: opening.widthMm,
        heightMm: opening.heightMm,
        sillHeightMm: opening.sillHeightMm,
        type: opening.type,
        ...(opening.garage ? { garage: { ...opening.garage } } : {}),
      }]
    }),
    // Markers depend exclusively on their opening and wall's local frame.
    markers: document.building.markers.flatMap(marker => {
      const opening = openings.get(marker.openingId)
      const wall = opening ? walls.get(opening.wallId) : undefined
      if (!opening || !wall) return []
      const horizontal = marker.anchor === 'left' ? 0 : marker.anchor === 'right' ? opening.widthMm : opening.widthMm / 2
      return [{
        openingId: marker.openingId,
        position: wallLocalToWorld(wall.origin, wall.orientation, wall.reversed,
          opening.positionUmm + horizontal, marker.elevationMm, marker.outsideOffsetMm),
        visible: marker.visible,
        color: marker.color,
      }]
    }),
  }
}
