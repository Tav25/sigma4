import type { Opening, TimberElement, Wall } from './project'

/**
 * Haun's "detail the plates" order for linked plan-wall assemblies:
 * structural endpoints, framed openings and intersecting-wall channels are
 * fixed FIRST. Ordinary full-height studs are then fitted only into the
 * remaining clear intervals; the layout restarts at each mandatory package.
 *
 * All boards are DERIVED. No source Wall, Opening or floorPlan.graph is edited.
 */
const EPS = 0.001
const round = (n: number) => Math.round(n * 1000) / 1000
const slug = (n: number) => round(n).toFixed(3).replace('.', 'p').replace('-', 'm')

interface Station {
  left: number
  right: number
  description: string
}

/** Centers strictly between two required supports, with center spacing <= max. */
export function centersBetween(left: number, right: number, maximumSpacing: number, studWidth: number): number[] {
  if (![left, right, maximumSpacing, studWidth].every(Number.isFinite) ||
    maximumSpacing < studWidth || studWidth <= 0 || right < left)
    throw Error('Некорректные параметры разметки стоек')
  const distance = right - left
  const bays = Math.max(1, Math.ceil((distance - EPS) / maximumSpacing))
  // Reset the on-centre tape at each king post or intersection, instead
  // of redistributing an arbitrary pitch through the entire wall.
  // If the final stud would be flush against the next mandatory post,
  // pull it back one stud width while retaining maximum spacing.
  const centers: number[] = []
  for (let i = 1; i < bays; i++) {
    const x = round(Math.min(left + i * maximumSpacing, right - studWidth))
    const prev = centers.length ? centers[centers.length - 1] : left
    if (x - prev < studWidth - EPS || x - prev > maximumSpacing + EPS)
      throw Error('Недопустимый пролёт рядовой стойки рядом с конструктивным узлом')
    centers.push(x)
  }
  return centers
}

function mandatoryStations(elements: readonly TimberElement[], wall: Wall, openings: readonly Opening[]): Station[] {
  const own = elements.filter(el => el.wallId === wall.wallId)
  const stations: Station[] = []
  for (const opening of openings.filter(o => o.wallId === wall.wallId)) {
    const left = own.find(el => el.elementId === wall.wallId + ':' + opening.id + '-king-left')
    const right = own.find(el => el.elementId === wall.wallId + ':' + opening.id + '-king-right')
    if (!left || !right) throw Error('Отсутствуют опорные стойки проёма ' + opening.id)
    stations.push({
      left: left.position.x, right: right.position.x,
      description: 'проём ' + opening.id,
    })
  }
  // The two full-depth studs of the Haun channel delimit the flatwise nailer.
  // We deliberately do not place ordinary studs inside this mandatory package.
  const receivers = new Map<string, { left?: number; right?: number }>()
  for (const member of own.filter(e => e.elementId.includes(':partition-backing-'))) {
    const match = member.elementId.match(/^(.*:partition-backing-.*)-(left|right)$/)
    if (!match) continue
    const slot = receivers.get(match[1]) ?? {}
    slot[match[2] as 'left' | 'right'] = member.position.x
    receivers.set(match[1], slot)
  }
  for (const [id, pair] of receivers) {
    if (pair.left === undefined || pair.right === undefined)
      throw Error('Отсутствует обязательная крайняя стойка узла ' + id)
    stations.push({ left: pair.left, right: pair.right, description: id })
  }
  // California corner backing is a flatwise, full-height member spanning
  // 145 mm ALONG the wall. It is just as mandatory as a three-stud channel.
  // Reserving its footprint BEFORE infill prevents the restarted on-centre
  // layout from driving a stud through that board near a wall end.
  for (const member of own.filter(el => el.role === 'corner-backing')) {
    const [lo, hi] = studExtent(member)
    const halfWidth = wall.sectionMm.width / 2
    if (hi - lo < wall.sectionMm.width - EPS)
      throw Error('Угловая закладная слишком узкая: ' + member.elementId)
    stations.push({
      left: lo + halfWidth, right: hi - halfWidth,
      description: 'угловая закладная ' + member.elementId,
    })
  }
  return stations.sort((a, b) => a.left - b.left || a.right - b.right)
}

function studExtent(member: TimberElement): [number, number] {
  if (member.orientation.mode === 'y' && Math.abs(member.orientation.roll) === 90) {
    return member.orientation.roll > 0
      ? [member.position.x, member.position.x + member.sectionMm.height]
      : [member.position.x - member.sectionMm.height, member.position.x]
  }
  return [member.position.x - member.sectionMm.width / 2,
    member.position.x + member.sectionMm.width / 2]
}

function physicalStud(wall: Wall, centre: number, id: string, role: TimberElement['role'],
  startY: number, lengthMm: number): TimberElement {
  return {
    elementId: wall.wallId + ':' + id,
    wallId: wall.wallId,
    role,
    sectionMm: { ...wall.sectionMm },
    lengthMm,
    position: { x: round(centre), y: startY, z: -wall.sectionMm.height / 2 },
    orientation: { mode: 'y', angle: 0, roll: 0 },
    connectionIds: [], generated: true,
  }
}

/**
 * Called only after all structural packages have been generated from JSON.
 * Endpoint studs created by generateWallPanel(required-first) are retained;
 * this preserves corner and interior-T connection IDs.
 */
export function detailLinkedStuds(elements: TimberElement[], walls: readonly Wall[],
  openings: readonly Opening[]): void {
  for (const wall of walls) {
    const sw = wall.sectionMm.width
    const first = elements.find(e => e.wallId === wall.wallId &&
      e.elementId === wall.wallId + ':stud-01' && e.role === 'stud')
    const last = elements.find(e => e.wallId === wall.wallId &&
      e.elementId === wall.wallId + ':stud-02' && e.role === 'stud')
    if (!first || !last || Math.abs(first.position.x - sw / 2) > EPS ||
      Math.abs(last.position.x - (wall.lengthMm - sw / 2)) > EPS)
      throw Error('Не найдены крайние опорные стойки стены ' + wall.wallId)

    const stations = mandatoryStations(elements, wall, openings)
    // No ordinary stud is allowed to cross a mandatory opening or receiver.
    const occupied = elements.filter(e => e.wallId === wall.wallId &&
      ['stud', 'king-stud', 'jack-stud', 'corner-backing'].includes(e.role))
    const centers: number[] = []
    const insert = (left: number, right: number) =>
      centers.push(...centersBetween(left, right, wall.studSpacingMm, sw))
    let prev = first.position.x
    const end = last.position.x
    for (const station of stations) {
      if (station.left < prev - EPS || station.right < station.left ||
        station.right > end + EPS) {
        throw Error('Конструктивные узлы пересекаются на стене ' +
          wall.wallId + ': ' + station.description)
      }
      insert(prev, station.left)
      prev = station.right
    }
    insert(prev, end)

    const fullHeight = wall.heightMm - sw * 3
    for (const x of centers) {
      const a = x - sw / 2, b = x + sw / 2
      const collision = occupied.find(el => {
        const [lo, hi] = studExtent(el)
        return Math.min(b, hi) - Math.max(a, lo) > EPS
      })
      if (collision) {
        throw Error('Рядовая стойка ' + wall.wallId + ' на ' + x +
          ' мм пересекает обязательный элемент ' + collision.elementId)
      }
      const member = physicalStud(wall, x, 'stud-layout-' + slug(x), 'stud', sw, fullHeight)
      if (elements.some(el => el.elementId === member.elementId))
        throw Error('Дублирующаяся стойка ' + member.elementId)
      elements.push(member)
    }

    // Detail the header and the sill independently from the king studs.
    // Old grid-based numbered cripples are NOT used in linked wall mode.
    for (const opening of openings.filter(o => o.wallId === wall.wallId)) {
      const prefix = wall.wallId + ':' + opening.id + '-'
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i]
        if (el.wallId === wall.wallId &&
          (el.role === 'cripple-top' || el.role === 'cripple-bottom') &&
          el.elementId.startsWith(prefix) &&
          /-cripple-(top|bottom)-\d+$/.test(el.elementId)) elements.splice(i, 1)
      }
      const inner = centersBetween(opening.positionUmm + sw / 2,
        opening.positionUmm + opening.widthMm - sw / 2, wall.studSpacingMm, sw)
      const headerDepth = opening.type === 'garage-door'
        ? opening.garage?.lintelPreviewDepthMm ?? wall.sectionMm.height
        : opening.type === 'door' && wall.wallId.startsWith('partition-')
          ? sw : wall.sectionMm.height
      const headerTop = opening.sillHeightMm + opening.heightMm + headerDepth
      const topLength = wall.heightMm - sw * 2 - headerTop
      const bottomLength = opening.sillHeightMm - 2 * sw
      for (const x of inner) {
        if (topLength > EPS)
          elements.push(physicalStud(wall, x,
            opening.id + '-cripple-top-layout-' + slug(x),
            'cripple-top', headerTop, topLength))
        if (opening.type === 'window' && bottomLength > EPS)
          elements.push(physicalStud(wall, x,
            opening.id + '-cripple-bottom-layout-' + slug(x),
            'cripple-bottom', sw, bottomLength))
      }
    }
  }
}
