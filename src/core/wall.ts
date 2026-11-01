
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
  if (length < 2 * sectionWidth) {
    throw new Error('Wall length too short for two studs')
  }
  const minInterval = 300
  const right = length - sectionWidth
  const starts: number[] = [0]
  let x = spacing
  while (x <= right - minInterval) {
    starts.push(x)
    x += spacing
  }
  // last pushed is the largest multiple <= right - minInterval
  const lastPushed = starts[starts.length - 1]
  const remaining = right - lastPushed
  if (remaining <= spacing) {
    if (!starts.includes(right)) starts.push(right)
  } else {
    const n = Math.ceil(remaining / spacing)
    const step = remaining / n
    for (let i = 1; i < n; i++) {
      const pos = lastPushed + step * i
      if (!starts.includes(Math.round(pos * 1000) / 1000)) starts.push(pos)
    }
    if (!starts.includes(right)) starts.push(right)
  }
  return [...new Set(starts.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
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
