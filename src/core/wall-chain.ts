import type { Wall, WallConnection, Vector3, ProjectDocument } from './project'

export type PlanDirection = 'x' | 'z' | '-x' | '+z'
export type ChainTurn = 'straight' | 'right' | 'left'

const directions: PlanDirection[] = ['x', 'z', '-x', '+z']
export function isPlanDirection(v: string): v is PlanDirection {
  return directions.includes(v as PlanDirection)
}
export function planUnit(direction: PlanDirection): { x: number; z: number } {
  switch (direction) {
    case 'x': return { x: 1, z: 0 }
    case 'z': return { x: 0, z: -1 }
    case '-x': return { x: -1, z: 0 }
    case '+z': return { x: 0, z: 1 }
  }
}
export function planOutside(direction: PlanDirection): { x: number; z: number } {
  const unit = planUnit(direction)
  return { x: -unit.z, z: unit.x }
}
export function rotatedDirection(direction: PlanDirection, turn: ChainTurn): PlanDirection {
  const i = directions.indexOf(direction)
  return directions[(i + (turn === 'right' ? 1 : turn === 'left' ? 3 : 0)) % 4]
}
export function wallEndPosition(wall: Wall): Vector3 {
  if (!isPlanDirection(wall.orientation)) throw new Error('Unsupported wall orientation')
  const d = planUnit(wall.orientation)
  return { x: wall.origin.x + d.x * wall.lengthMm, y: wall.origin.y,
    z: wall.origin.z + d.z * wall.lengthMm }
}
export function chainJointOrigin(parent: Wall, child: Wall, turn: ChainTurn): Vector3 {
  if (!isPlanDirection(parent.orientation) || !isPlanDirection(child.orientation)) {
    throw new Error('Unsupported wall direction in chain')
  }
  if (rotatedDirection(parent.orientation, turn) !== child.orientation) {
    throw new Error('Wall direction does not match selected turn')
  }
  const end = wallEndPosition(parent)
  if (turn !== 'left') return end
  const d = planUnit(child.orientation)
  return { x: end.x - d.x * parent.sectionMm.height, y: end.y,
    z: end.z - d.z * parent.sectionMm.height }
}
export function connectionTurn(link: WallConnection): ChainTurn | null {
  if (link.type === 'chain-turn-right') return 'right'
  if (link.type === 'chain-turn-left') return 'left'
  if (link.type === 'end-to-end') return 'straight'
  return null
}
/** Board insets are derived solely from approved connections, never stored twice. */
export function wallFrameInsets(document: ProjectDocument, wallId: string) {
  const walls = document.building.walls
  const wall = walls.find(w => w.wallId === wallId)
  if (!wall) throw new Error('Missing wall for framing')
  const incoming = document.building.connections?.find(c => c.toWallId === wallId)
  const parent = incoming ? walls.find(w => w.wallId === incoming.fromWallId) : undefined
  const startMm = incoming?.type === 'chain-turn-right' && parent
    ? parent.sectionMm.height : 0
  const endMm = document.building.closure?.fromWallId === wallId
    ? (walls.find(w => w.wallId === document.building.closure?.toWallId)?.sectionMm.height ?? 0)
    : 0
  return { startMm, endMm }
}
export interface ClosurePreview {
  valid: boolean
  direction: PlanDirection | null
  lengthMm: number
  reason: string
}
export function previewChainClosure(document: ProjectDocument): ClosurePreview {
  const walls = document.building.walls
  const fail = (reason: string): ClosurePreview => ({
    valid: false, direction: null, lengthMm: 0, reason,
  })
  if (document.building.closure) return fail('Контур уже замкнут')
  if (walls.length < 3) return fail('Нужно минимум три стены перед замыканием')
  const first = walls[0], last = walls[walls.length - 1]
  if (!isPlanDirection(last.orientation)) return fail('Неподдерживаемое направление стены')
  const links = document.building.connections ?? []
  if (links.length !== walls.length - 1 ||
    walls.slice(1).some((w, i) => links[i]?.fromWallId !== walls[i].wallId ||
      links[i]?.toWallId !== w.wallId)) {
    return fail('Замыкание возможно только для последовательной цепочки стен')
  }
  const end = wallEndPosition(last)
  const target = first.origin
  const direction = rotatedDirection(last.orientation, 'right')
  const d = planUnit(direction)
  const dx = target.x - end.x, dz = target.z - end.z
  const distance = dx * d.x + dz * d.z
  const lateral = Math.abs(dx * d.z - dz * d.x)
  if (lateral > 0.01 || distance < 500 || !Number.isFinite(distance)) {
    return fail('Последняя стена не может замкнуть начало одним прямым участком')
  }
  if (distance < first.sectionMm.height * 2 + 180) {
    return fail('Замыкающий участок слишком короткий для угловых стоек')
  }
  return { valid: true, direction, lengthMm: distance, reason: '' }
}
