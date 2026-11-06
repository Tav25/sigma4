import type { TimberElement, Wall } from './project'
import type { PerimeterCorner } from './plan-frame'

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

  const backing = cornerBacking(front, 'warm-corner-stud',
    front.lengthMm - front.sectionMm.width - front.sectionMm.height)
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
    frontTop.connectionIds.push(rightTop.elementId)
    rightTop.connectionIds.push(frontTop.elementId)
  }
}

function cornerBacking(wall: Wall, elementId: string, x: number): TimberElement {
  return {
    elementId,
    wallId: wall.wallId,
    role: 'corner-backing',
    lengthMm: wall.heightMm - wall.sectionMm.width * 3,
    sectionMm: { ...wall.sectionMm },
    position: {
      x,
      y: wall.sectionMm.width,
      z: -wall.sectionMm.height / 2 + wall.sectionMm.width / 2,
    },
    orientation: { mode: 'y', angle: 0, roll: 90 },
    connectionIds: [],
    generated: true,
  }
}

export function connectPerimeterCorner(elements: TimberElement[], corner: PerimeterCorner): void {
  const { through, inset, throughStart } = corner
  const { width, height: depth } = through.sectionMm
  const plate = (wall: Wall) => elements.find(element =>
    element.elementId === wall.wallId + ':plate-top-2')
  const throughPlate = plate(through)
  const insetPlate = plate(inset)
  if (throughPlate && insetPlate) {
    // The second layer belongs to the opposite pair at every corner.
    throughPlate.lengthMm -= depth
    insetPlate.lengthMm += depth
    if (throughStart) throughPlate.position.x += depth
    else insetPlate.position.x -= depth
    throughPlate.connectionIds.push(insetPlate.elementId)
    insetPlate.connectionIds.push(throughPlate.elementId)
  }

  const backing = cornerBacking(through,
    through.wallId + ':warm-corner-stud' + (throughStart ? '-start' : ''),
    throughStart ? width : through.lengthMm - width - depth)
  elements.push(backing)

  const endpointStud = (wall: Wall, atStart: boolean) => elements.find(element =>
    element.wallId === wall.wallId && element.role === 'stud' &&
    element.position.x === (atStart ? width / 2 : wall.lengthMm - width / 2))
  const throughStud = endpointStud(through, throughStart)
  const insetStud = endpointStud(inset, !throughStart)
  if (throughStud && insetStud) {
    throughStud.connectionIds.push(insetStud.elementId, backing.elementId)
    insetStud.connectionIds.push(throughStud.elementId, backing.elementId)
    backing.connectionIds.push(throughStud.elementId, insetStud.elementId)
  }
}
