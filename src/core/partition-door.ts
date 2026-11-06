import type { WindowOpening } from './window'
import { generateWallPanel, type WallPanelParams } from './wall'
import { doorProfile, doorFrameMembers, doorBottomPlates } from './door-frame'
import type { TimberElement } from './timber'

/** Nonbearing door: same framing engine as exterior, different head/support profile. */
export function generatePartitionWithDoors(params: WallPanelParams, doors: WindowOpening[]) {
  const { sectionWidth: width, sectionHeight: depth, height } = params
  const panel = generateWallPanel(params)
  const caps = panel.elements.filter(element => element.role === 'top-plate')
  const sorted = [...doors].sort((a,b)=>a.positionXmm-b.positionXmm)
  const plates = doorBottomPlates(params, sorted, 'partition')
  const members: TimberElement[] = []
  for(const door of sorted){
    const before=plates.find(p=>p.id===door.id+'-bottom-before')
    if(before)members.push(before)
    members.push(...doorFrameMembers(door,{
      widthMm:width,depthMm:depth,wallHeightMm:height,topLayers:params.topLayers,
    },doorProfile(door,true,depth)))
  }
  const tail=plates.find(p=>p.id==='plate-bottom-last')
  if(tail)members.push(tail)
  const studs = panel.elements.filter(element => element.role === 'stud').flatMap(stud => {
    const min = stud.position.x - width / 2, max = min + width
    const door = sorted.find(item => max > item.positionXmm - width &&
      min < item.positionXmm + item.widthMm + width)
    if (!door) return [stud]
    if (min < door.positionXmm || max > door.positionXmm + door.widthMm) return []
    const y = door.heightMm + width
    const cripple = height - params.topLayers * width - y
    return cripple > 0 ? [{
      ...stud, role: 'cripple-top' as const, length: cripple,
      position: { ...stud.position, y },
    }] : []
  })
  return { ...panel, elements: [...caps, ...studs, ...members] }
}
