import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommandResult, ProjectCommand } from '../core/ProjectStore'
import type { FloorPlan, PlanPoint } from '../core/floor-plan'
import {
  nextPlanOpeningId, planFrameOpeningSides, planOpeningPreset, planSideLength,
  validatePlanFrame, withPlanOpening, type PlanFrameSide,
} from '../core/plan-frame'
import { sideOffset } from '../core/partition-layout'
import type { DoorSwing, Opening } from '../core/project'

const NO_OPENINGS: Opening[] = []
export const DEFAULT_DOOR_SWING: DoorSwing = { hinge: 'start', side: 'left' }

interface OpeningDraft {
  opening: Opening
  error: string
}
interface OpeningDrag {
  pointerId: number
  opening: Opening
  anchorU: number
  clientX: number
  clientY: number
  lastValid: number
  moved: boolean
}

export function usePlanOpenings(plan: FloorPlan, onCommand: (command: ProjectCommand) => CommandResult) {
  const sides = useMemo(() => planFrameOpeningSides(plan, true), [plan])
  const openings = plan.frame?.openings ?? NO_OPENINGS
  const [wallPick, setWallPick] = useState<{ wallId: string; offsetMm: number } | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [placement, setPlacement] = useState<Opening | null>(null)
  const [preview, setPreview] = useState<OpeningDraft | null>(null)
  const [message, setMessage] = useState('')
  const drag = useRef<OpeningDrag | null>(null)
  const checked = useRef<{ plan: FloorPlan; source: Opening; result: OpeningDraft } | null>(null)
  const selectedOpening = openings.find(item => item.id === openingId)
  const selectedWall = sides.find(side => side.wallId === (selectedOpening?.wallId ?? wallPick?.wallId))
  const placementWall = sides.find(side => side.wallId === placement?.wallId)

  // Import, undo and other committed changes invalidate an in-flight pointer edit.
  useEffect(() => {
    drag.current = null
    checked.current = null
    setPlacement(null)
    setPreview(null)
  }, [plan])

  const apply = (command: ProjectCommand) => {
    const result = onCommand(command)
    setMessage(result.success ? '' : result.messageRu || 'Операция недоступна')
    return result.success
  }

  const move = (opening: Opening, positionUmm: number) => positionUmm === opening.positionUmm ||
    apply({ type: 'PLAN_FRAME_MOVE_OPENING', payload: { openingId: opening.id, positionUmm } })

  const cancel = () => {
    const pointerId = drag.current?.pointerId
    drag.current = null
    setPlacement(null)
    setPreview(null)
    setMessage('')
    return pointerId
  }
  const clearSelection = () => {
    cancel()
    setOpeningId(null)
    setWallPick(null)
  }
  const selectWall = (side: PlanFrameSide | undefined, offsetMm: number) => {
    clearSelection()
    if (side) setWallPick({ wallId: side.wallId, offsetMm })
  }
  const selectOpening = (opening: Opening) => {
    setMessage('')
    setWallPick({ wallId: opening.wallId, offsetMm: opening.positionUmm + opening.widthMm / 2 })
    setOpeningId(opening.id)
  }
  const showPosition = (source: Opening, positionUmm: number) => {
    const last = checked.current
    if (last?.plan === plan && last.source === source && last.result.opening.positionUmm === positionUmm) {
      setPreview(last.result)
      return last.result
    }
    const opening = { ...source, positionUmm }
    const issues = validatePlanFrame(withPlanOpening(plan, opening))
    const error = issues.find(issue => issue.affectedIds.includes(opening.id))?.messageRu ?? issues[0]?.messageRu ?? ''
    const result = { opening, error }
    checked.current = { plan, source, result }
    setPreview(result)
    return result
  }
  const clampPosition = (side: PlanFrameSide, opening: Opening, value: number) =>
    Math.max(0, Math.min(planSideLength(side) - opening.widthMm, value))

  const startPlacement = (type: Opening['type']) => {
    if (!selectedWall || !wallPick) return
    const opening = planOpeningPreset(type, selectedWall.wallId, nextPlanOpeningId(openings, type))
    const center = wallPick.offsetMm - opening.widthMm / 2
    setOpeningId(null)
    setMessage('')
    setPlacement(opening)
    showPosition(opening, clampPosition(selectedWall, opening, Math.round(center / 100) * 100))
  }
  const positionPlacement = (point: PlanPoint, step: number) => {
    if (!placement || !placementWall) return null
    const center = sideOffset(placementWall, point) - placement.widthMm / 2
    return showPosition(placement, clampPosition(placementWall, placement, Math.round(center / step) * step))
  }
  const confirmPlacement = (draft = preview) => {
    if (!draft || draft.error) return
    if (apply({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: draft.opening } })) {
      setPlacement(null)
      setPreview(null)
      selectOpening(draft.opening)
    }
  }

  const beginDrag = (opening: Opening, point: PlanPoint, event: { pointerId: number; clientX: number; clientY: number }) => {
    if (drag.current) return false
    const side = sides.find(item => item.wallId === opening.wallId)
    if (!side) return false
    selectOpening(opening)
    checked.current = null
    drag.current = { pointerId: event.pointerId, opening, anchorU: sideOffset(side, point),
      clientX: event.clientX, clientY: event.clientY, lastValid: opening.positionUmm, moved: false }
    return true
  }
  const updateDrag = (event: { pointerId: number; clientX: number; clientY: number }, point: PlanPoint, step: number) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return false
    if (!active.moved && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) < 4) return true
    active.moved = true
    const side = sides.find(item => item.wallId === active.opening.wallId)
    if (side) {
      const delta = sideOffset(side, point) - active.anchorU
      const position = clampPosition(side, active.opening, active.opening.positionUmm + Math.round(delta / step) * step)
      if (!showPosition(active.opening, position).error) active.lastValid = position
    }
    return true
  }
  const finishDrag = (pointerId: number, cancelled: boolean) => {
    const active = drag.current
    if (!active || active.pointerId !== pointerId) return false
    drag.current = null
    setPreview(null)
    if (!cancelled && active.moved) {
      const invalid = checked.current?.result.error
      if (move(active.opening, active.lastValid) && invalid) {
        setMessage(active.lastValid === active.opening.positionUmm
          ? invalid : 'Проём оставлен в последнем допустимом положении.')
      }
    }
    return true
  }

  return {
    sides, openings, wallPick, selectedWall, selectedOpening, placement, placementWall, preview, message,
    lastValidPosition: drag.current?.lastValid,
    cancel, clearSelection, selectWall, selectOpening, startPlacement, positionPlacement,
    place: (point: PlanPoint, step: number) => confirmPlacement(positionPlacement(point, step)),
    confirmPlacement,
    nudgePlacement: (delta: number) => {
      if (placement && placementWall) {
        const position = (preview?.opening.positionUmm ?? 0) + delta
        showPosition(placement, clampPosition(placementWall, placement, position))
      }
    },
    hidePlacementPreview: () => { if (placement) setPreview(null) },
    isDragging: () => drag.current !== null, beginDrag, updateDrag, finishDrag, move,
    save: (opening: Opening) => apply({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening } }),
    remove: (opening: Opening) => {
      if (apply({ type: 'PLAN_FRAME_REMOVE_OPENING', payload: { openingId: opening.id } })) setOpeningId(null)
    },
  }
}
