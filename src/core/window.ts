
import { createTimberElement } from './timber'
import type { TimberElement } from './timber'
import { generateWallPanel } from './wall'
import type { WallPanelParams } from './wall'

export interface WindowOpeningParams {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_WINDOW: WindowOpeningParams = {
  x: 900,
  y: 900,
  width: 1200,
  height: 1200,
}

const SW = 45
const SH = 145

function xOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 - 1e-9 && b1 < a2 - 1e-9
}

export function applyWindowOpening(elements: TimberElement[], win: WindowOpeningParams = DEFAULT_WINDOW): TimberElement[] {
  const ox = win.x
  const oy = win.y
  const ow = win.width
  const oh = win.height
  const openingRight = ox + ow
  const openingTop = oy + oh

  const bottom = elements.find((e) => e.id === 'plate-bottom-1')
  if (!bottom) throw new Error('No base wall')
  const wallLength = bottom.length
  const top2 = elements.find((e) => e.id === 'plate-top-2')
  const wallHeight = top2 ? top2.position.y + SW / 2 : 2700

  if (ox < 135 || ox > 1665) {
    throw new Error('Window position out of range')
  }
  if (ox < 0 || oy < 0 || openingRight > wallLength || openingTop > wallHeight) {
    throw new Error('Window does not fit in wall')
  }
  if (openingRight + SW * 2 > wallLength) {
    throw new Error('Window framing exceeds wall length')
  }
  if (ox - SW * 2 < 0) {
    throw new Error('Window framing exceeds wall length')
  }

  const openingRange = [ox, openingRight]
  const framingRanges = [
    [ox - 2 * SW, ox - SW],
    [ox - SW, ox],
    [openingRight, openingRight + SW],
    [openingRight + SW, openingRight + 2 * SW],
  ]

  // remove row studs that overlap opening or framing in X
  const removedOpeningStuds: number[] = []
  const result: TimberElement[] = []
  for (const e of elements) {
    if (e.role === 'stud') {
      const minX = e.position.x - SW / 2
      const maxX = e.position.x + SW / 2
      const overlapsOpening = xOverlap(minX, maxX, openingRange[0], openingRange[1])
      const overlapsFraming = framingRanges.some(([a, b]) => xOverlap(minX, maxX, a, b))
      if (overlapsOpening || overlapsFraming) {
        if (overlapsOpening && !overlapsFraming) {
          removedOpeningStuds.push(minX) // start X
        }
        continue
      }
    }
    result.push(e)
  }

  // helper: check X+Y conflict with existing
  function canAdd(minX: number, maxX: number, minY: number, maxY: number): boolean {
    for (const e of result) {
      let eMinX: number, eMaxX: number, eMinY: number, eMaxY: number
      if (e.role === 'bottom-plate' || e.role === 'top-plate' || e.role === 'header' || e.role === 'sill') {
        if (e.orientation.roll === 90) {
          eMinX = e.position.x
          eMaxX = e.position.x + e.length
          eMinY = e.position.y - SW / 2
          eMaxY = e.position.y + SW / 2
        } else {
          eMinX = e.position.x
          eMaxX = e.position.x + e.length
          eMinY = e.position.y
          eMaxY = e.position.y + e.height
        }
      } else {
        eMinX = e.position.x - SW / 2
        eMaxX = e.position.x + SW / 2
        eMinY = e.position.y
        eMaxY = e.position.y + e.length
      }
      if (xOverlap(minX, maxX, eMinX, eMaxX) && (minY < eMaxY - 1e-9 && eMinY < maxY - 1e-9)) {
        return false
      }
    }
    return true
  }

  const kingLen = wallHeight - SW * 3
  result.push(createTimberElement({
    id: 'king-left', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: ox - SW - SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'king-right', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: openingRight + SW + SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  const jackLen = openingTop - SW
  result.push(createTimberElement({
    id: 'jack-left', role: 'jack-stud', length: jackLen, width: SW, height: SH,
    position: { x: ox - SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'jack-right', role: 'jack-stud', length: jackLen, width: SW, height: SH,
    position: { x: openingRight + SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  const headerLen = (openingRight + SW) - (ox - SW)
  result.push(createTimberElement({
    id: 'header-1', role: 'header', length: headerLen, width: SW, height: SH,
    position: { x: ox - SW, y: openingTop, z: -50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'header-2', role: 'header', length: headerLen, width: SW, height: SH,
    position: { x: ox - SW, y: openingTop, z: 50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))

  result.push(createTimberElement({
    id: 'sill', role: 'sill', length: ow, width: SW, height: SH,
    position: { x: ox, y: oy - SW + SW / 2, z: -SH / 2 },
    orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
  }))

  // cripple bottom from removed opening studs
  for (const sx of removedOpeningStuds) {
    const idx = removedOpeningStuds.indexOf(sx) + 1
    const cMinX = sx
    const cMaxX = sx + SW
    const cMinY = SW
    const cMaxY = oy - SW
    if (!canAdd(cMinX, cMaxX, cMinY, cMaxY)) continue
    result.push(createTimberElement({
      id: `cripple-bottom-${idx}`, role: 'cripple-bottom', length: oy - 2 * SW, width: SW, height: SH,
      position: { x: sx + SW / 2, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  // cripple top from removed opening studs
  for (const sx of removedOpeningStuds) {
    const idx = removedOpeningStuds.indexOf(sx) + 1
    const cMinX = sx
    const cMaxX = sx + SW
    const cMinY = openingTop + SH
    const cMaxY = wallHeight - SW * 2
    if (!canAdd(cMinX, cMaxX, cMinY, cMaxY)) continue
    result.push(createTimberElement({
      id: `cripple-top-${idx}`, role: 'cripple-top', length: (wallHeight - SW * 2) - (openingTop + SH), width: SW, height: SH,
      position: { x: sx + SW / 2, y: openingTop + SH, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  // sill-end cripples
  const sillLeftX = ox
  const sillRightX = openingRight - SW
  for (const [sx, suffix] of [[sillLeftX, 'left'], [sillRightX, 'right']] as [number, string][]) {
    const cMinX = sx
    const cMaxX = sx + SW
    const cMinY = SW
    const cMaxY = oy - SW
    if (!canAdd(cMinX, cMaxX, cMinY, cMaxY)) continue
    result.push(createTimberElement({
      id: `cripple-bottom-${suffix}`, role: 'cripple-bottom', length: oy - 2 * SW, width: SW, height: SH,
      position: { x: sx + SW / 2, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  return result
}

export function generateWallWithWindow(params: WallPanelParams, win: WindowOpeningParams = DEFAULT_WINDOW): { id: string; elements: TimberElement[] } {
  const base = generateWallPanel(params)
  const elements = applyWindowOpening(base.elements, win)
  return { id: 'wall-with-window', elements }
}
