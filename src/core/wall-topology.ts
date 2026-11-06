import type { Wall, WallConnection, ValidationIssue, ProjectDocument, Vector3 } from './project'
import { rightCornerOrigin } from './corner'
import { wallLocalToWorld } from './world-origin'

const EPS = 0.01
const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function wallEnd(wall: Wall): Vector3 {
  return wallLocalToWorld(wall.origin, wall.orientation, wall.reversed, wall.lengthMm, 0, 0)
}

/** Read legacy two-wall California joint without silently rewriting old JSON. */
export function effectiveConnections(doc: ProjectDocument): WallConnection[] {
  if (Array.isArray(doc.building.connections)) return doc.building.connections
  if (doc.building.walls.length !== 2) return []
  const [first, second] = doc.building.walls
  return [{ fromWallId: first.wallId, toWallId: second.wallId, type: 'california-right' }]
}

export function jointOrigin(parent: Wall, child: Wall, type: WallConnection['type']): Vector3 {
  return type === 'california-right' ? rightCornerOrigin(parent, child) : wallEnd(parent)
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

export function wallFootprint(wall: Wall) {
  const opposite = wallLocalToWorld(wall.origin, wall.orientation, wall.reversed,
    wall.lengthMm, 0, -wall.sectionMm.height)
  return {
    minX: Math.min(wall.origin.x, opposite.x), maxX: Math.max(wall.origin.x, opposite.x),
    minZ: Math.min(wall.origin.z, opposite.z), maxZ: Math.max(wall.origin.z, opposite.z),
  }
}

/**
 * Source-only topology validation. Conservative rectangles prevent collisions
 * without trusting derived assembly. Only California and straight joints
 * have a physical joinery algorithm in this version.
 */
export function validateWallTopology(
  walls: readonly Wall[], connections: readonly WallConnection[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const fail = (code: string, messageRu: string, ids: string[]) => {
    issues.push({ code, severity: 'error', path: 'building.connections', messageRu, affectedIds: ids })
  }
  const byId = new Map(walls.map(w => [w.wallId, w]))
  const out = new Set<string>()
  const incoming = new Set<string>()
  for (const wall of walls) {
    if (!['x', 'z'].includes(wall.orientation)) {
      fail('UNSUPPORTED_WALL_AXIS', 'Сейчас поддерживается направление стен X или -Z', [wall.wallId])
    }
    if (![wall.lengthMm, wall.heightMm, wall.sectionMm?.height,
      wall.origin?.x, wall.origin?.y, wall.origin?.z].every(validNumber)) {
      fail('NON_FINITE_WALL_GEOMETRY', 'Координаты и размеры стены должны быть конечными числами', [wall.wallId])
    }
  }
  for (const link of connections) {
    if (!link || typeof link !== 'object' ||
      !['california-right', 'end-to-end'].includes(link.type)) {
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
       (walls[0] !== from || walls[1] !== to || from.orientation !== 'x' || to.orientation !== 'z' || from.reversed || to.reversed)) {
      fail('UNSUPPORTED_CALIFORNIA_JOINT', 'Калифорнийский угол пока поддержан для первых двух стен X → -Z', ids)
    }
    if (link.type === 'end-to-end' && (from.orientation !== to.orientation || from.reversed !== to.reversed)) {
      fail('INVALID_END_TO_END_AXIS', 'Прямой стык возможен только у сонаправленных стен', ids)
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
      const p = wallFootprint(a), q = wallFootprint(b)
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
