import type { ProjectDocument } from '../core/project'
import type { TimberElement as SceneTimberElement } from '../core/timber'
import type { WindowOpening } from '../core/window'

export interface SceneProjection {
  elements: SceneTimberElement[]
  openings: WindowOpening[]
}

/** A read-only-by-convention, detached 3D projection of canonical project data.
 * Dimensions and positions remain millimetres until SceneView renders them.
 */
export function projectToScene(document: ProjectDocument): SceneProjection {
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
  }
}
