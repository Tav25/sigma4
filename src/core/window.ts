
import { createTimberElement } from './timber'
import type { GarageDoorSpec } from './project'
import type { TimberElement } from './timber'
import { generateWallPanel } from './wall'
import type { WallPanelParams } from './wall'

export interface WindowOpening {
  id: string
  positionXmm: number
  widthMm: number
  heightMm: number
  sillHeightMm: number
  type: 'window' | 'door' | 'garage-door'
  garage?: GarageDoorSpec
}

export type Opening = WindowOpening

export const DEFAULT_WINDOW: WindowOpening = {
  id: 'W',
  positionXmm: 900,
  widthMm: 1200,
  heightMm: 1200,
  sillHeightMm: 900,
  type: 'window',
}

export const DEFAULT_DOOR: WindowOpening = {
  id: 'D',
  positionXmm: 3000,
  widthMm: 900,
  heightMm: 2100,
  sillHeightMm: 0,
  type: 'door',
}

const SW = 45
const SH = 145

function xOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 - 1e-9 && b1 < a2 - 1e-9
}

export interface WindowBounds {
  minX: number
  maxX: number
}

export function getWindowPositionBounds(
  wallLength: number,
  selectedWindow: { positionXmm: number; widthMm: number },
  otherOpenings: { positionXmm: number; widthMm: number }[],
): WindowBounds {
  const w = selectedWindow.widthMm
  let minX = 135
  let maxX = wallLength - w - 135
  for (const o of otherOpenings) {
    const otherFrameMax = o.positionXmm + o.widthMm + 90
    const otherFrameMin = o.positionXmm - 90
    if (o.positionXmm < selectedWindow.positionXmm) {
      minX = Math.max(minX, otherFrameMax + 90)
    } else {
      maxX = Math.min(maxX, otherFrameMin - w - 90)
    }
  }
  if (minX > maxX) {
    minX = maxX
  }
  return { minX, maxX }
}

function canAdd(elements: TimberElement[], minX: number, maxX: number, minY: number, maxY: number): boolean {
  for (const e of elements) {
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

export function applyWindowOpening(elements: TimberElement[], win: WindowOpening = DEFAULT_WINDOW, idPrefix: string = ''): TimberElement[] {
  const ox = win.positionXmm
  const oy = win.sillHeightMm
  const ow = win.widthMm
  const oh = win.heightMm
  const openingRight = ox + ow
  const openingTop = oy + oh

  const bottom = elements.find((e) => e.role === 'bottom-plate')
  if (!bottom) throw new Error('No base wall')
  const wallLength = bottom.length
  const top2 = elements.find((e) => e.role === 'top-plate' && e.id.includes('2')) || elements.find((e) => e.role === 'top-plate')
  const wallHeight = top2 ? top2.position.y + SW / 2 : 2700

  if (ox < 135) throw new Error('Window position out of range')
  if (ox + ow > wallLength - 135) throw new Error('Window position out of range')
  if (oy < 300) throw new Error('Sill height too small')
  if (ow < 300) throw new Error('Window width too small')
  if (oh < 300) throw new Error('Window height too small')
  if (openingTop + SH > wallHeight - SW * 2) throw new Error('Window too tall for wall height')

  const openingRange = [ox, openingRight]
  const framingRanges = [
    [ox - 2 * SW, ox - SW],
    [ox - SW, ox],
    [openingRight, openingRight + SW],
    [openingRight + SW, openingRight + 2 * SW],
  ]

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
          removedOpeningStuds.push(minX)
        }
        continue
      }
    }
    result.push(e)
  }

  const kingLen = wallHeight - SW * 3
  result.push(createTimberElement({
    id: idPrefix + 'king-left', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: ox - SW - SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: idPrefix + 'king-right', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: openingRight + SW + SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  const jackLen = openingTop - SW
  result.push(createTimberElement({
    id: idPrefix + 'jack-left', role: 'jack-stud', length: jackLen, width: SW, height: SH,
    position: { x: ox - SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: idPrefix + 'jack-right', role: 'jack-stud', length: jackLen, width: SW, height: SH,
    position: { x: openingRight + SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  const headerLen = (openingRight + SW) - (ox - SW)
  result.push(createTimberElement({
    id: idPrefix + 'header-1', role: 'header', length: headerLen, width: SW, height: SH,
    position: { x: ox - SW, y: openingTop, z: -50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: idPrefix + 'header-2', role: 'header', length: headerLen, width: SW, height: SH,
    position: { x: ox - SW, y: openingTop, z: 50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))

  result.push(createTimberElement({
    id: idPrefix + 'sill', role: 'sill', length: ow, width: SW, height: SH,
    position: { x: ox, y: oy - SW + SW / 2, z: -SH / 2 },
    orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
  }))

  for (const sx of removedOpeningStuds) {
    const idx = removedOpeningStuds.indexOf(sx) + 1
    const cMinX = sx; const cMaxX = sx + SW
    const cMinY = SW; const cMaxY = oy - SW
    if (!canAdd(result, cMinX, cMaxX, cMinY, cMaxY)) continue
    result.push(createTimberElement({
      id: idPrefix + `cripple-bottom-${idx}`, role: 'cripple-bottom', length: oy - 2 * SW, width: SW, height: SH,
      position: { x: sx + SW / 2, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  const crippleTopLen = (wallHeight - SW * 2) - (openingTop + SH)
  if (crippleTopLen > 0) {
    for (const sx of removedOpeningStuds) {
      const idx = removedOpeningStuds.indexOf(sx) + 1
      const cMinX = sx; const cMaxX = sx + SW
      const cMinY = openingTop + SH; const cMaxY = wallHeight - SW * 2
      if (!canAdd(result, cMinX, cMaxX, cMinY, cMaxY)) continue
      result.push(createTimberElement({
        id: idPrefix + `cripple-top-${idx}`, role: 'cripple-top', length: crippleTopLen, width: SW, height: SH,
        position: { x: sx + SW / 2, y: openingTop + SH, z: -SH / 2 },
        orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
      }))
    }
  }


  // sill-end cripples (0.0.7.1)
  const sillLeftX = ox
  const sillRightX = openingRight - SW
  for (const [sx, suffix] of [[sillLeftX, 'left'], [sillRightX, 'right']] as [number, string][]) {
    const cMinX = sx; const cMaxX = sx + SW
    const cMinY = SW; const cMaxY = oy - SW
    if (!canAdd(result, cMinX, cMaxX, cMinY, cMaxY)) continue
    result.push(createTimberElement({
      id: idPrefix + `cripple-bottom-${suffix}`, role: 'cripple-bottom', length: oy - 2 * SW, width: SW, height: SH,
      position: { x: sx + SW / 2, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  return result
}

export function applyDoorOpening(elements: TimberElement[], door: WindowOpening): TimberElement[] {
  const ox = door.positionXmm
  const oy = door.sillHeightMm  // 0
  const ow = door.widthMm
  const oh = door.heightMm
  const openingRight = ox + ow
  const openingTop = oy + oh
  const garage = door.type === 'garage-door' ? door.garage : undefined
  if (door.type === 'garage-door' && !garage) throw new Error('Garage specification required')
  const studsPerSide = garage ? garage.jackStudsPerSide : 1
  const headerDepth = garage ? garage.lintelPreviewDepthMm : SH

  const bottom = elements.find((e) => e.role === 'bottom-plate')
  if (!bottom) throw new Error('No base wall')
  const wallLength = bottom.length
  const top2 = elements.find((e) => e.role === 'top-plate' && e.id.includes('2')) || elements.find((e) => e.role === 'top-plate')
  const wallHeight = top2 ? top2.position.y + SW / 2 : 2700

  if (ox < 135) throw new Error('Door position out of range')
  if (ox + ow > wallLength - 135) throw new Error('Door position out of range')
  if (ow < 300) throw new Error('Door width too small')
  if (oh < 300) throw new Error('Door height too small')
  if (openingTop + headerDepth > wallHeight - SW * 2) throw new Error('Door/lintel too tall for wall height')
  if (garage && (!Number.isInteger(studsPerSide) || studsPerSide < 1 || studsPerSide > 4)) throw new Error('Invalid garage jack stud count')

  const openingRange = [ox, openingRight]
  const framingRanges: number[][] = []
  for (let i = 0; i <= studsPerSide; i++) {
    framingRanges.push([ox - (i + 1) * SW, ox - i * SW])
    framingRanges.push([openingRight + i * SW, openingRight + (i + 1) * SW])
  }
  if (ox < (studsPerSide + 1) * SW || openingRight > wallLength - (studsPerSide + 1) * SW) {
    throw new Error('Garage support studs outside wall')
  }

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
          removedOpeningStuds.push(minX)
        }
        continue
      }
    }
    // bottom plates will be rebuilt later; keep them for now
    result.push(e)
  }

  // king studs (full height)
  const kingLen = wallHeight - SW * 3
  result.push(createTimberElement({
    id: door.id + '-king-left', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: ox - studsPerSide * SW - SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: door.id + '-king-right', role: 'king-stud', length: kingLen, width: SW, height: SH,
    position: { x: openingRight + studsPerSide * SW + SW / 2, y: SW, z: -SH / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  // Side supports: a provisional layout, not a calculated capacity.
  const jackLen = openingTop - SW
  for (let i = 0; i < studsPerSide; i++) {
    result.push(createTimberElement({
      id: door.id + (i === 0 ? '-jack-left' : '-jack-left-' + (i + 1)),
      role: 'jack-stud', length: jackLen, width: SW, height: SH,
      position: { x: ox - SW / 2 - i * SW, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
    result.push(createTimberElement({
      id: door.id + (i === 0 ? '-jack-right' : '-jack-right-' + (i + 1)),
      role: 'jack-stud', length: jackLen, width: SW, height: SH,
      position: { x: openingRight + SW / 2 + i * SW, y: SW, z: -SH / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  // header: two boards, length 990, Y 2100-2245, Z split
  const headerLen = ow + 2 * SW * studsPerSide
  const headerRole = garage ? 'garage-lintel-preview' : 'header'
  result.push(createTimberElement({
    id: door.id + '-header-1', role: headerRole, length: headerLen, width: SW, height: headerDepth,
    position: { x: ox - studsPerSide * SW, y: openingTop, z: -50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: door.id + '-header-2', role: headerRole, length: headerLen, width: SW, height: headerDepth,
    position: { x: ox - studsPerSide * SW, y: openingTop, z: 50 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))

  // cripple-top (two studs at 3300 and 3600 for control model; for general, use removed opening studs)
    const crippleTopLen = (wallHeight - SW * 2) - (openingTop + headerDepth)
  if (crippleTopLen > 0) {
    for (const sx of removedOpeningStuds) {
      const idx = removedOpeningStuds.indexOf(sx) + 1
      const cMinX = sx; const cMaxX = sx + SW
      const cMinY = openingTop + headerDepth; const cMaxY = wallHeight - SW * 2
      if (!canAdd(result, cMinX, cMaxX, cMinY, cMaxY)) continue
      result.push(createTimberElement({
        id: door.id + `-cripple-top-${idx}`, role: 'cripple-top', length: crippleTopLen, width: SW, height: SH,
        position: { x: sx + SW / 2, y: openingTop + headerDepth, z: -SH / 2 },
        orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
      }))
    }
  }


  return result
}

export function generateWallWithOpenings(params: WallPanelParams, openings: WindowOpening[]): { id: string; elements: TimberElement[] } {
  // pairwise framing overlap check
  const sorted = [...openings].sort((a, b) => a.positionXmm - b.positionXmm)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      const aFrameMax = a.positionXmm + a.widthMm + 90
      const bFrameMin = b.positionXmm - 90
      if (aFrameMax > bFrameMin) {
        throw new Error('Not enough space between openings for side studs')
      }
    }
  }

  const base = generateWallPanel(params)
  let elements = base.elements
  for (const o of sorted) {
    if (o.type === 'door' || o.type === 'garage-door') {
      elements = applyDoorOpening(elements.map((e) => ({ ...e })), o)
    } else {
      elements = applyWindowOpening(elements.map((e) => ({ ...e })), o, o.id + '-')
    }
  }

  // if any door, rebuild bottom plates (split around doors)
  const doors = openings.filter((o) => o.type === 'door' || o.type === 'garage-door')
  if (doors.length > 0) {
    // remove existing bottom-plate elements
    elements = elements.filter((e) => e.role !== 'bottom-plate')
    // create segments
    const doorRanges = doors.map((d) => [d.positionXmm, d.positionXmm + d.widthMm] as [number, number]).sort((a, b) => a[0] - b[0])
    let prevEnd = 0
    for (let di = 0; di < doorRanges.length; di++) {
      const [ds, de] = doorRanges[di]
      if (ds > prevEnd) {
        const len = ds - prevEnd
        // determine id
        let segId = `plate-bottom-mid-${di}`
        if (doorRanges.length === 1) {
          segId = 'plate-bottom-left'
        }
        if (di === 0) segId = 'plate-bottom-left'
        if (di === doorRanges.length - 1 && prevEnd > 0) segId = 'plate-bottom-right'
        // for single door, right segment is plate-bottom-right (already set above for last)
        elements.push(createTimberElement({
          id: segId, role: 'bottom-plate', length: len, width: SW, height: SH,
          position: { x: prevEnd, y: SW / 2, z: -SH / 2 },
          orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
        }))
      }
      prevEnd = de
    }
    if (prevEnd < params.length) {
      const len = params.length - prevEnd
      elements.push(createTimberElement({
        id: 'plate-bottom-right', role: 'bottom-plate', length: len, width: SW, height: SH,
        position: { x: prevEnd, y: SW / 2, z: -SH / 2 },
        orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
      }))
    }
  }

  return { id: 'wall-with-openings', elements }
}


export function generateWallWithWindow(params: WallPanelParams, win?: { x: number; y: number; width: number; height: number }): { id: string; elements: TimberElement[] } {
  const w = win ?? { x: 900, y: 900, width: 1200, height: 1200 }
  const base = generateWallPanel(params)
  const elements = applyWindowOpening(base.elements, {
    id: 'W',
    positionXmm: w.x,
    widthMm: w.width,
    heightMm: w.height,
    sillHeightMm: w.y,
    type: 'window',
  })
  return { id: 'wall-with-window', elements }
}
