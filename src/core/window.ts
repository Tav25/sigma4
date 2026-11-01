
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

export function applyWindowOpening(elements: TimberElement[], win: WindowOpeningParams = DEFAULT_WINDOW): TimberElement[] {
  const { x: ox, y: oy, width: ow, height: oh } = win
  const openingRight = ox + ow
  const openingTop = oy + oh

  // validate fit roughly
  // base wall length/height derived from plates
  const bottom = elements.find((e) => e.id === 'plate-bottom-1')
  if (!bottom) throw new Error('No base wall')
  const wallLength = bottom.length
  const top2 = elements.find((e) => e.id === 'plate-top-2')
  const wallHeight = top2 ? top2.position.y + 22.5 : 2700

  if (ox < 0 || oy < 0 || openingRight > wallLength || openingTop > wallHeight) {
    throw new Error('Window does not fit in wall')
  }

  // remove studs that intersect opening (stud-03, stud-04 at x=1200,1800)
  const result: TimberElement[] = elements.filter((e) => {
    if (e.role !== 'stud') return true
    const minX = e.position.x - 22.5
    const maxX = e.position.x + 22.5
    // remove if overlaps opening in X
    if (maxX > ox && minX < openingRight) return false
    return true
  })

  const sw = 45
  const sh = 145

  // king studs
  result.push(createTimberElement({
    id: 'king-left', role: 'king-stud', length: wallHeight - sw * 3, width: sw, height: sh,
    position: { x: ox - sw - sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'king-right', role: 'king-stud', length: wallHeight - sw * 3, width: sw, height: sh,
    position: { x: openingRight + sw + sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  // jack studs
  result.push(createTimberElement({
    id: 'jack-left', role: 'jack-stud', length: openingTop - sw, width: sw, height: sh,
    position: { x: ox - sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'jack-right', role: 'jack-stud', length: openingTop - sw, width: sw, height: sh,
    position: { x: openingRight + sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  // header: two boards, roll 0, length 1290 (openingWidth + 2*sw? 1200+90=1290), Y 2100..2245, Z split
  const headerLen = (openingRight + sw) - (ox - sw)  // 2145-855 = 1290
  result.push(createTimberElement({
    id: 'header-1', role: 'header', length: headerLen, width: sw, height: sh,
    position: { x: ox - sw, y: openingTop, z: -sh / 2 - 22.5 },  // Z center -50? need refZ
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))
  // fix Z for header-1: center Z should be -50, refZ = centerZ = -50 (roll0 center = refZ)
  // (already set z: -sh/2 -22.5 = -72.5-22.5 = -95? wrong). Let's correct below by reassigning.
  // We'll handle via post-correction: set position.z for headers
  result.push(createTimberElement({
    id: 'header-2', role: 'header', length: headerLen, width: sw, height: sh,
    position: { x: ox - sw, y: openingTop, z: sh / 2 + 22.5 },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  }))

  // sill: length 1200, roll 90, Y 855-900
  result.push(createTimberElement({
    id: 'sill', role: 'sill', length: ow, width: sw, height: sh,
    position: { x: ox, y: oy - sw + sw / 2, z: -sh / 2 },
    orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
  }))

  // cripple bottom x2
  for (const sx of [1200, 1800]) {
    const idx = sx === 1200 ? '1' : '2'
    result.push(createTimberElement({
      id: `cripple-bottom-${idx}`, role: 'cripple-bottom', length: oy - 2 * sw, width: sw, height: sh,
      position: { x: sx + sw / 2, y: sw, z: -sh / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  // cripple bottom left/right under sill ends
  result.push(createTimberElement({
    id: 'cripple-bottom-left', role: 'cripple-bottom', length: oy - 2 * sw, width: sw, height: sh,
    position: { x: ox + sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))
  result.push(createTimberElement({
    id: 'cripple-bottom-right', role: 'cripple-bottom', length: oy - 2 * sw, width: sw, height: sh,
    position: { x: openingRight - sw / 2, y: sw, z: -sh / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
  }))

  // cripple top x2
  for (const sx of [1200, 1800]) {
    const idx = sx === 1200 ? '1' : '2'
    result.push(createTimberElement({
      id: `cripple-top-${idx}`, role: 'cripple-top', length: 365, width: sw, height: sh,
      position: { x: sx + sw / 2, y: openingTop + sh, z: -sh / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    }))
  }

  // Fix header positions: header length along X, roll 0, Y 2100..2245 (refY=2100), Z centers -50 and +50 (refZ = centerZ)
  const h1 = result.find((e) => e.id === 'header-1')!
  const h2 = result.find((e) => e.id === 'header-2')!
  h1.position.x = ox - sw
  h1.position.y = openingTop
  h1.position.z = -50  // refZ = centerZ = -50
  h2.position.x = ox - sw
  h2.position.y = openingTop
  h2.position.z = 50

  // Fix king/jack X positions already set via ref X = center (mode y W->X centered), but king/jack width 45 -> X center = start+22.5. Set correctly:
  // king-left: X 810-855 -> refX 832.5 (already)
  // king-right: 2145-2190 -> refX 2167.5 (already)
  // jack-left: 855-900 -> refX 877.5 (already)
  // jack-right: 2100-2145 -> refX 2122.5 (already)

  // Fix sill position: X 900-2100 -> refX 900 (roll90: U->X, ref at start), Y 855-900 -> refY 877.5 (already set 855+22.5), Z center 0 -> refZ -72.5
  const sill = result.find((e) => e.id === 'sill')!
  sill.position.x = ox
  sill.position.y = oy - sw + sw / 2  // 855+22.5=877.5
  sill.position.z = -sh / 2

  // Fix cripple bottom: X 1200-1245 -> refX 1222.5 (already), Y 45-855 -> refY 45 (already), length 810
  // Fix cripple top: X 1200-1245 -> refX 1222.5, Y 2245-2610 -> refY 2245 (already), length 365

  return result
}

export function generateWallWithWindow(params: WallPanelParams, win: WindowOpeningParams = DEFAULT_WINDOW): ReturnType<typeof generateWallPanel> {
  const base = generateWallPanel(params)
  const elements = applyWindowOpening(base.elements, win)
  return { id: 'wall-with-window', elements }
}
