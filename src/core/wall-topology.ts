import type { Wall, WallConnection, ValidationIssue, ProjectDocument, Vector3 } from './project'
import { rightCornerOrigin } from './corner'
import { chainJointOrigin, connectionTurn, isPlanDirection, planOutside, planUnit,
  rotatedDirection, wallEndPosition, wallFrameInsets } from './wall-chain'

const EPS = 0.01
const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function wallEnd(wall: Wall): Vector3 {
  return wallEndPosition(wall)
}

/** Read legacy two-wall California joint without silently rewriting old JSON. */
export function effectiveConnections(doc: ProjectDocument): WallConnection[] {
  if (Array.isArray(doc.building.connections)) return doc.building.connections
  if (doc.building.walls.length !== 2) return []
  const [first, second] = doc.building.walls
  return [{ fromWallId: first.wallId, toWallId: second.wallId, type: 'california-right' }]
}

export function jointOrigin(parent: Wall, child: Wall, type: WallConnection['type']): Vector3 {
  if (type === 'california-right') return rightCornerOrigin(parent, child)
  const turn = connectionTurn({ fromWallId: parent.wallId, toWallId: child.wallId, type })
  return turn ? chainJointOrigin(parent, child, turn) : wallEnd(parent)
}

/** Re-anchor all descendants when their parent changes; independent walls stay put. */
export function reflowConnections(walls: Wall[], connections: readonly WallConnection[]): void {
  const byId = new Map(walls.map(wall => [wall.wallId, wall]))
  const visited = new Set<string>()
  const recur = (parent: Wall) => {
    if (visited.has(parent.wallId)) return
    visited.add(parent.wallId)
    for (const link of connections.filter(item => item.fromWallId === parent.wallId)) {
      const child = byId.get(link.toWallId)
      if (!child || visited.has(child.wallId)) continue
      child.origin = jointOrigin(parent, child, link.type)
      recur(child)
    }
  }
  for (const wall of walls) {
    if (!connections.some(link => link.toWallId === wall.wallId)) recur(wall)
  }
}

export function wallFootprint(wall: Wall, inset: { startMm: number; endMm: number } = {
  startMm: 0, endMm: 0,
}) {
  if (!isPlanDirection(wall.orientation)) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  }
  const d = planUnit(wall.orientation)
  const n = planOutside(wall.orientation)
  const a = {
    x: wall.origin.x + d.x * inset.startMm,
    z: wall.origin.z + d.z * inset.startMm,
  }
  const b = {
    x: wall.origin.x + d.x * (wall.lengthMm - inset.endMm),
    z: wall.origin.z + d.z * (wall.lengthMm - inset.endMm),
  }
  const depth = wall.sectionMm.height
  const xx = [a.x, b.x, a.x - n.x * depth, b.x - n.x * depth]
  const zz = [a.z, b.z, a.z - n.z * depth, b.z - n.z * depth]
  return {
    minX: Math.min(...xx), maxX: Math.max(...xx),
    minZ: Math.min(...zz), maxZ: Math.max(...zz),
  }
}

/**
 * Source-only topology validation. Conservative rectangles prevent collisions
 * without trusting derived assembly. Only California and straight joints
 * have a physical joinery algorithm in this version.
 */
export function validateWallTopology(
  walls: readonly Wall[], connections: readonly WallConnection[],
  closure?: ProjectDocument['building']['closure'],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const fail = (code: string, messageRu: string, ids: string[]) => {
    issues.push({ code, severity: 'error', path: 'building.connections', messageRu, affectedIds: ids })
  }
  const byId = new Map(walls.map(w => [w.wallId, w]))
  const out = new Set<string>()
  const incoming = new Set<string>()
  for (const wall of walls) {
    if (!isPlanDirection(wall.orientation)) {
      fail('UNSUPPORTED_WALL_AXIS', 'Поддерживаются направления +X, −Z, −X, +Z', [wall.wallId])
    }
    if (![wall.lengthMm, wall.heightMm, wall.sectionMm?.height,
      wall.origin?.x, wall.origin?.y, wall.origin?.z].every(validNumber)) {
      fail('NON_FINITE_WALL_GEOMETRY', 'Координаты и размеры стены должны быть конечными числами', [wall.wallId])
    }
  }
  for (const link of connections) {
    if (!link || typeof link !== 'object' ||
      !['california-right', 'end-to-end', 'chain-turn-right', 'chain-turn-left'].includes(link.type)) {
      fail('INVALID_WALL_CONNECTION', 'Недопустимый тип соединения', [])
      continue
    }
    const ids = [link.fromWallId, link.toWallId]
    const from = byId.get(link.fromWallId)
    const to = byId.get(link.toWallId)
    if (!from || !to || from === to) {
      fail('INVALID_WALL_CONNECTION', 'Соединение ссылается на отсутствующую стену или само на себя', ids)
      continue
    }
    if (out.has(link.fromWallId) || incoming.has(link.toWallId)) {
      fail('CONNECTION_END_OCCUPIED', 'Торец занят или у стены больше одного родителя', ids)
    }
    out.add(link.fromWallId)
    incoming.add(link.toWallId)
    if (from.sectionMm.width !== to.sectionMm.width ||
        from.sectionMm.height !== to.sectionMm.height ||
        from.heightMm !== to.heightMm) {
      fail('INCOMPATIBLE_JOIN_SECTIONS', 'Высота и сечения соединяемых стен должны совпадать', ids)
    }
    if (link.type === 'california-right' &&
       (walls[0] !== from || walls[1] !== to || from.orientation !== 'x' || to.orientation !== 'z')) {
      fail('UNSUPPORTED_CALIFORNIA_JOINT', 'Калифорнийский угол пока поддержан для первых двух стен X → -Z', ids)
    }
    if (link.type === 'end-to-end' && from.orientation !== to.orientation) {
      fail('INVALID_END_TO_END_AXIS', 'Прямой стык возможен только у сонаправленных стен', ids)
    }
    const turn = connectionTurn(link)
    if (turn && isPlanDirection(from.orientation) && isPlanDirection(to.orientation) &&
      rotatedDirection(from.orientation, turn) !== to.orientation) {
      fail('INVALID_CHAIN_TURN', 'Направление стены не соответствует повороту цепочки', ids)
    }
    const origin = jointOrigin(from, to, link.type)
    if ((['x', 'y', 'z'] as const).some(axis =>
      !validNumber(origin[axis]) || Math.abs(origin[axis] - to.origin[axis]) > EPS)) {
      fail('WALL_JOINT_GAP', 'Нарушены координаты соединения: зазор или проникновение', ids)
    }
  }
  // One outgoing / incoming per wall still permits cycles; reject those.
  const next = new Map(connections.filter(link => link && typeof link.fromWallId === 'string' &&
    typeof link.toWallId === 'string').map(link => [link.fromWallId, link.toWallId]))
  for (const wall of walls) {
    const seen = new Set<string>()
    let current: string | undefined = wall.wallId
    while (current && next.has(current)) {
      if (seen.has(current)) {
        fail('WALL_CONNECTION_CYCLE', 'Замкнутый контур требует отдельного расчёта углов', [wall.wallId])
        break
      }
      seen.add(current)
      current = next.get(current)
    }
  }
  if (closure) {
    const ids = [closure.fromWallId, closure.toWallId]
    const first = walls[0], last = walls[walls.length - 1]
    if (!first || !last || walls.length < 4 ||
      closure.type !== 'butt-right' || closure.fromWallId !== last.wallId ||
      closure.toWallId !== first.wallId) {
      fail('INVALID_WALL_CLOSURE', 'Замыкание возможно только с последней стены к первой', ids)
    } else if (connections.length !== walls.length - 1 ||
      walls.slice(1).some((wall, i) => connections[i]?.fromWallId !== walls[i].wallId ||
        connections[i]?.toWallId !== wall.wallId)) {
      fail('INVALID_WALL_CLOSURE', 'Для замыкания требуется последовательная цепочка', ids)
    } else if (!isPlanDirection(first.orientation) || !isPlanDirection(last.orientation) ||
      rotatedDirection(last.orientation, 'right') !== first.orientation) {
      fail('INVALID_WALL_CLOSURE', 'Замыкающий угол должен совпадать с началом первой стены', ids)
    } else {
      const end = wallEnd(last)
      if (Math.abs(end.x - first.origin.x) > EPS ||
          Math.abs(end.z - first.origin.z) > EPS ||
          Math.abs(end.y - first.origin.y) > EPS) {
        fail('WALL_CLOSURE_GAP', 'Замыкающая стена не достигает первой: измените длину цепочки', ids)
      }
    }
  }
  const asDocument = { building: { walls, connections, closure } } as ProjectDocument
  for (const wall of walls) {
    const inset = wallFrameInsets(asDocument, wall.wallId)
    if (wall.lengthMm - inset.startMm - inset.endMm < wall.sectionMm.width * 4) {
      fail('WALL_CORNER_TRIM_TOO_SHORT', 'Стена слишком короткая для соединения углов', [wall.wallId])
    }
  }
  // AABB footprint is a conservative but independent collision check.
  // California joint intentionally has overlapping wall footprints, though
  // its real board volumes were verified separately by the corner validator.
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j]
      if (![a.lengthMm, b.lengthMm, a.origin?.x, b.origin?.x, a.origin?.z, b.origin?.z,
        a.sectionMm?.height, b.sectionMm?.height].every(validNumber)) continue
      if (connections.some(link => link && link.type === 'california-right' &&
        link.fromWallId === a.wallId && link.toWallId === b.wallId)) continue
      const p = wallFootprint(a, wallFrameInsets(asDocument, a.wallId))
      const q = wallFootprint(b, wallFrameInsets(asDocument, b.wallId))
      const overlapX = Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX)
      const overlapZ = Math.min(p.maxZ, q.maxZ) - Math.max(p.minZ, q.minZ)
      if (overlapX > EPS && overlapZ > EPS) {
        fail('WALL_FOOTPRINT_OVERLAP', 'Стены пересекаются в плане без рассчитанного конструктивного узла',
          [a.wallId, b.wallId])
      }
    }
  }
  return issues
}
