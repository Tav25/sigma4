import { generateWallPanel, type WallPanelParams } from './wall'
import { generateWallWithOpenings, type WindowOpening } from './window'
import type { Wall, Opening, TimberElement } from './project'

/**
 * Generates ONE wall from canonical source parameters and its own openings.
 * Positions are wall-local. All joinery and the world transform are external.
 */
export function generateWallModule(
  wall: Wall,
  openings: readonly Opening[],
  options: { unprefixedIds?: boolean } = {},
): TimberElement[] {
  const params: WallPanelParams = {
    length: wall.lengthMm,
    height: wall.heightMm,
    sectionWidth: wall.sectionMm.width,
    sectionHeight: wall.sectionMm.height,
    spacing: wall.studSpacingMm,
    topLayers: 2,
  }
  const wallOpenings: WindowOpening[] = openings
    .filter(opening => opening.wallId === wall.wallId)
    .map(opening => ({
      id: opening.id,
      positionXmm: opening.positionUmm,
      widthMm: opening.widthMm,
      heightMm: opening.heightMm,
      sillHeightMm: opening.sillHeightMm,
      type: opening.type,
    }))
    .sort((a, b) => a.positionXmm - b.positionXmm)

  const panel = wallOpenings.length
    ? generateWallWithOpenings(params, wallOpenings)
    : generateWallPanel(params)

  return panel.elements.map((element: any): TimberElement => ({
    elementId: options.unprefixedIds ? element.id : wall.wallId + ':' + element.id,
    wallId: wall.wallId,
    role: element.role,
    sectionMm: { width: element.width, height: element.height },
    lengthMm: element.length,
    position: { ...element.position },
    orientation: { ...element.orientation },
    connectionIds: [],
    generated: true,
  }))
}
