import { planBounds, type FloorPlan, type PlanPoint } from './floor-plan'
import { validateGarageOpening } from './garage-door'
import type { Opening, ProjectDocument, ValidationIssue, Wall } from './project'

export interface PlanFrame {
  built: boolean
  openings: Opening[]
}

export const FRAME_SECTION = { width: 45, height: 145 } as const
const WALL_HEIGHT = 2700
const STUD_SPACING = 600
const DEPTH = FRAME_SECTION.height
export const MIN_FRAME_SIDE_MM = 2 * (DEPTH + FRAME_SECTION.width)

function sideFramingMm(opening: Opening): number {
  const count = opening.type === 'garage-door' ? opening.garage?.jackStudsPerSide ?? 2 : 1
  return (count + 1) * FRAME_SECTION.width
}

interface PlanFrameSide {
  wallId: string
  label: string
  start: PlanPoint
  end: PlanPoint
}

export function rectangularFrameSides(plan: FloorPlan): PlanFrameSide[] {
  if (!plan.closed || plan.exterior.length !== 4) return []
  const { minX, maxX, minZ, maxZ } = planBounds(plan.exterior)
  if (maxX - minX < MIN_FRAME_SIDE_MM || maxZ - minZ < MIN_FRAME_SIDE_MM) return []
  const corners = [
    { xMm: minX, zMm: maxZ }, { xMm: maxX, zMm: maxZ },
    { xMm: maxX, zMm: minZ }, { xMm: minX, zMm: minZ },
  ]
  if (!corners.every(corner => plan.exterior.some(point =>
    point.xMm === corner.xMm && point.zMm === corner.zMm))) return []
  const labels = ['Передняя (+Z)', 'Правая (+X)', 'Задняя (−Z)', 'Левая (−X)']
  return ['front', 'right', 'back', 'left'].map((name, index) => ({
    wallId: 'plan-' + name, label: labels[index],
    start: corners[index], end: corners[(index + 1) % 4],
  }))
}

export function planSidePoint(side: PlanFrameSide, offsetMm: number): PlanPoint {
  return {
    xMm: side.start.xMm + Math.sign(side.end.xMm - side.start.xMm) * offsetMm,
    zMm: side.start.zMm + Math.sign(side.end.zMm - side.start.zMm) * offsetMm,
  }
}

function sideLength(side: PlanFrameSide): number {
  return Math.abs(side.end.xMm - side.start.xMm) + Math.abs(side.end.zMm - side.start.zMm)
}

export function validatePlanFrame(plan: FloorPlan): ValidationIssue[] {
  const frame = plan.frame
  if (frame === undefined) return []
  const issues: ValidationIssue[] = []
  const fail = (messageRu: string, affectedIds: string[] = []) => {
    issues.push({ code: 'INVALID_PLAN_FRAME', severity: 'error',
      path: 'building.floorPlan.frame', messageRu, affectedIds })
  }
  if (!frame || typeof frame.built !== 'boolean' || !Array.isArray(frame.openings)) {
    fail('Повреждены параметры каркаса на плане')
    return issues
  }
  const sides = rectangularFrameSides(plan)
  if (!sides.length) {
    fail('Каркас этого этапа строится по замкнутому прямоугольнику из четырёх углов')
    return issues
  }
  if (plan.exteriorThicknessMm !== DEPTH) {
    fail('Для связанного каркаса установите толщину наружной стены 145 мм')
  }
  const ids = new Set<string>()
  for (const opening of frame.openings) {
    if (!opening || typeof opening.id !== 'string' || !opening.id || ids.has(opening.id)) {
      fail('Проёмы на плане должны иметь уникальные идентификаторы')
      continue
    }
    ids.add(opening.id)
    const side = sides.find(item => item.wallId === opening.wallId)
    const reject = (message: string) => fail(opening.id + ': ' + message, [opening.id, opening.wallId])
    if (!side || !['window', 'door', 'garage-door'].includes(opening.type) ||
      ![opening.positionUmm, opening.widthMm, opening.heightMm, opening.sillHeightMm].every(Number.isInteger)) {
      reject('укажите наружную стену, тип и целые размеры в мм')
      continue
    }
    if (opening.widthMm < 300 || opening.heightMm < 300 ||
      (opening.type === 'window' ? opening.sillHeightMm < 300 : opening.sillHeightMm !== 0)) {
      reject('недопустимая ширина, высота или отметка низа проёма')
      continue
    }
    // U is measured from the exterior corner. The panel starts one wall depth
    // later and the opposite end reserves the existing California backing.
    const margin = Math.max(135, sideFramingMm(opening) + FRAME_SECTION.width)
    const endReserve = DEPTH + FRAME_SECTION.width + sideFramingMm(opening)
    if (opening.positionUmm < DEPTH + margin ||
      opening.positionUmm + opening.widthMm > sideLength(side) - endReserve) {
      reject('проём не помещается между угловыми стойками выбранной стены')
    }
    const headerDepth = opening.type === 'garage-door' ? opening.garage?.lintelPreviewDepthMm ?? DEPTH : DEPTH
    if (opening.sillHeightMm + opening.heightMm + headerDepth > WALL_HEIGHT - 2 * FRAME_SECTION.width) {
      reject('недостаточно места по высоте для проёма и его перемычки')
    }
    for (const issue of validateGarageOpening({ ...opening, positionUmm: opening.positionUmm - DEPTH })) {
      reject(issue.messageRu)
    }
  }
  for (const side of sides) {
    const sorted = frame.openings.filter(opening => opening?.wallId === side.wallId)
      .sort((a, b) => a.positionUmm - b.positionUmm)
    sorted.slice(1).forEach((opening, index) => {
      const previous = sorted[index]
      const framingGap = Math.max(180, sideFramingMm(previous) + sideFramingMm(opening))
      if (previous.positionUmm + previous.widthMm + framingGap > opening.positionUmm) {
        fail(previous.id + ' и ' + opening.id + ': недостаточно места между проёмами',
          [previous.id, opening.id, side.wallId])
      }
    })
  }
  return issues
}

export function perimeterWallPairs(walls: readonly Wall[]): Array<[Wall, Wall]> {
  return walls.map((wall, index) => [wall, walls[(index + 1) % walls.length]])
}

export function projectPlanFrame(plan: FloorPlan, frame: PlanFrame):
  Pick<ProjectDocument['building'], 'walls' | 'openings' | 'connections'> {
  const openings = frame.openings.map(opening => ({ ...opening, positionUmm: opening.positionUmm - DEPTH }))
  const walls: Wall[] = rectangularFrameSides(plan).map((side, index) => {
    const origin = planSidePoint(side, DEPTH)
    return {
      wallId: side.wallId, origin: { x: origin.xMm, y: 0, z: origin.zMm },
      lengthMm: sideLength(side) - DEPTH, heightMm: WALL_HEIGHT,
      studSpacingMm: STUD_SPACING, thicknessMm: DEPTH, sectionMm: { ...FRAME_SECTION },
      orientation: index % 2 === 0 ? 'x' : 'z',
      ...(index >= 2 ? { reversed: true as const } : {}),
      openings: openings.filter(opening => opening.wallId === side.wallId).map(opening => opening.id),
    }
  })
  // Legacy connections are a directed editing chain. Rectangle joinery is
  // derived from consecutive perimeter sides, including the last-to-first corner.
  return { walls, openings, connections: [] }
}
