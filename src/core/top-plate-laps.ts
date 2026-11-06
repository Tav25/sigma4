import type { PlanPoint } from './floor-plan'
import type { TimberElement, Wall } from './project'
import {
  isPartitionWall, partitionAttachments, type PartitionSide, type PartitionHost,
} from './partition-layout'

/**
 * Haun-style cap-plate laps for equal-height, orthogonal, timber-framed walls.
 * First top plates remain in their original wall panel. Second top plates
 * interrupt the through wall at the channel; the butt wall's cap runs across
 * the channel, making a real shared-volume-free X/Z horizontal tie.
 *
 * All changes apply to derived elements, NEVER to authored floorPlan.graph.
 */
type Junction = {
  point: PlanPoint
  host: PartitionHost
  branches: { side: PartitionSide; atStart: boolean; trim: number }[]
}
const EPS = 0.001
const alongX = (side: PartitionHost) => side.start.zMm === side.end.zMm
const onSegment = (p: PlanPoint, side: PartitionHost) =>
  alongX(side)
    ? p.zMm === side.start.zMm &&
      p.xMm >= Math.min(side.start.xMm, side.end.xMm) &&
      p.xMm <= Math.max(side.start.xMm, side.end.xMm)
    : p.xMm === side.start.xMm &&
      p.zMm >= Math.min(side.start.zMm, side.end.zMm) &&
      p.zMm <= Math.max(side.start.zMm, side.end.zMm)
const key = (p: PlanPoint) => p.xMm + '_' + p.zMm
const nodeU = (wall: Wall, node: PlanPoint): number =>
  wall.orientation === 'z'
    ? (wall.origin.z - node.zMm) * (wall.reversed ? -1 : 1)
    : (node.xMm - wall.origin.x) * (wall.reversed ? -1 : 1)
const isCap = (el: TimberElement, id: string): boolean =>
  el.wallId === id && el.role === 'top-plate' &&
  el.elementId.startsWith(id + ':plate-top-2')
const link = (a: TimberElement, b: TimberElement) => {
  if (!a.connectionIds.includes(b.elementId)) a.connectionIds.push(b.elementId)
  if (!b.connectionIds.includes(a.elementId)) b.connectionIds.push(a.elementId)
}

/** Remove [lo, hi] from a wall's second top-plate layer, preserving pieces. */
function openCapChannel(
  elements: TimberElement[], wall: Wall, lo: number, hi: number, junctionKey: string,
): TimberElement[] {
  const existing = elements.filter(element => isCap(element, wall.wallId))
  if (!existing.length) throw Error('Отсутствует второй верхний слой стены ' + wall.wallId)
  let changed = false
  for (const el of existing) {
    const start = el.position.x, end = start + el.lengthMm
    const a = Math.max(start, lo), b = Math.min(end, hi)
    if (b - a <= EPS) continue
    changed = true
    const left = a - start, right = end - b
    if (left > EPS && right > EPS) {
      el.lengthMm = left
      const next: TimberElement = {
        ...el,
        elementId: el.elementId + '-channel-' + junctionKey,
        position: { ...el.position, x: b },
        lengthMm: right,
        // A split creates a NEW physical piece, not a copy of its old joints.
        connectionIds: [],
      }
      if (elements.some(other => other.elementId === next.elementId))
        throw Error('Повторяющийся элемент верхней обвязки')
      elements.push(next)
    } else if (left > EPS) {
      el.lengthMm = left
    } else if (right > EPS) {
      el.position = { ...el.position, x: b }
      el.lengthMm = right
    } else {
      elements.splice(elements.indexOf(el), 1)
    }
  }
  if (!changed) throw Error('Верхняя обвязка не пересекает конструктивный узел ' + junctionKey)
  return elements.filter(el => isCap(el, wall.wallId))
}

/** True if a physical cap segment ends at either side of an open channel. */
function endsAt(el: TimberElement, u: number) {
  return Math.abs(el.position.x - u) <= EPS ||
    Math.abs(el.position.x + el.lengthMm - u) <= EPS
}
const trimAt = (side: PartitionSide, atStart: boolean) =>
  atStart ? side.insetMm : side.endInsetMm

/**
 * Wraps around the 0.1.19 wall generator. Uses partition graph topology:
 *   T (including exterior): one branch crosses a through wall's top cap.
 *   X: both opposing branches meet at the host wall's centre line.
 *   L: the positive-trim branch overlaps the through/extended neighbour.
 * Fully-collinear through-wall segments are not reinterpreted as butt walls.
 */
export function connectTopPlateLaps(
  elements: TimberElement[],
  walls: readonly Wall[],
  sides: readonly PartitionSide[],
): void {
  const byId = new Map(walls.map(w => [w.wallId, w]))
  const groups = new Map<string, Junction>()
  for (const side of sides) {
    const attachments = partitionAttachments(side)
    for (const attachment of attachments) {
      const trim = trimAt(side, attachment.atStart)
      if (trim <= EPS) continue
      const point = attachment.atStart ? side.start : side.end
      const id = key(point)
      const found = groups.get(id)
      if (found) {
        if (found.host.wallId !== attachment.host.wallId &&
          alongX(found.host) !== alongX(attachment.host))
          throw Error('Невозможно определить сквозную стену узла ' + id)
        found.branches.push({ side, atStart: attachment.atStart, trim })
      } else {
        groups.set(id, {
          point, host: attachment.host,
          branches: [{ side, atStart: attachment.atStart, trim }],
        })
      }
    }
  }

  for (const [junctionKey, node] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (node.branches.length > 2)
      throw Error('Неподдерживаемое пересечение более двух примыкающих стен ' + junctionKey)

    const branchWalls = node.branches.map(b => byId.get(b.side.wallId))
    const hostWall = byId.get(node.host.wallId)
    if (!hostWall || branchWalls.some(w => !w)) throw Error('Отсутствует стена узла ' + junctionKey)
    const hostThickness = hostWall.sectionMm.height
    const depths = branchWalls.map(w => w!.sectionMm.height)
    if (depths.some(d => Math.abs(d - depths[0]) > EPS))
      throw Error('Перегородки разной толщины в крестовом узле ' + junctionKey)

    if (node.branches.length === 2) {
      const [a, b] = node.branches
      const axisA = alongX(a.side), axisB = alongX(b.side)
      const go = (side: PartitionSide, atStart: boolean) => {
        const from = atStart ? side.start : side.end
        const to = atStart ? side.end : side.start
        return axisA ? Math.sign(to.xMm - from.xMm) : Math.sign(to.zMm - from.zMm)
      }
      if (axisA !== axisB || go(a.side, a.atStart) === go(b.side, b.atStart))
        throw Error('Некорректное крестообразное соединение ' + junctionKey)
    }

    // A continuous exterior member or all two collinear graph fragments
    // on the host axis make up the through-wall upper layer.
    const through = isPartitionWall(node.host.wallId)
      ? sides.filter(s => alongX(s) === alongX(node.host) && onSegment(node.point, s))
      : [node.host]
    const hostCaps: TimberElement[] = []
    for (const s of through) {
      const wall = byId.get(s.wallId)
      if (!wall) throw Error('Отсутствует сквозная стена ' + s.wallId)
      const u = nodeU(wall, node.point)
      const gap = depths[0]
      const lo = u - gap / 2, hi = u + gap / 2
      hostCaps.push(...openCapChannel(elements, wall, lo, hi, junctionKey)
        .filter(cap => endsAt(cap, lo) || endsAt(cap, hi)))
    }
    if (!hostCaps.length)
      throw Error('Не удалось подготовить зазор под верхнюю обвязку ' + junctionKey)

    const branches: TimberElement[] = []
    for (const branch of node.branches) {
      const wall = byId.get(branch.side.wallId)!
      const caps = elements.filter(el => isCap(el, wall.wallId))
      const cap = caps.sort((a, b) => branch.atStart
        ? a.position.x - b.position.x
        : (b.position.x + b.lengthMm) - (a.position.x + a.lengthMm))[0]
      if (!cap) throw Error('У перегородки нет второй верхней обвязки ' + wall.wallId)

      // With one butt wall, cap runs completely ACROSS the host. With two
      // opposing butt walls, both caps extend only to the central seam.
      const amount = node.branches.length === 2 ? branch.trim : hostThickness
      if (!Number.isFinite(amount) || amount <= EPS)
        throw Error('Некорректный нахлёст верхней обвязки ' + wall.wallId)
      if (branch.atStart) cap.position = { ...cap.position, x: cap.position.x - amount }
      cap.lengthMm += amount
      branches.push(cap)
    }
    for (const branch of branches) for (const host of hostCaps) link(branch, host)
    if (branches.length === 2) link(branches[0], branches[1])
  }

  // The perimeter's second plate was initially linked by
  // connectPerimeterCorner(), BEFORE its T channels were cut. Every split
  // changes the ownership of the end piece. Do not retain the old links on
  // cloned pieces: reconstruct four outer-corner pairs from the physically
  // ordered wall modules. Interior T/X links, added above, are untouched.
  const outer=walls.slice(0,4)
  const perimeterIds=new Set(outer.map(w=>w.wallId))
  const outsideSecond=elements.filter(e=>perimeterIds.has(e.wallId) &&
    isCap(e,e.wallId))
  for(const cap of outsideSecond){
    cap.connectionIds=cap.connectionIds.filter(otherId=>
      !outsideSecond.some(other=>other.elementId===otherId&&
        other.wallId!==cap.wallId))
  }
  for(let i=0;i<outer.length;i++){
    const a=outer[i],b=outer[(i+1)%outer.length]
    const aPieces=outsideSecond.filter(e=>e.wallId===a.wallId)
    const bPieces=outsideSecond.filter(e=>e.wallId===b.wallId)
    const end=aPieces.sort((l,r)=>
      (r.position.x+r.lengthMm)-(l.position.x+l.lengthMm))[0]
    const start=bPieces.sort((l,r)=>l.position.x-r.position.x)[0]
    if(!end||!start)throw Error('Нет второго верхнего слоя для наружного угла '+
      a.wallId+' — '+b.wallId)
    link(end,start)
  }
}
