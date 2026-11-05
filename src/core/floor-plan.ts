/** SIGMA4 Plan V1: canonical 2D geometry, all source units in millimetres. */
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
  exterior: PlanPoint[]
  closed: boolean
  interiorWalls: PlanInteriorWall[]
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
  // Retained now for future T-junction topology: reject corrupt imports,
  // without pretending that interior wall editing already exists in V1.
  for (const [i, item] of plan.interiorWalls.entries()) {
    if (!item || typeof item.id !== 'string' || !item.id ||
      !item.start || !item.end ||
      !Number.isInteger(item.start.xMm) || !Number.isInteger(item.start.zMm) ||
      !Number.isInteger(item.end.xMm) || !Number.isInteger(item.end.zMm) ||
      !Number.isFinite(item.thicknessMm) || item.thicknessMm <= 0) {
      errors.push('Некорректная внутренняя стена ' + (i + 1))
    }
  }
  if (!plan.closed && plan.interiorWalls.length) errors.push('Внутренние стены требуют замкнутого контура')
  return Array.from(new Set(errors))
}

export function withPlanPoint(plan: FloorPlan, point: PlanPoint): FloorPlan {
  return { ...plan, exterior: [...plan.exterior, point] }
}
export function withPlanClosure(plan: FloorPlan): FloorPlan {
  return { ...plan, closed: true }
}
