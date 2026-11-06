import { generateWallPanel, type WallPanelParams } from './wall'
import { generateWallWithOpenings, type WindowOpening } from './window'
import { generatePartitionWithDoors } from './partition-door'
import { applyLinkedHeaderProfile } from './opening-profiles'
import type { Wall, Opening, TimberElement } from './project'

/**
 * Generates ONE wall from canonical source parameters and its own openings.
 * Positions are wall-local. All joinery and the world transform are external.
 */
export function generateWallModule(
  wall: Wall,
  openings: readonly Opening[],
  options: { unprefixedIds?: boolean; partition?: boolean; requiredFirst?: boolean } = {},
): TimberElement[] {
  const partition = options.partition
  const params: WallPanelParams = {
    length: wall.lengthMm,
    height: wall.heightMm,
    sectionWidth: wall.sectionMm.width,
    sectionHeight: wall.sectionMm.height,
    spacing: wall.studSpacingMm,
    // Double cap on linked partitions allows the upper course to lap across
    // T/L/X intersections exactly like Haun's wall-framing sequence.
    topLayers: 2,
    requiredFirst: options.requiredFirst,
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
      ...(opening.garage ? { garage: { ...opening.garage } } : {}),
      ...(opening.headerPreview ? { headerPreview: { ...opening.headerPreview } } : {}),
      ...(opening.designLoads ? { designLoads: { ...opening.designLoads } } : {}),
    }))
    .sort((a, b) => a.positionXmm - b.positionXmm)

  const panel = wallOpenings.length
    ? (partition ? generatePartitionWithDoors(params, wallOpenings) : generateWallWithOpenings(params, wallOpenings))
    : generateWallPanel(params)

  // Stage 3: preserve the long-established standalone 3D layout, but give
  // plan-linked exterior openings configurable header / support packages.
  if (options.requiredFirst && !partition && wallOpenings.length)
    applyLinkedHeaderProfile(wallOpenings, panel.elements, wall)

  const generated = panel.elements.map((element: any): TimberElement => ({
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
  // Reciprocal logical joints between each preview header and the jack studs
  // actually carrying it; visual links alone are not used for capacity claims.
  if (options.requiredFirst) for (const opening of wallOpenings) {
    for (const header of generated.filter(e =>
      e.elementId === wall.wallId + ':' + opening.id + '-header-1' ||
      e.elementId === wall.wallId + ':' + opening.id + '-header-2')) {
      for (const jack of generated.filter(e=>e.role==='jack-stud' &&
        e.elementId.startsWith(wall.wallId + ':' + opening.id + '-jack-'))) {
        if (!header.connectionIds.includes(jack.elementId)) header.connectionIds.push(jack.elementId)
        if (!jack.connectionIds.includes(header.elementId)) jack.connectionIds.push(header.elementId)
      }
    }
  }
  return generated
}
