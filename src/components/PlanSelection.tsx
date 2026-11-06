import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { PLAN_OPENING_PRESETS, planSideLength, type PlanFrameSide } from '../core/plan-frame'
import type { Opening } from '../core/project'
import { openingMetres, parseOpeningDimension } from './PlanOpeningGraphics'
import { DEFAULT_DOOR_SWING } from './usePlanOpenings'

function OpeningActions({ side, onAdd }: { side: PlanFrameSide; onAdd: (type: Opening['type']) => void }) {
  const presets = PLAN_OPENING_PRESETS.filter(item => !('thicknessMm' in side) || item.value === 'door')
  return <div className="plan-opening-actions" role="group" aria-label="Добавить проём в выбранную стену">
    {presets.map(preset => <button type="button" key={preset.value}
      data-testid={'plan-add-' + preset.value}
      aria-label={'Добавить ' + preset.label.toLowerCase()} onClick={() => onAdd(preset.value)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none"
        stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        {preset.value === 'window' ? <path d="M2 4h12v8H2zM8 4v8M2 8h12" />
          : preset.value === 'door' ? <path d="M3 14V2h9v12M3 2l6 2v10H3m4-5h.5" />
            : <path d="M1.5 13V4l6.5-2 6.5 2v9M4 13V6h8v7M4 8.5h8M4 11h8" />}
      </svg>
      {preset.label}
    </button>)}
  </div>
}

export function PlanWallActions({ side, anchor, svgRef, onAdd }: {
  side: PlanFrameSide
  anchor: { x: number; y: number }
  svgRef: RefObject<SVGSVGElement>
  onAdd: (type: Opening['type']) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const svg = svgRef.current
    const panel = ref.current
    const container = panel?.parentElement
    if (!svg || !panel || !container) return
    const position = () => {
      const transform = svg.getScreenCTM()
      if (!transform) return
      const point = new DOMPoint(anchor.x, anchor.y).matrixTransform(transform)
      const rect = container.getBoundingClientRect()
      const left = point.x - rect.left
      const top = point.y - rect.top
      const width = panel.offsetWidth
      const height = panel.offsetHeight
      const above = top > rect.height / 2
      panel.style.left = Math.max(8, Math.min(left - width / 2, rect.width - width - 8)) + 'px'
      panel.style.top = Math.max(8, Math.min(top + (above ? -height - 16 : 16), rect.height - height - 8)) + 'px'
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(container)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [anchor.x, anchor.y, svgRef])
  return <div ref={ref} className="plan-wall-actions" data-testid="plan-wall-actions" data-wall-id={side.wallId}>
    <span className="plan-wall-actions-label">{side.label}</span>
    <OpeningActions side={side} onAdd={onAdd} />
  </div>
}

export function PlanWallSelection({ side }: { side: PlanFrameSide }) {
  return <section className="plan-selection-panel" aria-label="Выбранная стена">
    <span className="plan-inspector-kicker">Выбранная стена</span>
    <strong>{side.label}</strong>
    <span className="plan-selection-detail">{openingMetres(planSideLength(side))} м · {
      'thicknessMm' in side ? 'Перегородка' : 'Наружная'
    }</span>
    <span className="plan-selection-detail">Действия доступны рядом со стеной на плане.</span>
  </section>
}

export function PlanOpeningInspector({ opening, side, onSave, onRemove }: {
  opening: Opening
  side: PlanFrameSide
  onSave: (value: Opening) => boolean
  onRemove: () => void
}) {
  const [offset, setOffset] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [sill, setSill] = useState('')
  useEffect(() => {
    setOffset(openingMetres(opening.positionUmm))
    setWidth(String(opening.widthMm))
    setHeight(String(opening.heightMm))
    setSill(String(opening.sillHeightMm))
  }, [opening])
  const offsetMm = parseOpeningDimension(offset)
  const whole = (value: string) => /^\d+$/.test(value) ? Number(value) : NaN
  const widthMm = whole(width), heightMm = whole(height), sillHeightMm = whole(sill)
  const valid = offsetMm !== null && [widthMm, heightMm, sillHeightMm].every(Number.isSafeInteger)
  const changed = valid && (offsetMm !== opening.positionUmm || widthMm !== opening.widthMm ||
    heightMm !== opening.heightMm || sillHeightMm !== opening.sillHeightMm)
  const swing = opening.swing ?? DEFAULT_DOOR_SWING
  const title = PLAN_OPENING_PRESETS.find(item => item.value === opening.type)!.label
  return <section className="plan-selection-panel" data-testid="plan-opening-inspector" aria-label="Свойства проёма">
    <span className="plan-inspector-kicker">Свойства проёма</span>
    <strong>{title} <span className="plan-object-tag">{opening.id}</span></strong>
    <span className="plan-selection-detail">{side.label}</span>
    <form className="plan-inspector-form" onSubmit={event => {
      event.preventDefault()
      if (changed) onSave({ ...opening, positionUmm: offsetMm, widthMm, heightMm, sillHeightMm })
    }}>
      <label>От начала стены, м
        <input data-testid="plan-opening-inspector-offset" value={offset} inputMode="decimal"
          onChange={event => setOffset(event.target.value)} aria-invalid={offset !== '' && offsetMm === null} />
      </label>
      <div className="plan-frame-fields">
        <label>Ширина, мм<input data-testid="plan-opening-inspector-width" inputMode="numeric" value={width}
          onChange={event => setWidth(event.target.value)} /></label>
        <label>Высота, мм<input data-testid="plan-opening-inspector-height" inputMode="numeric" value={height}
          onChange={event => setHeight(event.target.value)} /></label>
      </div>
      {opening.type === 'window' && <label>Подоконник от пола, мм<input inputMode="numeric" value={sill}
        onChange={event => setSill(event.target.value)} /></label>}
      {opening.type === 'door' && <div className="plan-frame-fields plan-swing-actions">
        <button type="button" data-testid="plan-door-flip-hinge"
          onClick={() => onSave({ ...opening, swing: { ...swing, hinge: swing.hinge === 'start' ? 'end' : 'start' } })}>
          Сменить петли
        </button>
        <button type="button" data-testid="plan-door-flip-swing"
          onClick={() => onSave({ ...opening, swing: { ...swing, side: swing.side === 'left' ? 'right' : 'left' } })}>
          Развернуть
        </button>
      </div>}
      <div className="plan-frame-fields">
        <button type="submit" className="plan-button plan-primary" disabled={!changed}>Применить</button>
        <button type="button" className="plan-button plan-text" data-testid="plan-opening-delete"
          onClick={onRemove}>Удалить</button>
      </div>
    </form>
  </section>
}
