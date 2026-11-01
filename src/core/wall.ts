
import { createTimberElement as cte } from './timber'
import type { FrameAssembly } from './assembly'
import type { TimberElement } from './timber'

export interface WallPanelParams {
  length: number
  height: number
  sectionWidth: number
  sectionHeight: number
  spacing: number
  topLayers: number
}

function studStarts(length: number, spacing: number, sectionWidth: number): number[] {
  const starts: number[] = [0]
  let x = spacing
  while (x + sectionWidth < length) {
    starts.push(x)
    x += spacing
  }
  const last = length - sectionWidth
  if (!starts.includes(last)) starts.push(last)
  return [...new Set(starts)].sort((a, b) => a - b)
}

export function generateWallPanel(params: WallPanelParams): FrameAssembly {
  const { length, height, sectionWidth: sw, sectionHeight: sh, spacing, topLayers } = params
  const elements: TimberElement[] = []

  // bottom plate
  elements.push(cte({
    id: 'plate-bottom-1',
    role: 'bottom-plate',
    length,
    width: sw,
    height: sh,
    position: { x: 0, y: sw / 2, z: -sh / 2 },
    orientation: { mode: 'x', angle: 0, roll: 90 },
    material: 'wood',
  }))

  // studs
  const studLength = height - sw * (1 + topLayers)
  const starts = studStarts(length, spacing, sw)
  starts.forEach((sx, i) => {
    const idx = String(i + 1).padStart(2, '0')
    elements.push(cte({
      id: `stud-${idx}`,
      role: 'stud',
      length: studLength,
      width: sw,
      height: sh,
      position: { x: sx + sw / 2, y: sw, z: -sh / 2 },
      orientation: { mode: 'y', angle: 0, roll: 0 },
      material: 'wood',
    }))
  })

  // top plates
  const plateThickness = sw
  let yBottom = height - sw * topLayers
  for (let i = 0; i < topLayers; i++) {
    elements.push(cte({
      id: `plate-top-${i + 1}`,
      role: 'top-plate',
      length,
      width: sw,
      height: sh,
      position: { x: 0, y: yBottom + sw / 2, z: -sh / 2 },
      orientation: { mode: 'x', angle: 0, roll: 90 },
      material: 'wood',
    }))
    yBottom += plateThickness
  }

  return { id: 'wall-panel', elements }
}
