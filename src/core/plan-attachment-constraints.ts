/**
 * S17: dimension/attachment constraints for the authored 2D wall graph.
 *
 * The JSON floor plan is authoritative. There are no hidden pin objects and
 * no edits to the derived 3D assembly. The existing shared graph node is the
 * single source of truth for T- and X-junction coordinates.
 */
import type { FloorPlan, PlanPoint } from './floor-plan'
import { planBounds } from './floor-plan'
import { planFrameOpeningSides, planSideLength, planSidePoint } from './plan-frame'
import { isPartitionWall, sideOffset } from './partition-layout'
import type { Opening } from './project'

export class PlanAttachmentConflict extends Error {
  constructor(messageRu: string) {
    super(messageRu)
    this.name = 'PlanAttachmentConflict'
  }
}

/**
 * Resizes a rectangle anchored at the authored (0,0) origin.
 * Nodes on the old far boundary move with THAT physical boundary; interior
 * nodes retain their original metric coordinates. Shared graph nodes move
 * exactly once, preserving the T/X connectivity without graph reconstruction.
 *
 * This intentionally does NOT scale rooms or arbitrary free points. Shrinking
 * past an interior wall is rejected by the existing full-plan validator.
 */
export function resizePlanWithBoundNodes(
  source: FloorPlan, widthMm: number, depthMm: number,
): FloorPlan {
  const old = planBounds(source.exterior)
  const farX = old.minX === 0 ? old.maxX : old.minX
  const farZ = old.minZ === 0 ? old.maxZ : old.minZ
  const newX = old.minX === 0 ? widthMm : -widthMm
  const newZ = old.minZ === 0 ? depthMm : -depthMm
  if (farX === 0 || farZ === 0)
    throw new PlanAttachmentConflict('Невозможно определить исходные границы наружного периметра')

  const move = (p: PlanPoint): PlanPoint => ({
    xMm: p.xMm === farX ? newX : p.xMm,
    zMm: p.zMm === farZ ? newZ : p.zMm,
  })
  const resized: FloorPlan = {
    ...source,
    exterior: source.exterior.map(move),
    interiorWalls: source.interiorWalls.map(wall => ({
      ...wall, start: move(wall.start), end: move(wall.end),
    })),
    ...(source.graph ? {
      graph: {
        nodes: source.graph.nodes.map(node => ({ ...node, ...move(node) })),
        edges: source.graph.edges.map(edge => ({ ...edge })),
      },
    } : {}),
  }
  return resized
}

export type AttachmentEdit = 'resize' | 'geometry' | 'topology'

/**
 * A door is attached to a wall, not to a screen pixel.
 *
 * - Building resize: retain its authored distance from the same wall START.
 *   It follows that end if the outer boundary itself moves.
 * - Wall point/axis edit: on an unchanged wall plane, preserve the existing
 *   world-space along-wall location when one of the two endpoints is adjusted.
 * - Graph split / crossing: if the old segment is divided, transfer the
 *   entire opening onto the piece that contains it; never straddle a node.
 *
 * No silently detached/relocated openings. Incompatible edits throw and the
 * ProjectStore rejects the COMPLETE command before committing the JSON.
 */
export function preservePlanOpeningAttachments(
  previous: FloorPlan, next: FloorPlan, edit: AttachmentEdit,
): FloorPlan {
  if (!previous.frame?.openings.length) return next
  const former = planFrameOpeningSides(previous, true)
  const current = planFrameOpeningSides(next, true)
  if (!former.length || !current.length)
    throw new PlanAttachmentConflict('Нельзя сохранить проёмы: отсутствует прямоугольный контур')

  const updated: Opening[] = previous.frame.openings.map(opening => {
    const old = former.find(side => side.wallId === opening.wallId)
    if (!old)
      throw new PlanAttachmentConflict('Проём ' + opening.id + ' привязан к отсутствующей стене ' + opening.wallId)
    const direct = current.find(side => side.wallId === opening.wallId)
    if (!isPartitionWall(opening.wallId)) {
      if (!direct)
        throw new PlanAttachmentConflict('Наружная стена с проёмом ' + opening.id + ' отсутствует')
      // Fixed relative to the authored outside wall start, not the midpoint.
      return { ...opening }
    }

    const anchor = planSidePoint(old, opening.positionUmm)
    const orientationX = old.start.zMm === old.end.zMm
    const compatible = (side: typeof old, requireSameLine: boolean) => {
      const isX = side.start.zMm === side.end.zMm
      if (orientationX !== isX) return false
      if (requireSameLine &&
        (orientationX ? old.start.zMm !== side.start.zMm :
          old.start.xMm !== side.start.xMm)) return false
      return true
    }
    // In a resize a door remains at its local start offset. This is a
    // constraint to the boundary end; after a move of a dependent branch
    // the door instead retains its old along-wall position.
    if (edit === 'resize' && direct && compatible(direct, false))
      return { ...opening }

    const candidates = current
      .filter(side => isPartitionWall(side.wallId))
      .filter(side => compatible(side, side.wallId !== opening.wallId))
      .map(side => ({
        side,
        offset: sideOffset(side, anchor),
        preference: side.wallId === opening.wallId ? 0 : 1,
      }))
      .filter(({ side, offset }) =>
        Number.isInteger(offset) && offset >= 0 &&
        offset + opening.widthMm <= planSideLength(side))
      .sort((a, b) => a.preference - b.preference ||
        a.side.wallId.localeCompare(b.side.wallId))

    // No suitable segment: the revised T/crossing node cuts the opening,
    // the wall has been deleted, or its remaining segment is too short.
    if (!candidates.length)
      throw new PlanAttachmentConflict('Проём ' + opening.id + ' больше не помещается на своей стене: ' +
        'переместите проём или измените геометрию стены')
    const chosen = candidates[0]
    if (direct && !compatible(direct, false))
      throw new PlanAttachmentConflict('Проём ' + opening.id + ' нельзя автоматически повернуть на другую ось')
    // Keeping an ID refers to an unchanged canonical edge; a different ID
    // refers to the other half of the SAME old physical line after splitting.
    return {
      ...opening,
      wallId: chosen.side.wallId,
      positionUmm: chosen.offset,
    }
  })
  if (updated.every((o, i) => o.wallId === previous.frame!.openings[i].wallId &&
    o.positionUmm === previous.frame!.openings[i].positionUmm))
    return next

  return {
    ...next,
    frame: { ...next.frame!, openings: updated },
  }
}

/** Number of shared T-/X-junction nodes, independent of rendering. */
export function graphSharedJunctionCount(plan: FloorPlan): number {
  const graph = plan.graph
  if (!graph) return 0
  return graph.nodes.filter(node => graph.edges.filter(edge =>
    edge.a === node.id || edge.b === node.id).length >= 3).length
}
