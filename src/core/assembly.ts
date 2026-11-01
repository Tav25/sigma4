
import {
  createTimberElement,
  type TimberElement,
} from './timber'

export interface FrameAssembly {
  id: string
  elements: TimberElement[]
}

export function createMiniAssembly(): FrameAssembly {
  const plate = createTimberElement({
    id: 'plate-bottom-1',
    role: 'bottom-plate',
    length: 3000,
    width: 45,
    height: 145,
    position: { x: 0, y: 22.5, z: -72.5 },
    orientation: { mode: 'x', angle: 0, roll: 90 },
    material: 'wood',
  })
  const studLeft = createTimberElement({
    id: 'stud-left',
    role: 'stud',
    length: 2565,
    width: 45,
    height: 145,
    position: { x: 22.5, y: 45, z: -72.5 },
    orientation: { mode: 'y', angle: 0, roll: 0 },
    material: 'wood',
  })
  const studRight = createTimberElement({
    id: 'stud-right',
    role: 'stud',
    length: 2565,
    width: 45,
    height: 145,
    position: { x: 2977.5, y: 45, z: -72.5 },
    orientation: { mode: 'y', angle: 0, roll: 0 },
    material: 'wood',
  })
  return { id: 'mini-assembly', elements: [plate, studLeft, studRight] }
}
