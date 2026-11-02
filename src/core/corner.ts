import type { Wall } from './project'

/** The right wall extends towards -Z (the inside of the building).
 * Its outer face is flush with the right end of the front wall, and its
 * near end butts against the inside face of the front wall.
 */
export function rightCornerOrigin(front: Wall, side: Pick<Wall, 'sectionMm'>) {
  return {
    x: front.origin.x + front.lengthMm - side.sectionMm.height / 2,
    y: front.origin.y,
    z: front.origin.z - front.sectionMm.height / 2,
  }
}

// Thin fixing cleat, not a solid third corner post. The remaining cavity
// between cleat and outer corner stud is left open for insulation.
export const CORNER_CLEAT_MM = 20

export function canFitCornerBacking(front: Wall, openingEndsWithFrame: number): boolean {
  return openingEndsWithFrame <= front.lengthMm - front.sectionMm.height
}
