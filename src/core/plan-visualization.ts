/** Display-only metric geometry for the SIGMA4 2D viewport. */
import type { PlanPoint } from './floor-plan'
import type { FloorRoom } from './rooms'

type Point = { x: number; y: number }

/** Outward normal for each directed edge of a simple, closed orthogonal polygon.
 * Unlike a bounding-box-centre heuristic this also works at concave corners.
 */
export function exteriorDimensionNormal(exterior: readonly PlanPoint[], index: number): Point {
  if (exterior.length < 3 || index < 0 || index >= exterior.length) return { x: 0, y: 0 }
  const a = exterior[index], b = exterior[(index + 1) % exterior.length]
  const dx = b.xMm - a.xMm, dz = b.zMm - a.zMm
  const length = Math.hypot(dx, dz)
  if (!length) return { x: 0, y: 0 }
  let signedTwiceArea = 0
  for (let i = 0; i < exterior.length; i++) {
    const p = exterior[i], q = exterior[(i + 1) % exterior.length]
    signedTwiceArea += p.xMm * q.zMm - q.xMm * p.zMm
  }
  const outside = signedTwiceArea >= 0 ? -1 : 1
  return { x: -dz / length * outside, y: dx / length * outside }
}

export function planGridMetrics(pxPerMetre: number, snapMm: number) {
  const minorPx = pxPerMetre * snapMm / 1000
  return { minorPx, majorPx: pxPerMetre, showMinor: snapMm < 1000 && minorPx >= 5 }
}

/** Keep the world-space point below the cursor fixed across zoom changes. */
export function zoomPlanAround(
  zoom: number, pan: Point, anchor: Point, factor: number,
  basePxPerMetre: number, offset: Point,
): { zoom: number; pan: Point } {
  const nextZoom = Math.min(2.8, Math.max(0.32, zoom * factor))
  const ratio = nextZoom / zoom
  return {
    zoom: nextZoom,
    pan: {
      x: anchor.x - offset.x - (anchor.x - offset.x - pan.x) * ratio,
      y: anchor.y - offset.y - (anchor.y - offset.y - pan.y) * ratio,
    },
  }
}

/** Avoid placing a fixed-size label on top of a narrow room or wall. */
export function roomLabelKind(room: FloorRoom, pxPerMetre: number): 'full' | 'compact' | 'marker' {
  const cell = room.rectangles.filter(r =>
    room.center.xMm >= r.minXmm && room.center.xMm <= r.maxXmm &&
    room.center.zMm >= r.minZmm && room.center.zMm <= r.maxZmm,
  ).sort((a, b) =>
    (b.maxXmm - b.minXmm) * (b.maxZmm - b.minZmm) -
    (a.maxXmm - a.minXmm) * (a.maxZmm - a.minZmm))[0]
  if (!cell) return 'marker'
  const widthPx = (cell.maxXmm - cell.minXmm) * pxPerMetre / 1000
  const heightPx = (cell.maxZmm - cell.minZmm) * pxPerMetre / 1000
  if (widthPx >= 128 && heightPx >= 70) return 'full'
  if (widthPx >= 94 && heightPx >= 40) return 'compact'
  return 'marker'
}
