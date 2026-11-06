import { useEffect, useState, type MouseEvent, type PointerEvent } from 'react'
import { FRAME_SECTION, planSideLength, planSidePoint, type PlanFrameSide } from '../core/plan-frame'
import type { PlanPoint } from '../core/floor-plan'
import type { Opening } from '../core/project'
import { DEFAULT_DOOR_SWING } from './usePlanOpenings'

export type PlanToSvg = (point: PlanPoint) => { x: number; y: number }
export type OpeningDimension = 'start' | 'width' | 'end'

export function openingMetres(mm: number) {
  return (mm / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false })
}

export function parseOpeningDimension(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const mm = Math.round(Number(normalized) * 1000)
  return mm <= 100000 ? mm : null
}

interface DrawingProps {
  opening: Opening
  side: PlanFrameSide
  xy: PlanToSvg
  pxPerMm: number
}

function axis({ side, xy, pxPerMm }: Omit<DrawingProps, 'opening'>) {
  const origin = xy(side.start)
  const tx = Math.sign(side.end.xMm - side.start.xMm)
  const ty = Math.sign(side.end.zMm - side.start.zMm)
  const depth = ('thicknessMm' in side ? side.thicknessMm : FRAME_SECTION.height) * pxPerMm
  const shift = 'thicknessMm' in side ? 0 : -depth / 2
  const at = (along: number, normal = 0) => ({
    x: origin.x + tx * along - ty * (normal + shift),
    y: origin.y + ty * along + tx * (normal + shift),
  })
  const transform = (along: number) => {
    const { x, y } = at(along)
    return `translate(${x} ${y}) rotate(${Math.atan2(ty, tx) * 180 / Math.PI})`
  }
  return { at, depth, transform }
}

export function OpeningCut({ opening, side, xy, pxPerMm }: DrawingProps) {
  const { depth, transform } = axis({ side, xy, pxPerMm })
  return <rect transform={transform(opening.positionUmm * pxPerMm)} x={0} y={-depth / 2 - 4}
    width={opening.widthMm * pxPerMm} height={depth + 8} fill="black" />
}

interface SymbolProps extends DrawingProps {
  selected?: boolean
  preview?: boolean
  invalid?: boolean
  conflict?: boolean
  muted?: boolean
  onSelect?: (event?: MouseEvent<SVGGElement>) => void
  onDrag?: (event: PointerEvent<SVGGElement>) => void
}

export function PlanOpeningSymbol({
  opening, side, xy, pxPerMm, selected, preview, invalid, conflict, muted, onSelect, onDrag,
}: SymbolProps) {
  const { at, depth, transform } = axis({ side, xy, pxPerMm })
  const width = opening.widthMm * pxPerMm
  const offset = opening.positionUmm * pxPerMm
  const swing = opening.swing ?? DEFAULT_DOOR_SWING
  const hinge = swing.hinge === 'start' ? 0 : width
  const latch = width - hinge
  const direction = swing.side === 'left' ? -1 : 1
  const sweep = (swing.hinge === 'start' ? direction : -direction) > 0 ? 1 : 0
  const label = at(offset + width / 2, -(depth / 2 + 10))
  const title = { window: 'Окно', door: 'Дверь', 'garage-door': 'Ворота' }[opening.type]
  return <g className="plan-opening-symbol" data-type={opening.type}
    data-testid={preview ? 'plan-opening-preview' : 'plan-frame-opening-' + opening.id}
    data-conflict={!!conflict} data-muted={!!muted} data-selected={!!selected} data-preview={!!preview} data-invalid={!!invalid}
    data-offset-mm={opening.positionUmm} role={onSelect ? 'button' : undefined}
    aria-label={onSelect ? title + ' ' + opening.id + ', ' + openingMetres(opening.widthMm) + ' м' : undefined}
    aria-pressed={onSelect ? !!selected : undefined} tabIndex={onSelect ? 0 : undefined}
    pointerEvents={onSelect ? undefined : 'none'}
    onClick={onSelect} onPointerDown={onDrag}
    onKeyDown={onSelect ? event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }
    } : undefined}>
    <g transform={transform(offset)}>
      {onSelect && <>
        <line className="plan-opening-hit" x2={width} />
        {opening.type === 'door' && <line className="plan-opening-hit plan-opening-leaf-hit"
          x1={hinge} x2={hinge} y2={width * direction} />}
      </>}
      <g className="plan-opening-lines" pointerEvents="none">
        <path d={`M 0 ${-depth / 2} V ${depth / 2} M ${width} ${-depth / 2} V ${depth / 2}`} />
        {opening.type === 'window' && <path d={`M 0 ${-depth * .24} H ${width} M 0 ${depth * .24} H ${width}`} />}
        {opening.type === 'garage-door' && <>
          <path d={`M 0 0 H ${width}`} />
          <path className="plan-garage-track" d={`M 0 ${-depth / 2} H ${width}`} />
        </>}
        {opening.type === 'door' && <>
          <path d={`M ${hinge} 0 V ${width * direction}`} />
          <path className="plan-door-arc" d={`M ${latch} 0 A ${width} ${width} 0 0 ${sweep} ${hinge} ${width * direction}`} />
          <circle cx={hinge} r={2.2} fill="currentColor" stroke="none" />
        </>}
        {(preview || selected) && <rect className="plan-opening-selection" x={0} y={-depth / 2 - 3}
          width={width} height={depth + 6} rx={2} />}
      </g>
    </g>
    {!muted && <text x={label.x + (side.start.xMm === side.end.xMm ? (side.start.zMm < side.end.zMm ? 14 : -14) : 0)}
      y={label.y} className="plan-opening-label" textAnchor="middle" pointerEvents="none">{opening.id}</text>}
  </g>
}

export function PlanOpeningDimensions({
  opening, side, xy, pxPerMm, interactive, onChange,
}: DrawingProps & { interactive: boolean; onChange: (field: OpeningDimension, valueMm: number) => boolean }) {
  const [edit, setEdit] = useState<{ field: OpeningDimension; value: string } | null>(null)
  useEffect(() => setEdit(null), [opening.id, opening.positionUmm, opening.widthMm, interactive])
  const { at, depth } = axis({ side, xy, pxPerMm })
  const length = planSideLength(side)
  const start = opening.positionUmm, end = start + opening.widthMm
  const distances = [
    { field: 'start', label: 'От начала стены', from: 0, to: start },
    { field: 'width', label: 'Ширина проёма', from: start, to: end },
    { field: 'end', label: 'До конца стены', from: end, to: length },
  ] as const
  const normalDirection = 'thicknessMm' in side && opening.type === 'door' && opening.swing?.side === 'right' ? -1 : 1
  const normal = (depth / 2 + 38) * normalDirection
  const witness = [...new Set([0, start, end, length])]
  return <g className="plan-opening-dimensions" pointerEvents="none" data-testid="plan-opening-dimensions">
    {witness.map(u => {
      const a = at(u * pxPerMm, (depth / 2 + 5) * normalDirection)
      const b = at(u * pxPerMm, normal + 5 * normalDirection)
      return <line key={u} className="plan-opening-witness" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    })}
    {distances.map(({ field, label, from, to }, index) => {
      if (to < from) return null
      const a = at(from * pxPerMm, normal), b = at(to * pxPerMm, normal)
      const ticks = [from, to].map(u => [at(u * pxPerMm, normal - 5), at(u * pxPerMm, normal + 5)])
      const short = (to - from) * pxPerMm < 58
      const center = at((from + to) / 2 * pxPerMm,
        normal + (short && index !== 1 ? (index === 0 ? 24 : 45) * normalDirection : 0))
      const text = openingMetres(to - from)
      const isEditing = edit?.field === field
      const labelWidth = Math.max(58, text.length * 7 + 25)
      const begin = () => setEdit({ field, value: text })
      return <g key={field} data-testid={'plan-opening-dimension-' + field}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {ticks.map(([p, q], i) => <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />)}
        {isEditing ? <foreignObject x={center.x - 49} y={center.y - 18} width={98} height={36}
          pointerEvents="auto" onClick={event => event.stopPropagation()}>
          <div className="plan-inline-dimension">
            <input aria-label={label + ', м'} data-testid="plan-opening-dimension-input" type="text"
              inputMode="decimal" value={edit.value} autoFocus
              onFocus={event => event.currentTarget.select()}
              onBlur={() => setEdit(null)}
              onChange={event => setEdit({ ...edit, value: event.target.value })}
              aria-invalid={parseOpeningDimension(edit.value) === null}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setEdit(null)
                } else if (event.key === 'Enter') {
                  event.stopPropagation()
                  const value = parseOpeningDimension(edit.value)
                  if (value !== null && onChange(field, value)) setEdit(null)
                }
              }} />
          </div>
        </foreignObject> : <g className={interactive ? 'plan-click-dimension' : undefined}
          role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? label + ' ' + text + ' м, изменить' : undefined}
          pointerEvents={interactive ? 'auto' : 'none'}
          onClick={interactive ? event => { event.stopPropagation(); begin() } : undefined}
          onKeyDown={interactive ? event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              begin()
            }
          } : undefined}>
          <rect x={center.x - labelWidth / 2} y={center.y - 11} width={labelWidth} height={22} rx={5} />
          <text x={center.x} y={center.y + 4} textAnchor="middle">{text} м</text>
        </g>}
      </g>
    })}
  </g>
}

export function closestPointOnSide(side: PlanFrameSide, offset: number) {
  return planSidePoint(side, Math.max(0, Math.min(planSideLength(side), offset)))
}
