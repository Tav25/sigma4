/** SIGMA4 2D authored plan; all source units in millimetres. */
import type { PlanFrame } from './plan-frame'
import { validatePlanGraph, graphView, type PlanGraph } from './plan-graph'
export interface PlanPoint {
  xMm: number
  zMm: number
}

/** A future interior wall can terminate at any exterior segment / other wall. */
export interface PlanInteriorWall {
  id: string
  start: PlanPoint
  end: PlanPoint
  thicknessMm: number
}
export interface FloorPlan {
  /** Thickness of external walls, measured inward from the exterior boundary. */
  exteriorThicknessMm?: number
  exterior: PlanPoint[]
  closed: boolean
  interiorWalls: PlanInteriorWall[]
  /** New canonical node/edge source. Legacy interiorWalls must be [] when graph exists. */
  graph?: PlanGraph
  frame?: PlanFrame
}

export const emptyFloorPlan = (): FloorPlan => ({
  exterior: [], closed: false, interiorWalls: [],
})
export const MIN_PLAN_EDGE_MM = 300
export const MAX_PLAN_POINTS = 32
export const PLAN_LIMIT_MM = 100000

export const samePlanPoint = (a: PlanPoint, b: PlanPoint) =>
  a.xMm === b.xMm && a.zMm === b.zMm

export const planDistanceMm = (a: PlanPoint, b: PlanPoint): number =>
  Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm)

export const planIsOrthogonal = (a: PlanPoint, b: PlanPoint) =>
  a.xMm === b.xMm || a.zMm === b.zMm

export const meters = (mm: number) => (mm / 1000).toLocaleString('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export const decimalMetersToMm = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.')
  if (!/^(?:\d+)(?:\.\d{1,3})?$/.test(normalized)) return null
  const mm = Math.round(Number(normalized) * 1000)
  return mm >= MIN_PLAN_EDGE_MM && mm <= PLAN_LIMIT_MM ? mm : null
}

function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b.xMm - a.xMm) * (c.zMm - a.zMm) -
    (b.zMm - a.zMm) * (c.xMm - a.xMm)
}
function between(a: number, b: number, p: number) {
  return Math.min(a, b) <= p && p <= Math.max(a, b)
}
function onSegment(a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  return cross(a, b, c) === 0 &&
    between(a.xMm, b.xMm, c.xMm) && between(a.zMm, b.zMm, c.zMm)
}
export function planSegmentsIntersect(a: PlanPoint, b: PlanPoint,
  c: PlanPoint, d: PlanPoint): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d)
  const cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b))
}

/** Shoelace polygon area in m²; zero for an open draft. */
export function planAreaM2(plan: FloorPlan): number {
  if (!plan.closed || plan.exterior.length < 3) return 0
  const nodes = plan.exterior
  let sum = 0
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length]
    sum += a.xMm * b.zMm - b.xMm * a.zMm
  }
  return Math.abs(sum) / 2e6
}
export function planPerimeterMm(plan: FloorPlan): number {
  const nodes = plan.exterior
  let length = 0
  for (let i = 1; i < nodes.length; i++) length += planDistanceMm(nodes[i - 1], nodes[i])
  if (plan.closed && nodes.length > 2) length += planDistanceMm(nodes[nodes.length - 1], nodes[0])
  return length
}
export function planBounds(points: PlanPoint[]) {
  if (!points.length) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  return { minX: Math.min(...points.map(p => p.xMm)),
    maxX: Math.max(...points.map(p => p.xMm)),
    minZ: Math.min(...points.map(p => p.zMm)),
    maxZ: Math.max(...points.map(p => p.zMm)) }
}

/**
 * Independent plan validator: called on every command, source check,
 * and JSON import. Invalid geometry never enters undo history.
 */
export function validateFloorPlan(raw: unknown): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['Неверная структура плана']
  const plan = raw as Partial<FloorPlan>
  if (!Array.isArray(plan.exterior) || !Array.isArray(plan.interiorWalls) ||
    typeof plan.closed !== 'boolean') return ['Неверная структура плана']
  if (plan.exteriorThicknessMm !== undefined &&
    (!Number.isInteger(plan.exteriorThicknessMm) || plan.exteriorThicknessMm < 50 || plan.exteriorThicknessMm > 500))
    errors.push('Толщина наружной стены должна быть целым числом от 50 до 500 мм')
  const nodes = plan.exterior
  if (nodes.length > MAX_PLAN_POINTS) errors.push('Слишком много точек наружного контура')
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]
    if (!p || !Number.isInteger(p.xMm) || !Number.isInteger(p.zMm) ||
      Math.abs(p.xMm) > PLAN_LIMIT_MM || Math.abs(p.zMm) > PLAN_LIMIT_MM) {
      errors.push('Координаты точки ' + (i + 1) + ' должны быть целыми миллиметрами в пределах 100 м')
    }
  }
  if (errors.length) return errors
  if (nodes.length && !samePlanPoint(nodes[0], { xMm: 0, zMm: 0 })) {
    errors.push('Первая точка наружного контура должна быть (0, 0)')
  }
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i]
    if (!planIsOrthogonal(a, b)) errors.push('Сегмент ' + i + ' должен быть под 90°')
    if (planDistanceMm(a, b) < MIN_PLAN_EDGE_MM) errors.push('Длина сегмента ' + i + ' меньше 0,30 м')
    if (i >= 2) {
      const previous = nodes[i - 2]
      const prevDx = a.xMm - previous.xMm
      const prevDz = a.zMm - previous.zMm
      const nextDx = b.xMm - a.xMm
      const nextDz = b.zMm - a.zMm
      if (prevDx * nextDx + prevDz * nextDz < 0 &&
        cross(previous, a, b) === 0) {
        errors.push('Сегменты не должны возвращаться по уже нарисованной стене')
      }
    }
  }
  const segments = nodes.slice(1).map((p, i) => [nodes[i], p] as const)
  if (plan.closed) {
    if (nodes.length < 4) errors.push('Для замкнутого периметра нужно минимум четыре угла')
    if (nodes.length >= 2) {
      const a = nodes[nodes.length - 1], b = nodes[0]
      if (!planIsOrthogonal(a, b)) errors.push('Последний участок не совпадает с осями — добавьте угол')
      if (planDistanceMm(a, b) < MIN_PLAN_EDGE_MM) errors.push('Замыкающий участок короче 0,30 м')
      segments.push([a, b])
    }
  }
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i]
    for (let j = i + 1; j < segments.length; j++) {
      const adjacent = j === i + 1 || (plan.closed && i === 0 && j === segments.length - 1)
      if (adjacent) continue
      const [c, d] = segments[j]
      if (planSegmentsIntersect(a, b, c, d)) {
        errors.push('Наружный контур не должен самопересекаться или касаться себя')
      }
    }
  }
  if (plan.closed && nodes.length >= 4 && planAreaM2(plan as FloorPlan) < 1) {
    errors.push('Площадь замкнутого контура должна быть не меньше 1 м²')
  }
  if (plan.graph) errors.push(...validatePlanGraph(plan as FloorPlan))
  else errors.push(...validateInteriorPlan(plan as FloorPlan))
  return Array.from(new Set(errors))
}

export function withPlanPoint(plan: FloorPlan, point: PlanPoint): FloorPlan {
  return { ...plan, exterior: [...plan.exterior, point] }
}
export function withPlanClosure(plan: FloorPlan): FloorPlan {
  return { ...plan, closed: true }
}


/** Wall centrelines and their derived junctions; the canonical JSON owns the segments. */
export interface PlanSegment { id: string; start: PlanPoint; end: PlanPoint; exterior: boolean }
export function planSegments(plan: FloorPlan): PlanSegment[] {
  const result: PlanSegment[] = []
  for (let i = 1; i < plan.exterior.length; i++) result.push({
    id: 'E' + i, start: plan.exterior[i - 1], end: plan.exterior[i], exterior: true,
  })
  if (plan.closed && plan.exterior.length > 2) result.push({
    id: 'E' + plan.exterior.length, start: plan.exterior[plan.exterior.length - 1],
    end: plan.exterior[0], exterior: true,
  })
  for (const w of (plan.graph ? graphView(plan).interiorWalls : plan.interiorWalls)) result.push({
    id: w.id, start: w.start, end: w.end, exterior: false,
  })
  return result
}
export const pointOnPlanSegment = (p: PlanPoint, a: PlanPoint, b: PlanPoint): boolean =>
  onSegment(a, b, p)

/** Axis-aligned intersection point; returns null for collinear segments. */
export function planAxisIntersection(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): PlanPoint | null {
  const verticalAB = a.xMm === b.xMm
  const verticalCD = c.xMm === d.xMm
  if (verticalAB === verticalCD) return null
  const p = verticalAB ? { xMm: a.xMm, zMm: c.zMm } : { xMm: c.xMm, zMm: a.zMm }
  return onSegment(a, b, p) && onSegment(c, d, p) ? p : null
}
function overlappingCollinear(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  if (a.xMm === b.xMm && c.xMm === d.xMm && a.xMm === c.xMm)
    return Math.min(Math.max(a.zMm, b.zMm), Math.max(c.zMm, d.zMm)) >
      Math.max(Math.min(a.zMm, b.zMm), Math.min(c.zMm, d.zMm))
  if (a.zMm === b.zMm && c.zMm === d.zMm && a.zMm === c.zMm)
    return Math.min(Math.max(a.xMm, b.xMm), Math.max(c.xMm, d.xMm)) >
      Math.max(Math.min(a.xMm, b.xMm), Math.min(c.xMm, d.xMm))
  return false
}
function planPointInside(p: PlanPoint, polygon: PlanPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if (onSegment(a, b, p)) return true
    if ((a.zMm > p.zMm) !== (b.zMm > p.zMm) &&
        p.xMm < (b.xMm - a.xMm) * (p.zMm - a.zMm) / (b.zMm - a.zMm) + a.xMm) inside = !inside
  }
  return inside
}

/** Snaps to real wall segments. The optional start enforces an orthogonal second endpoint. */
export function snapPlanAnchor(
  plan: FloorPlan, raw: PlanPoint, toleranceMm: number, stepMm = 250, start?: PlanPoint,
): PlanPoint | null {
  let best: PlanPoint | null = null
  let distance = toleranceMm
  for (const seg of planSegments(plan)) {
    const a = seg.start, b = seg.end
    const clamp = (value: number, left: number, right: number) =>
      Math.max(Math.min(left, right), Math.min(Math.max(left, right), value))
    let proposed: PlanPoint
    if (a.xMm === b.xMm) {
      const target = start && start.xMm !== a.xMm ? start.zMm
        : Math.round(raw.zMm / stepMm) * stepMm
      proposed = { xMm: a.xMm, zMm: clamp(target, a.zMm, b.zMm) }
    } else {
      const target = start && start.zMm !== a.zMm ? start.xMm
        : Math.round(raw.xMm / stepMm) * stepMm
      proposed = { xMm: clamp(target, a.xMm, b.xMm), zMm: a.zMm }
    }
    if (start && !planIsOrthogonal(start, proposed)) continue
    const d = planDistanceMm(raw, proposed)
    if (d <= distance) { distance = d; best = proposed }
  }
  return best
}

/** Crossings are logical joints, not duplicate authored walls. */
export function planInteriorJunctions(plan: FloorPlan): PlanPoint[] {
  const seen = new Map<string, PlanPoint>()
  const segs = plan.graph ? graphView(plan).interiorWalls : plan.interiorWalls
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = planAxisIntersection(segs[i].start, segs[i].end, segs[j].start, segs[j].end)
      if (p) seen.set(p.xMm + ':' + p.zMm, p)
    }
  }
  return [...seen.values()]
}
export function nextInteriorWallId(plan: FloorPlan): string {
  const ids = new Set((plan.graph ? plan.graph.edges : plan.interiorWalls).map(w => w.id))
  let n = 1
  while (ids.has('I' + String(n).padStart(3, '0'))) n++
  return 'I' + String(n).padStart(3, '0')
}

function validateInteriorPlan(plan: FloorPlan): string[] {
  const issues: string[] = []
  if (!plan.interiorWalls.length) return issues
  if (!plan.closed || plan.exterior.length < 4) return ['Внутренние стены требуют замкнутого периметра']
  if (plan.interiorWalls.length > 100) issues.push('Слишком много внутренних стен (максимум 100)')
  const ids = new Set<string>()
  const boundary = planSegments({ ...plan, interiorWalls: [] })
  for (const [index, wall] of plan.interiorWalls.entries()) {
    const label = 'Внутренняя стена ' + (index + 1)
    if (!wall || typeof wall.id !== 'string' || !wall.id.trim() ||
      !wall.start || !wall.end ||
      ![wall.start.xMm, wall.start.zMm, wall.end.xMm, wall.end.zMm].every(
        x => Number.isInteger(x) && Math.abs(x) <= PLAN_LIMIT_MM) ||
      !Number.isInteger(wall.thicknessMm) || wall.thicknessMm < 50 || wall.thicknessMm > 500) {
      issues.push(label + ': неправильный ID, координаты или толщина (50–500 мм)')
      continue
    }
    if (ids.has(wall.id)) issues.push('Повторяющийся ID внутренней стены: ' + wall.id)
    ids.add(wall.id)
    if (!planIsOrthogonal(wall.start, wall.end)) {
      issues.push(label + ': только горизонтальные и вертикальные стены')
      continue
    }
    if (planDistanceMm(wall.start, wall.end) < MIN_PLAN_EDGE_MM) {
      issues.push(label + ': длина меньше 0,30 м')
      continue
    }
    const midpoint = { xMm: (wall.start.xMm + wall.end.xMm) / 2,
      zMm: (wall.start.zMm + wall.end.zMm) / 2 }
    if (!planPointInside(midpoint, plan.exterior)) issues.push(label + ': стена вне периметра')
    for (const outer of boundary) {
      if (overlappingCollinear(wall.start, wall.end, outer.start, outer.end))
        issues.push(label + ': совпадает с наружной стеной')
      const crossPoint = planAxisIntersection(wall.start, wall.end, outer.start, outer.end)
      if (crossPoint && !samePlanPoint(crossPoint, wall.start) &&
        !samePlanPoint(crossPoint, wall.end))
        issues.push(label + ': пересекает наружный периметр')
    }
    for (const other of plan.interiorWalls) {
      if (other === wall || !other?.start || !other?.end) continue
      if (overlappingCollinear(wall.start, wall.end, other.start, other.end))
        issues.push(label + ': перекрывает другую внутреннюю стену')
    }
    for (const endpoint of [wall.start, wall.end]) {
      const connected = boundary.some(seg => onSegment(seg.start, seg.end, endpoint)) ||
        plan.interiorWalls.some(other => other !== wall && other?.start && other?.end &&
          planIsOrthogonal(other.start, other.end) &&
          onSegment(other.start, other.end, endpoint))
      if (!connected) issues.push(label + ': конец стены не привязан к другой стене')
    }
  }
  return [...new Set(issues)]
}


/** Width of an interior wall is measured around its centreline. */
export const DEFAULT_EXTERIOR_THICKNESS_MM = 150

/** Signed area in mm²; negative polygons follow clockwise screen-space winding. */
export function planSignedArea2(points: PlanPoint[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]
    return sum + p.xMm * q.zMm - q.xMm * p.zMm
  }, 0)
}

/** Visual outer-wall strips are generated inward from the immutable exterior boundary. */
export function exteriorWallStrips(plan: FloorPlan): PlanPoint[][] {
  if (!plan.closed || plan.exterior.length < 3) return []
  const t = plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM
  const side = planSignedArea2(plan.exterior) < 0 ? 1 : -1
  return plan.exterior.map((a, i) => {
    const b = plan.exterior[(i + 1) % plan.exterior.length]
    const length = planDistanceMm(a, b)
    if (!length) return [a, b]
    const dx = side * (b.zMm - a.zMm) * t / length
    const dz = side * (a.xMm - b.xMm) * t / length
    return [a, b, { xMm: b.xMm + dx, zMm: b.zMm + dz },
      { xMm: a.xMm + dx, zMm: a.zMm + dz }]
  })
}

export interface PlanClearance {
  axis: 'x' | 'z'
  scanMm: number
  coordinateMm: number
  negative: { referenceMm: number; distanceMm: number } | null
  positive: { referenceMm: number; distanceMm: number } | null
}

/**
 * Find real parallel segments intersecting the scanline through a selected
 * wall. Thus dimension chains stop at the nearest wall, not at an arbitrary
 * bounding rectangle (important for L-shaped footprints).
 */
export function planWallClearances(plan: FloorPlan, wallId: string): PlanClearance | null {
  const wall = (plan.graph ? graphView(plan).interiorWalls : plan.interiorWalls).find(w => w.id === wallId)
  if (!wall || !plan.closed || !planIsOrthogonal(wall.start, wall.end)) return null
  const axis: 'x' | 'z' = wall.start.xMm === wall.end.xMm ? 'x' : 'z'
  const parallel = axis === 'x'
  const coordinateMm = parallel ? wall.start.xMm : wall.start.zMm
  const scanMm = parallel ?
    (wall.start.zMm + wall.end.zMm) / 2 :
    (wall.start.xMm + wall.end.xMm) / 2
  const references = planSegments(plan).filter(seg => seg.id !== wallId)
    .filter(seg => parallel
      ? seg.start.xMm === seg.end.xMm &&
        scanMm >= Math.min(seg.start.zMm, seg.end.zMm) &&
        scanMm <= Math.max(seg.start.zMm, seg.end.zMm)
      : seg.start.zMm === seg.end.zMm &&
        scanMm >= Math.min(seg.start.xMm, seg.end.xMm) &&
        scanMm <= Math.max(seg.start.xMm, seg.end.xMm))
    .map(seg => parallel ? seg.start.xMm : seg.start.zMm)
  const smaller = references.filter(n => n < coordinateMm)
  const larger = references.filter(n => n > coordinateMm)
  const minus = smaller.length ? Math.max(...smaller) : null
  const plus = larger.length ? Math.min(...larger) : null
  return {
    axis, scanMm, coordinateMm,
    negative: minus === null ? null :
      { referenceMm: minus, distanceMm: coordinateMm - minus },
    positive: plus === null ? null :
      { referenceMm: plus, distanceMm: plus - coordinateMm },
  }
}

/**
 * Atomically move a wall along its perpendicular, carrying endpoints
 * attached to its former centreline. The returned plan is a candidate only:
 * callers MUST validate the complete geometry before committing to JSON.
 * Adjacent end points are moved, not whole perpendicular walls.
 */
export function moveInteriorWallWithDependents(
  plan: FloorPlan, wallId: string, offsetMm: number,
): FloorPlan | null {
  const target = plan.interiorWalls.find(w => w.id === wallId)
  if (!target || !Number.isInteger(offsetMm) || !planIsOrthogonal(target.start, target.end)) return null
  const vertical = target.start.xMm === target.end.xMm
  const moved = plan.interiorWalls.map(w => ({
    ...w, start: { ...w.start }, end: { ...w.end },
  }))
  const shifted = moved.find(w => w.id === wallId)!
  const update = (p: PlanPoint) => vertical
    ? { ...p, xMm: p.xMm + offsetMm }
    : { ...p, zMm: p.zMm + offsetMm }
  shifted.start = update(shifted.start)
  shifted.end = update(shifted.end)
  for (const wall of moved) {
    if (wall.id === wallId) continue
    if (pointOnPlanSegment(wall.start, target.start, target.end)) wall.start = update(wall.start)
    if (pointOnPlanSegment(wall.end, target.start, target.end)) wall.end = update(wall.end)
  }
  return { ...plan, interiorWalls: moved }
}

/** A dimension of the neighbouring bay edits the selected wall's position. */
export function moveWallToClearance(
  plan: FloorPlan, wallId: string, side: 'negative' | 'positive', desiredMm: number,
): FloorPlan | null {
  if (!Number.isInteger(desiredMm) || desiredMm < MIN_PLAN_EDGE_MM) return null
  const c = planWallClearances(plan, wallId)
  const reference = c?.[side]
  if (!c || !reference) return null
  const nextPosition = side === 'negative'
    ? reference.referenceMm + desiredMm
    : reference.referenceMm - desiredMm
  return moveInteriorWallWithDependents(plan, wallId, nextPosition - c.coordinateMm)
}
