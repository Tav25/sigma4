import type { WindowOpening } from './window'
import { generateWallPanel, type WallPanelParams } from './wall'
import type { TimberElement } from './timber'

/** Nonbearing, non-fire-rated doorway with a flat, full-depth head member. */
export function generatePartitionWithDoors(params: WallPanelParams, doors: WindowOpening[]) {
  const { sectionWidth: width, sectionHeight: depth, height, length } = params
  const panel = generateWallPanel(params)
  const bottom = panel.elements[0]
  const caps = panel.elements.filter(element => element.role === 'top-plate')
  let cursor = 0
  const members: TimberElement[] = []
  const plate = (id: string, start: number, end: number) => ({
    ...bottom, id, length: end - start, position: { ...bottom.position, x: start },
  })
  for (const door of doors) {
    const start = door.positionXmm, end = start + door.widthMm
    members.push(plate(door.id + '-bottom-before', cursor, start))
    cursor = end
    const flatHead = plate(door.id + '-header', start, end)
    members.push({ ...flatHead, role: 'header', position: { ...flatHead.position, y: door.heightMm + width / 2 } })
    for (const [suffix, x] of [['left', start - width / 2], ['right', end + width / 2]] as const) {
      members.push({
        ...bottom, id: door.id + '-king-' + suffix, role: 'king-stud',
        length: height - width * (1 + params.topLayers), position: { x, y: width, z: -depth / 2 },
        orientation: { mode: 'y', angle: 0, roll: 0 },
      })
    }
  }
  members.push(plate('plate-bottom-last', cursor, length))
  const studs = panel.elements.filter(element => element.role === 'stud').flatMap(stud => {
    const min = stud.position.x - width / 2, max = min + width
    const door = doors.find(item => max > item.positionXmm - width && min < item.positionXmm + item.widthMm + width)
    if (!door) return [stud]
    if (min < door.positionXmm || max > door.positionXmm + door.widthMm) return []
    const y = door.heightMm + width
    const cripple = height - params.topLayers * width - y
    return cripple > 0 ? [{
      ...stud, role: 'cripple-top' as const, length: cripple, position: { ...stud.position, y },
    }] : []
  })
  return { ...panel, elements: [...caps, ...studs, ...members] }
}
