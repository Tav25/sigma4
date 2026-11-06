import { planBounds, type FloorPlan, type PlanPoint } from './floor-plan'
import { PARTITION_MIN_DEPTH, isPartitionWall, partitionAttachments, partitionInside, partitionSides, sideOffset, type PartitionHost, type PartitionSide } from './partition-layout'
import { physicalPartitionRuns } from './structural-runs'
import { defaultGarageDoorSpec, GARAGE_DOOR_PRESETS, validateGarageOpening } from './garage-door'
import { validateOpeningHeaderInputs, headerProfile } from './opening-profiles'
import type { Opening, ProjectDocument, ValidationIssue, Wall } from './project'

export interface PlanFrame {
  built: boolean
  partitions?: true
  openings: Opening[]
}

export const FRAME_SECTION = { width: 45, height: 145 } as const
const WALL_HEIGHT = 2700
const STUD_SPACING = 600
// IRC 2024 R602.7.4, for the flat head in the nonbearing profile.
const PARTITION_MAX_OPENING_MM = 2438
const PARTITION_MAX_HEAD_GAP_MM = 610
const DEPTH = FRAME_SECTION.height
export const MIN_FRAME_SIDE_MM = 2 * (DEPTH + FRAME_SECTION.width)

function sideFramingMm(opening: Opening): number {
  const count = opening.type === 'garage-door' ? opening.garage?.jackStudsPerSide ?? 2 :
    opening.headerPreview?.jackStudsPerSide ?? 1
  return (count + 1) * FRAME_SECTION.width
}

interface ExteriorFrameSide extends PartitionHost {
  wallId: string
  label: string
  start: PlanPoint
  end: PlanPoint
  insetMm: number
}

export type PlanFrameSide = ExteriorFrameSide | PartitionSide

export function rectangularFrameSides(plan: FloorPlan): ExteriorFrameSide[] {
  if (!plan.closed || plan.exterior.length !== 4) return []
  const { minX, maxX, minZ, maxZ } = planBounds(plan.exterior)
  if (maxX - minX < MIN_FRAME_SIDE_MM || maxZ - minZ < MIN_FRAME_SIDE_MM) return []
  const corners = [
    { xMm: minX, zMm: maxZ }, { xMm: maxX, zMm: maxZ },
    { xMm: maxX, zMm: minZ }, { xMm: minX, zMm: minZ },
  ]
  if (!corners.every(corner => plan.exterior.some(point =>
    point.xMm === corner.xMm && point.zMm === corner.zMm))) return []
  const throughAlongX = maxX - minX >= maxZ - minZ
  const labels = ['Передняя (+Z)', 'Правая (+X)', 'Задняя (−Z)', 'Левая (−X)']
  return ['front', 'right', 'back', 'left'].map((name, index) => ({
    wallId: 'plan-' + name, label: labels[index],
    start: corners[index], end: corners[(index + 1) % 4],
    insetMm: (index % 2 === 0) === throughAlongX ? 0 : DEPTH,
  }))
}

export function planSidePoint(side: PartitionHost, offsetMm: number): PlanPoint {
  return {
    xMm: side.start.xMm + Math.sign(side.end.xMm - side.start.xMm) * offsetMm,
    zMm: side.start.zMm + Math.sign(side.end.zMm - side.start.zMm) * offsetMm,
  }
}

export function planSideLength(side: PartitionHost): number {
  return Math.abs(side.end.xMm - side.start.xMm) + Math.abs(side.end.zMm - side.start.zMm)
}

export function planFrameOpeningSides(plan: FloorPlan, includeDraftPartitions = false): PlanFrameSide[] {
  const exterior = rectangularFrameSides(plan)
  if (!exterior.length) return []
  return [...exterior, ...(plan.frame?.partitions || includeDraftPartitions ? partitionSides(plan, exterior, DEPTH) : [])]
}

/**
 * The editing graph keeps every T node as an individually selectable edge.
 * Only the built 3D frame uses physical through-runs; no canonical graph
 * node, segment or opening reference is modified.
 */
export function planStructuralFrameSides(plan: FloorPlan): PlanFrameSide[] {
  const exterior=rectangularFrameSides(plan)
  if (!exterior.length) return []
  if (!plan.frame?.partitions) return exterior
  const runs=physicalPartitionRuns(plan)
  const physical:FloorPlan={...plan,graph:undefined,interiorWalls:runs.walls}
  return [...exterior,...partitionSides(physical,exterior,DEPTH)]
}

export const PLAN_OPENING_PRESETS = [
  { value: 'window', label: 'Окно', prefix: 'W', widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
  { value: 'door', label: 'Дверь', prefix: 'D', widthMm: 900, heightMm: 2100, sillHeightMm: 0 },
  { value: 'garage-door', prefix: 'G', ...GARAGE_DOOR_PRESETS[0], label: 'Ворота', sillHeightMm: 0 },
] as const

export function nextPlanOpeningId(openings: readonly Opening[], type: Opening['type']): string {
  const prefix = PLAN_OPENING_PRESETS.find(preset => preset.value === type)!.prefix
  let next = 1
  while (openings.some(opening => opening.id === prefix + String(next).padStart(2, '0'))) next++
  return prefix + String(next).padStart(2, '0')
}

export function planOpeningPreset(type: Opening['type'], wallId: string, id: string): Opening {
  const { widthMm, heightMm, sillHeightMm } = PLAN_OPENING_PRESETS.find(preset => preset.value === type)!
  return { id, wallId, type, positionUmm: 0, widthMm, heightMm, sillHeightMm,
    ...(type === 'garage-door' ? { garage: defaultGarageDoorSpec() } : {}) }
}

/** One authored edit shared by the pointer preview and the store. */
export function withPlanOpening(plan: FloorPlan, opening: Opening): FloorPlan {
  const frame = plan.frame ?? { built: false, openings: [] }
  const openings = [...frame.openings]
  const index = openings.findIndex(item => item.id === opening.id)
  if (index < 0) openings.push(opening)
  else openings[index] = opening
  return {
    ...plan, exteriorThicknessMm: plan.exteriorThicknessMm ?? DEPTH,
    frame: { ...frame, openings, ...(isPartitionWall(opening.wallId) ? { partitions: true } : {}) },
  }
}

export function validatePlanFrame(plan: FloorPlan): ValidationIssue[] {
  const frame = plan.frame
  if (frame === undefined) return []
  const issues: ValidationIssue[] = []
  const fail = (messageRu: string, affectedIds: string[] = []) => {
    issues.push({ code: 'INVALID_PLAN_FRAME', severity: 'error',
      path: 'building.floorPlan.frame', messageRu, affectedIds })
  }
  if (!frame || typeof frame.built !== 'boolean' || !Array.isArray(frame.openings) ||
    (frame.partitions !== undefined && frame.partitions !== true)) {
    fail('Повреждены параметры каркаса на плане')
    return issues
  }
  const exterior = rectangularFrameSides(plan)
  if (!exterior.length) {
    fail('Каркас этого этапа строится по замкнутому прямоугольнику из четырёх углов')
    return issues
  }
  if (plan.exteriorThicknessMm !== DEPTH) {
    fail('Для связанного каркаса установите толщину наружной стены 145 мм')
  }
  const partitions = frame.partitions ? partitionSides(plan, exterior, DEPTH) : []
  const sides: PlanFrameSide[] = [...exterior, ...partitions]
  for (const partition of partitions) {
    const length = planSideLength(partition) - partition.insetMm - partition.endInsetMm
    if (partition.thicknessMm < PARTITION_MIN_DEPTH || length < 2 * FRAME_SECTION.width ||
      !partitionInside(plan, partition, DEPTH)) {
      fail(partition.label + ': проверьте положение и толщину каркаса от 89 мм', [partition.wallId])
    }
    for (const { host, positionUmm } of partitionAttachments(partition)) {
      const exteriorHost = exterior.some(side => side.wallId === host.wallId)
      const reserve = (exteriorHost ? DEPTH : 0) + FRAME_SECTION.width + partition.thicknessMm / 2
      // A graph-created T or X junction is exactly at the end of TWO
      // collinear source segments. It is NOT a physical unsupported wall end.
      // The neighbouring segment supplies the other half of the through wall.
      const hostLength = planSideLength(host)
      const p = planSidePoint(host, positionUmm)
      const isCollinearContinuation = !exteriorHost &&
        (positionUmm === 0 || positionUmm === hostLength) &&
        partitions.some(other => other.wallId !== host.wallId &&
          (other.start.zMm === other.end.zMm) === (host.start.zMm === host.end.zMm) &&
          ((other.start.xMm === p.xMm && other.start.zMm === p.zMm) ||
           (other.end.xMm === p.xMm && other.end.zMm === p.zMm)))
      if (!isCollinearContinuation &&
        (positionUmm < reserve || positionUmm > hostLength - reserve)) {
        fail(partition.label + ': примыкание слишком близко к углу', [partition.wallId, host.wallId])
      }
      for (const opening of frame.openings) {
        if (opening?.wallId !== host.wallId) continue
        const margin = partition.thicknessMm / 2 + sideFramingMm(opening)
        if (positionUmm > opening.positionUmm - margin && positionUmm < opening.positionUmm + opening.widthMm + margin) {
          fail(partition.label + ': примыкание пересекает проём ' + opening.id, [partition.wallId, opening.id])
        }
      }
    }
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
    for (const issue of validateOpeningHeaderInputs(opening,!!side && 'endInsetMm' in side)) {
      fail(issue.messageRu,issue.affectedIds)
    }
    if (!side || !['window', 'door', 'garage-door'].includes(opening.type) ||
      ![opening.positionUmm, opening.widthMm, opening.heightMm, opening.sillHeightMm].every(Number.isInteger)) {
      reject('укажите стену, тип и целые размеры в мм')
      continue
    }
    if (opening.swing !== undefined && (opening.type !== 'door' || !opening.swing ||
      !['start', 'end'].includes(opening.swing.hinge) || !['left', 'right'].includes(opening.swing.side))) {
      reject('укажите корректную сторону петель и открывания двери')
    }
    if (opening.widthMm < 300 || opening.heightMm < 300 ||
      (opening.type === 'window' ? opening.sillHeightMm < 300 : opening.sillHeightMm !== 0)) {
      reject('недопустимая ширина, высота или отметка низа проёма')
      continue
    }
    if ('endInsetMm' in side) {
      const panelU = opening.positionUmm - side.insetMm
      if (opening.type !== 'door' || opening.garage || opening.sillHeightMm !== 0 ||
        panelU < 2 * FRAME_SECTION.width ||
        opening.positionUmm + opening.widthMm > planSideLength(side) - side.endInsetMm - 2 * FRAME_SECTION.width ||
        opening.heightMm > WALL_HEIGHT - 2 * FRAME_SECTION.width) {
        reject('дверь не помещается в ненесущую перегородку')
      }
      const headGap = WALL_HEIGHT - 2 * FRAME_SECTION.width - opening.heightMm
      if (opening.widthMm > PARTITION_MAX_OPENING_MM || headGap > PARTITION_MAX_HEAD_GAP_MM) {
        reject('для плоской перемычки IRC ширина проёма до 2438 мм, зазор над перемычкой до 610 мм')
      }
      continue
    }
    // U is authored from the outer corner, even when the panel is inset.
    // Through walls reserve backing at both ends. Inset walls reserve their
    // end studs as well as the depth of the perpendicular wall.
    const framing = sideFramingMm(opening) + FRAME_SECTION.width
    const margin = side.insetMm
      ? side.insetMm + Math.max(135, framing)
      : Math.max(135, DEPTH + framing)
    if (opening.positionUmm < margin ||
      opening.positionUmm + opening.widthMm > planSideLength(side) - margin) {
      reject('проём не помещается между угловыми стойками выбранной стены')
    }
    const headerDepth = headerProfile(opening,{
      wallId:side.wallId,sectionMm:FRAME_SECTION,
    }).depthMm
    if (opening.sillHeightMm + opening.heightMm + headerDepth > WALL_HEIGHT - 2 * FRAME_SECTION.width) {
      reject('недостаточно места по высоте для проёма и его перемычки')
    }
    for (const issue of validateGarageOpening({ ...opening, positionUmm: opening.positionUmm - side.insetMm })) {
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

export interface PerimeterCorner {
  through: Wall
  inset: Wall
  throughStart: boolean
}

export function perimeterCorners(walls: readonly Wall[]): PerimeterCorner[] {
  if (walls.length < 4) return []
  walls = walls.slice(0, 4)
  // Full-span panels are longer than the inset pair, including square plans.
  const throughAlongX = walls[0].lengthMm > walls[1].lengthMm
  return walls.map((wall, index) => {
    const next = walls[(index + 1) % walls.length]
    const wallIsThrough = (wall.orientation === 'x') === throughAlongX
    return wallIsThrough
      ? { through: wall, inset: next, throughStart: false }
      : { through: next, inset: wall, throughStart: true }
  })
}

export function projectPlanFrame(plan: FloorPlan, frame: PlanFrame):
  Pick<ProjectDocument['building'], 'walls' | 'openings' | 'connections'> {
  const authoredSides = planFrameOpeningSides(plan)
  const sides = planStructuralFrameSides(plan)
  const owners=physicalPartitionRuns(plan).ownerBySegment
  const openings = frame.openings.map(opening => {
    const authored=authoredSides.find(item=>item.wallId===opening.wallId)
    if(!authored)throw Error('Неизвестная стена проёма '+opening.id)
    const owner=isPartitionWall(opening.wallId)
      ? 'partition-'+(owners.get(opening.wallId.slice('partition-'.length)) ??
          opening.wallId.slice('partition-'.length))
      : opening.wallId
    const physical=sides.find(item=>item.wallId===owner)
    if(!physical)throw Error('Не найдена конструктивная стена проёма '+opening.id)
    const absolute=planSidePoint(authored,opening.positionUmm)
    const u=sideOffset(physical,absolute)-physical.insetMm
    if(u<0||u+opening.widthMm>planSideLength(physical)-physical.insetMm-
        ('endInsetMm' in physical?physical.endInsetMm:physical.insetMm))
      throw Error('Проём '+opening.id+' вышел за пределы конструктивной стены')
    return {...opening,wallId:owner,positionUmm:u}
  })
  const walls: Wall[] = sides.map(side => {
    const origin = planSidePoint(side, side.insetMm)
    const partition = 'endInsetMm' in side
    const orientation = side.start.zMm === side.end.zMm ? 'x' : 'z'
    const reversed = orientation === 'x' ? side.end.xMm < side.start.xMm : side.end.zMm > side.start.zMm
    const thickness = partition ? side.thicknessMm : DEPTH
    const half = partition ? thickness / 2 : 0
    return {
      wallId: side.wallId,
      origin: { x: origin.xMm + (orientation === 'z' ? (reversed ? -half : half) : 0), y: 0,
        z: origin.zMm + (orientation === 'x' ? (reversed ? -half : half) : 0) },
      lengthMm: planSideLength(side) - side.insetMm - (partition ? side.endInsetMm : side.insetMm),
      heightMm: WALL_HEIGHT, studSpacingMm: partition ? 400 : STUD_SPACING, thicknessMm: thickness,
      sectionMm: { ...FRAME_SECTION, height: thickness }, orientation,
      ...(reversed ? { reversed: true as const } : {}),
      openings: openings.filter(opening => opening.wallId === side.wallId).map(opening => opening.id),
    }
  })
  // Legacy connections are a directed editing chain. Rectangle joinery is
  // derived from consecutive perimeter sides, including the last-to-first corner.
  return { walls, openings, connections: [] }
}
