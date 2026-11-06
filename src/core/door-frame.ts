import { createTimberElement, type TimberElement } from './timber'
import type { WindowOpening } from './window'
import type { WallPanelParams } from './wall'

/**
 * Shared doorway algorithm for all wall types. The chosen structural profile
 * determines the HEAD and SUPPORT PACKAGE, not how the doorway is positioned.
 *
 * These profiles describe geometry only. A load-bearing header remains
 * an UNVERIFIED design preview until checked by an engineer.
 */
export type DoorFrameProfile =
  | { kind: 'nonbearing-flat' }
  | { kind: 'bearing-double-preview'; jackStudsPerSide: number; depthMm: number }
  | { kind: 'garage-engineered-preview'; jackStudsPerSide: number; depthMm: number }

export interface DoorFrameContext {
  widthMm: number
  depthMm: number
  wallHeightMm: number
  topLayers: number
}

export function doorProfile(opening: WindowOpening, nonbearing: boolean, depthMm: number): DoorFrameProfile {
  if (nonbearing) {
    if (opening.type !== 'door') throw Error('В ненесущей перегородке поддерживаются обычные двери')
    return { kind: 'nonbearing-flat' }
  }
  if (opening.type === 'garage-door') {
    if (!opening.garage) throw Error('Garage specification required')
    return {
      kind: 'garage-engineered-preview',
      jackStudsPerSide: opening.garage.jackStudsPerSide,
      depthMm: opening.garage.lintelPreviewDepthMm,
    }
  }
  return { kind: 'bearing-double-preview', jackStudsPerSide: 1, depthMm }
}

/** Common king-post, optional jack-post and header generator. */
export function doorFrameMembers(
  opening: WindowOpening, context: DoorFrameContext, profile: DoorFrameProfile,
): TimberElement[] {
  const sw = context.widthMm
  const depth = context.depthMm
  const start = opening.positionXmm
  const finish = start + opening.widthMm
  const top = opening.sillHeightMm + opening.heightMm
  const supports = profile.kind === 'nonbearing-flat' ? 0 : profile.jackStudsPerSide
  const headerDepth = profile.kind === 'nonbearing-flat' ? sw : profile.depthMm
  if (!Number.isFinite(start) || !Number.isFinite(finish) || !Number.isFinite(top) ||
      finish <= start || sw <= 0 || depth <= 0 || top <= 0 ||
      !Number.isInteger(supports) || supports < 0 || supports > 4 ||
      !Number.isFinite(headerDepth) || headerDepth <= 0 ||
      top + headerDepth > context.wallHeightMm - context.topLayers * sw) {
    throw Error('Некорректная конструкция дверного проёма ' + opening.id)
  }
  const y = sw
  const kingLen = context.wallHeightMm - sw * (1 + context.topLayers)
  const post = (suffix: string, role: string, x: number, length: number) =>
    createTimberElement({
      id: opening.id + '-' + suffix, role, length, width: sw, height: depth,
      position: { x, y, z: -depth / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 }, material: 'wood',
    })
  const kings = [
    post('king-left', 'king-stud', start - supports * sw - sw / 2, kingLen),
    post('king-right', 'king-stud', finish + supports * sw + sw / 2, kingLen),
  ]
  if (profile.kind === 'nonbearing-flat') {
    const head = createTimberElement({
      id: opening.id + '-header', role: 'header',
      length: opening.widthMm, width: sw, height: depth,
      position: { x: start, y: top + sw / 2, z: -depth / 2 },
      orientation: { mode: 'x', angle: 0, roll: 90 }, material: 'wood',
    })
    // Preserve existing linked partition member ordering and member IDs.
    return [head, ...kings]
  }
  const jacks: TimberElement[] = []
  for (let i = 0; i < supports; i++) {
    const suffix = i === 0 ? '' : '-' + (i + 1)
    const length = top - sw
    jacks.push(post('jack-left' + suffix, 'jack-stud', start - sw / 2 - i * sw, length))
    jacks.push(post('jack-right' + suffix, 'jack-stud', finish + sw / 2 + i * sw, length))
  }
  const role = profile.kind === 'garage-engineered-preview'
    ? 'garage-lintel-preview' : 'header'
  const length = opening.widthMm + 2 * sw * supports
  const header = (n: number, z: number) => createTimberElement({
    id: opening.id + '-header-' + n, role, length, width: sw, height: headerDepth,
    position: { x: start - supports * sw, y: top, z },
    orientation: { mode: 'x', angle: 0, roll: 0 }, material: 'wood',
  })
  return [...kings, ...jacks, header(1, -50), header(2, 50)]
}

/**
 * All doorway profiles cut the bottom plate at the same opening coordinates.
 * Names stay compatible with existing project modules (no migration of JSON).
 */
export function doorBottomPlates(
  params: WallPanelParams, doors: readonly WindowOpening[],
  naming: 'exterior' | 'partition',
): TimberElement[] {
  const sw = params.sectionWidth, sh = params.sectionHeight
  const sorted = [...doors].sort((a, b) => a.positionXmm - b.positionXmm)
  const result: TimberElement[] = []
  let previous = 0
  const add = (id:string, start:number, end:number) => {
    if (end <= start) return
    result.push(createTimberElement({
      id, role:'bottom-plate', length:end-start, width:sw,height:sh,
      position:{x:start,y:sw/2,z:-sh/2},
      orientation:{mode:'x',angle:0,roll:90},material:'wood',
    }))
  }
  sorted.forEach((door,i)=>{
    const start=door.positionXmm, end=start+door.widthMm
    if(start<previous || end>params.length)
      throw Error('Пересекающиеся двери или проём за границами стены')
    if(naming==='partition') add(door.id+'-bottom-before',previous,start)
    else add(i===0?'plate-bottom-left':'plate-bottom-mid-'+i,previous,start)
    previous=end
  })
  add(naming==='partition'?'plate-bottom-last':'plate-bottom-right',previous,params.length)
  return result
}
