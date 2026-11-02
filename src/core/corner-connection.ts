import type { TimberElement, Wall } from './project'

/**
 * Right California corner. Mutates only fresh GENERATED boards, never the
 * original wall, opening or saved author-controlled geometry.
 */
export function connectRightCaliforniaCorner(
  elements: TimberElement[],
  front: Wall,
  right: Wall,
): void {
  const frontTop = elements.find(element =>
    element.wallId === front.wallId && element.elementId === 'plate-top-2')
  if (frontTop) frontTop.lengthMm -= front.sectionMm.height

  const rightTopId = right.wallId + ':plate-top-2'
  const rightTop = elements.find(element =>
    element.wallId === right.wallId && element.elementId === rightTopId)
  if (rightTop) {
    rightTop.position = { ...rightTop.position, x: -right.sectionMm.height }
    rightTop.lengthMm += right.sectionMm.height
  }

  const backing: TimberElement = {
    elementId: 'warm-corner-stud',
    wallId: front.wallId,
    role: 'corner-backing',
    lengthMm: front.heightMm - front.sectionMm.width * 3,
    sectionMm: { ...front.sectionMm },
    position: {
      x: front.lengthMm - front.sectionMm.width - front.sectionMm.height,
      y: front.sectionMm.width,
      z: -front.sectionMm.height / 2 + front.sectionMm.width / 2,
    },
    orientation: { mode: 'y', angle: 0, roll: 90 },
    connectionIds: [],
    generated: true,
  }
  // Preserve existing stable order: front, corner backing, right wall.
  const rightIndex = elements.findIndex(element => element.wallId === right.wallId)
  elements.splice(rightIndex < 0 ? elements.length : rightIndex, 0, backing)

  const frontEnd = elements
    .filter(element => element.wallId === front.wallId && element.role === 'stud')
    .sort((a, b) => b.position.x - a.position.x)[0]
  const rightStart = elements
    .filter(element => element.wallId === right.wallId && element.role === 'stud')
    .sort((a, b) => a.position.x - b.position.x)[0]
  if (frontEnd && rightStart) {
    frontEnd.connectionIds = [rightStart.elementId, backing.elementId]
    rightStart.connectionIds = [frontEnd.elementId, backing.elementId]
    backing.connectionIds = [frontEnd.elementId, rightStart.elementId]
  }
  if (frontTop && rightTop) {
    frontTop.connectionIds = [rightTop.elementId]
    rightTop.connectionIds = [frontTop.elementId]
  }
}
