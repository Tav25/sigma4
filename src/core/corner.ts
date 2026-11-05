import type { Wall } from './project'

/** The right wall extends towards -Z (the inside of the building).
 * Its outer face is flush with the right end of the front wall, and its
 * near end butts against the inside face of the front wall.
 */
export function rightCornerOrigin(front: Wall, side: Pick<Wall, 'sectionMm'>) {
  return {
    // Both wall origins reference OUTSIDE faces, not stud midplanes.
    x: front.origin.x + front.lengthMm,
    y: front.origin.y,
    z: front.origin.z - front.sectionMm.height,
  }
}

// Preserve clearance for the paired 45x145 corner studs and the
// interior wall-to-wall connection. Drywall clips are not wood framing.
export function canFitCornerFraming(front: Wall, openingEndsWithFrame: number): boolean {
  return openingEndsWithFrame <= front.lengthMm - front.sectionMm.height
}
