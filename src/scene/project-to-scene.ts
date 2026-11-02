import type { ProjectDocument } from '../core/project'
import type { TimberElement as SceneTimberElement } from '../core/timber'
import type { WindowOpening } from '../core/window'

export interface OpeningMarker {
  openingId: string
  position: { x: number; y: number; z: number } // millimetres
  visible: boolean
  color: string
}

export interface SceneProjection {
  elements: SceneTimberElement[]
  openings: WindowOpening[]
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
      role: element.role,
      length: element.lengthMm,
      width: element.sectionMm.width,
      height: element.sectionMm.height,
      position: { ...element.position },
      orientation: { ...element.orientation },
      material: 'wood',
    })),
    openings: document.building.openings.map(opening => ({
      id: opening.id,
      positionXmm: opening.positionUmm,
      widthMm: opening.widthMm,
      heightMm: opening.heightMm,
      sillHeightMm: opening.sillHeightMm,
      type: opening.type,
    })),
    // Markers are always derived from their opening and wall: no separate XYZ source.
    // Only the current single wall along X is supported here. Other wall axes
    // are reserved for the multiple-wall stage.
    markers: document.building.markers.flatMap(marker => {
      const opening = openings.get(marker.openingId)
      const wall = opening ? walls.get(opening.wallId) : undefined
      if (!opening || !wall || wall.orientation !== 'x') return []
      const horizontal = marker.anchor === 'left' ? 0 : marker.anchor === 'right' ? opening.widthMm : opening.widthMm / 2
      return [{
        openingId: marker.openingId,
        position: {
          x: wall.origin.x + opening.positionUmm + horizontal,
          y: wall.origin.y + marker.elevationMm,
          z: wall.origin.z + wall.sectionMm.height / 2 + marker.outsideOffsetMm,
        },
        visible: marker.visible,
        color: marker.color,
      }]
    }),
  }
}
