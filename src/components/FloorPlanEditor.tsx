import { useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import {
  emptyFloorPlan, meters, planAreaM2, planBounds, planDistanceMm,
  planPerimeterMm, validateFloorPlan, decimalMetersToMm,
  snapPlanAnchor, nextInteriorWallId, planInteriorJunctions,
  type FloorPlan, type PlanPoint, type PlanInteriorWall,
} from '../core/floor-plan'
import type { ProjectCommand, CommandResult } from '../core/ProjectStore'

const WIDTH = 1200
const HEIGHT = 760
const BASE_PX_PER_METRE = 64
const OFFSET_X = 220
const OFFSET_Y = 565
const directions = [
  { value: '+x', label: 'Вправо (+X)', x: 1, z: 0 },
  { value: '-z', label: 'Вверх (−Z)', x: 0, z: -1 },
  { value: '-x', label: 'Влево (−X)', x: -1, z: 0 },
  { value: '+z', label: 'Вниз (+Z)', x: 0, z: 1 },
] as const

type Direction = typeof directions[number]['value']
type PanDrag = { pointerId: number; initialX: number; initialY: number; panX: number; panY: number }

export interface FloorPlanEditorProps {
  plan?: FloorPlan
  onCommand: (command: ProjectCommand) => CommandResult
  onExport: () => void
  onImport: () => void
}

export function FloorPlanEditor({ plan = emptyFloorPlan(), onCommand, onExport, onImport }: FloorPlanEditorProps) {
  const [direction, setDirection] = useState<Direction>('+x')
  const [exactLength, setExactLength] = useState('6')
  const [snapMm, setSnapMm] = useState(250)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState<PlanPoint | null>(null)
  const [localError, setLocalError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [tool, setTool] = useState<'outline' | 'interior' | 'select'>('outline')
  const [interiorStart, setInteriorStart] = useState<PlanPoint | null>(null)
  const [interiorHover, setInteriorHover] = useState<PlanPoint | null>(null)
  const [interiorThickness, setInteriorThickness] = useState('100')
  const [selectedInteriorId, setSelectedInteriorId] = useState<string | null>(null)
  const [interiorEdit, setInteriorEdit] = useState({ sx: '', sz: '', ex: '', ez: '', thickness: '100' })
  const [pointX, setPointX] = useState('')
  const [pointZ, setPointZ] = useState('')
  const drag = useRef<PanDrag | null>(null)
  const ignoreClick = useRef(false)
  const points = plan.exterior
  const selectedInterior = plan.interiorWalls.find(w => w.id === selectedInteriorId)
  const innerJunctions = planInteriorJunctions(plan)
  const px = zoom * BASE_PX_PER_METRE
  const originX = OFFSET_X + pan.x
  const originY = OFFSET_Y + pan.y
  const xy = (p: PlanPoint) => ({
    x: originX + p.xMm / 1000 * px,
    y: originY + p.zMm / 1000 * px,
  })
  const svgFromEvent = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
    const svg = event.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const converted = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    return { x: converted.x, y: converted.y }
  }
  const snap = (x: number) => Math.round(x / snapMm) * snapMm
  const endpoint = (screen: { x: number; y: number }): PlanPoint => {
    if (!points.length) return { xMm: 0, zMm: 0 }
    const last = points[points.length - 1]
    const desiredX = snap((screen.x - originX) / px * 1000)
    const desiredZ = snap((screen.y - originY) / px * 1000)
    if (Math.abs(desiredX - last.xMm) >= Math.abs(desiredZ - last.zMm)) {
      return { xMm: desiredX, zMm: last.zMm }
    }
    return { xMm: last.xMm, zMm: desiredZ }
  }
  const apply = (command: ProjectCommand) => {
    const result = onCommand(command)
    setLocalError(result.success ? '' : result.messageRu || 'Операция недоступна')
    return result.success
  }
  const toSignedMm = (value: string): number | null => {
    const normalized = value.trim().replace(',', '.')
    return /^-?\d+(?:\.\d{1,3})?$/.test(normalized)
      ? Math.round(Number(normalized) * 1000) : null
  }
  const canvasWorldPoint = (location: { x: number; y: number }): PlanPoint => ({
    xMm: Math.round((location.x - originX) / px * 1000),
    zMm: Math.round((location.y - originY) / px * 1000),
  })
  const addInteriorAnchor = (point: PlanPoint) => {
    if (!plan.closed) return
    if (!interiorStart) {
      setInteriorStart(point)
      setSelectedInteriorId(null)
      setLocalError('')
      return
    }
    const thickness = Number(interiorThickness)
    if (!Number.isInteger(thickness) || thickness < 50 || thickness > 500) {
      setLocalError('Толщина внутренней стены должна быть 50–500 мм')
      return
    }
    const wall: PlanInteriorWall = {
      id: nextInteriorWallId(plan),
      start: interiorStart, end: point, thicknessMm: thickness,
    }
    if (apply({ type: 'PLAN_ADD_INTERIOR_WALL', payload: { wall } })) {
      setInteriorStart(null)
      setInteriorHover(null)
    }
  }
  const selectInteriorWall = (wall: PlanInteriorWall) => {
    setSelectedInteriorId(wall.id)
    setSelectedIndex(null)
    setInteriorEdit({
      sx: meters(wall.start.xMm), sz: meters(wall.start.zMm),
      ex: meters(wall.end.xMm), ez: meters(wall.end.zMm),
      thickness: String(wall.thicknessMm),
    })
  }
  const updateInteriorWall = () => {
    if (!selectedInterior) return
    const sx = toSignedMm(interiorEdit.sx), sz = toSignedMm(interiorEdit.sz)
    const ex = toSignedMm(interiorEdit.ex), ez = toSignedMm(interiorEdit.ez)
    const thicknessMm = Number(interiorEdit.thickness)
    if ([sx, sz, ex, ez].some(value => value === null) || !Number.isInteger(thicknessMm)) {
      setLocalError('Неверные координаты или толщина: метры до 1 мм, толщина в мм')
      return
    }
    apply({ type: 'PLAN_UPDATE_INTERIOR_WALL', payload: {
      id: selectedInterior.id,
      start: { xMm: sx!, zMm: sz! }, end: { xMm: ex!, zMm: ez! },
      thicknessMm,
    } })
  }
  const suggestClose = useMemo(() => {
    if (plan.closed || points.length < 4) return { valid: false, error: '' }
    const errors = validateFloorPlan({ ...plan, closed: true })
    return { valid: errors.length === 0, error: errors[0] ?? '' }
  }, [plan, points])
  const current = points[points.length - 1]
  const proposal = hover && current && !plan.closed
    ? endpoint(xy(hover)) : null
  const proposalErrors = proposal && !plan.closed
    ? validateFloorPlan({ ...plan, exterior: [...points, proposal] }) : []
  const bounds = planBounds(points)
  const widthM = (bounds.maxX - bounds.minX) / 1000
  const depthM = (bounds.maxZ - bounds.minZ) / 1000
  const edges = points.slice(1).map((to, index) => ({
    from: points[index], to, index, isClosing: false,
  }))
  if (plan.closed && points.length > 2) {
    edges.push({ from: points[points.length - 1], to: points[0],
      index: points.length - 1, isClosing: true })
  }
  const totalLength = planPerimeterMm(plan)
  const fill = points.map(p => {
    const q = xy(p)
    return q.x + ',' + q.y
  }).join(' ')
  const close = () => {
    if (!suggestClose.valid) {
      setLocalError(suggestClose.error || 'Контур ещё нельзя замкнуть')
      return
    }
    if (apply({ type: 'PLAN_CLOSE', payload: {} })) {
      setTool('interior')
      setHover(null)
      setSelectedIndex(null)
      fitView()
    }
  }
  const addExact = () => {
    if (!points.length) {
      apply({ type: 'PLAN_ADD_POINT', payload: { point: { xMm: 0, zMm: 0 } } })
      return
    }
    const value = decimalMetersToMm(exactLength)
    if (value === null) {
      setLocalError('Введите длину от 0,30 до 100 м, точность — до 1 мм')
      return
    }
    const chosen = directions.find(item => item.value === direction)!
    const next = { xMm: current.xMm + chosen.x * value,
      zMm: current.zMm + chosen.z * value }
    if (apply({ type: 'PLAN_ADD_POINT', payload: { point: next } })) {
      setHover(null)
      setSelectedIndex(null)
      const idx = directions.findIndex(item => item.value === direction)
      setDirection(directions[(idx + 1) % 4].value)
    }
  }
  const fitView = () => {
    if (!points.length) { setPan({ x: 0, y: 0 }); setZoom(1); return }
    const pixelPerMeter = Math.min(
      (WIDTH - 240) / Math.max(widthM, 2),
      (HEIGHT - 210) / Math.max(depthM, 2),
      BASE_PX_PER_METRE * 2.5,
    )
    const nextZoom = Math.min(2.5, Math.max(0.3, pixelPerMeter / BASE_PX_PER_METRE))
    const fittedPx = BASE_PX_PER_METRE * nextZoom
    setZoom(nextZoom)
    setPan({
      x: WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2000) * fittedPx - OFFSET_X,
      y: HEIGHT / 2 - ((bounds.minZ + bounds.maxZ) / 2000) * fittedPx - OFFSET_Y,
    })
  }
  const onCanvasClick = (event: MouseEvent<SVGSVGElement>) => {
    if (ignoreClick.current) { ignoreClick.current = false; return }
    if (event.shiftKey) return
    if (plan.closed) {
      if (tool !== 'interior') return
      const position = canvasWorldPoint(svgFromEvent(event))
      const snapped = snapPlanAnchor(plan, position,
        Math.min(1200, 18 * 1000 / px), snapMm, interiorStart ?? undefined)
      if (!snapped) {
        setLocalError('Наведите курсор на существующую стену (привязка до 18 пикселей)')
        return
      }
      addInteriorAnchor(snapped)
      return
    }
    if (!points.length) {
      addExact()
      return
    }
    const loc = svgFromEvent(event)
    const first = xy(points[0])
    if (points.length >= 4 && Math.hypot(loc.x - first.x, loc.y - first.y) < 24) {
      close()
      return
    }
    const candidate = endpoint(loc)
    apply({ type: 'PLAN_ADD_POINT', payload: { point: candidate } })
  }
  const selectPoint = (index: number) => {
    if (plan.closed && tool === 'interior') {
      const snapped = snapPlanAnchor(plan, points[index], 1, snapMm, interiorStart ?? undefined)
      if (snapped) addInteriorAnchor(snapped)
      else setLocalError('Точка не образует прямой угол с предыдущей привязкой')
      return
    }
    if (!plan.closed && index === 0 && points.length >= 4) { close(); return }
    const point = points[index]
    setSelectedIndex(index)
    setPointX(meters(point.xMm))
    setPointZ(meters(point.zMm))
  }
  const moveSelectedPoint = () => {
    if (selectedIndex === null || selectedIndex === 0) return
    const toMm = (value: string) => {
      const normalized = value.replace(',', '.').trim()
      return /^-?\d+(?:\.\d{1,3})?$/.test(normalized)
        ? Math.round(Number(normalized) * 1000) : null
    }
    const xMm = toMm(pointX), zMm = toMm(pointZ)
    if (xMm === null || zMm === null) {
      setLocalError('Введите координаты в метрах с точностью до 1 мм')
      return
    }
    apply({ type: 'PLAN_MOVE_POINT', payload: { index: selectedIndex, point: { xMm, zMm } } })
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    if (event.ctrlKey) return
    setZoom(previous => Math.min(2.8, Math.max(0.32, previous * (event.deltaY < 0 ? 1.10 : 0.91))))
  }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.shiftKey || event.button === 1) {
      event.preventDefault()
      const loc = svgFromEvent(event)
      drag.current = { pointerId: event.pointerId, initialX: loc.x,
        initialY: loc.y, panX: pan.x, panY: pan.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const loc = svgFromEvent(event)
    if (drag.current && drag.current.pointerId === event.pointerId) {
      const data = drag.current
      setPan({ x: data.panX + loc.x - data.initialX,
        y: data.panY + loc.y - data.initialY })
      ignoreClick.current = true
      return
    }
    if (plan.closed && tool === 'interior') {
      const snapped = snapPlanAnchor(plan, canvasWorldPoint(loc),
        Math.min(1200, 18 * 1000 / px), snapMm, interiorStart ?? undefined)
      setInteriorHover(snapped)
      return
    }
    if (!points.length || plan.closed) return
    const proposal = endpoint(loc)
    setHover(proposal)
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="plan-workspace" data-testid="plan-workspace">
      <aside className="plan-controls">
        <div className="plan-eyebrow">SIGMA4 / ЧЕРТЁЖ 01</div>
        <h1>Периметр дома</h1>
        <p className="plan-muted">Построение наружного контура по точкам. Все размеры — в метрах, точность хранения — 1 мм.</p>
        <div className="plan-step">
          <span className="plan-step-count">01</span>
          <div><strong>{plan.closed ? 'Контур готов' : points.length ? 'Продолжайте контур' : 'Начальная точка'}</strong>
            <small>{plan.closed ? 'Можно редактировать узлы и размеры'
              : points.length ? 'Щёлкните на сетке или введите следующую длину'
                : 'Нажмите на поле или кнопку: точка (0,0)'}</small>
          </div>
        </div>
        {!plan.closed && (
          <div className="plan-tool-section">
            <label htmlFor="plan-length">Длина участка, м</label>
            <input id="plan-length" data-testid="plan-length-input" className="plan-large-input"
              type="text" inputMode="decimal" value={exactLength}
              onChange={event => setExactLength(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') addExact() }} />
            <label htmlFor="plan-direction">Направление</label>
            <select id="plan-direction" data-testid="plan-direction" value={direction}
              onChange={event => setDirection(event.target.value as Direction)}>
              {directions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" className="plan-button plan-primary" data-testid="plan-add-exact"
              onClick={addExact}>
              {points.length ? '+ Добавить по размеру' : 'Начать с 0,00'}
            </button>
            <button type="button" className="plan-button plan-secondary" data-testid="plan-close"
              disabled={!suggestClose.valid} onClick={close}>
              Замкнуть периметр
            </button>
            {points.length >= 3 && !suggestClose.valid && (
              <p className="plan-guidance" data-testid="plan-closure-hint">{suggestClose.error ||
                'Для замыкания нарисуйте последний угол'}</p>
            )}
          </div>
        )}
        {plan.closed && <>
          <div className="plan-complete" data-testid="plan-closed-status">
            <strong>Контур замкнут</strong>
            <span>Теперь можно чертить внутренние стены с привязкой к контуру и существующим перегородкам.</span>
            <button className="plan-button plan-secondary" type="button" data-testid="plan-reopen"
              onClick={() => {
                if (apply({ type: 'PLAN_REOPEN', payload: {} })) {
                  setTool('outline'); setInteriorStart(null); setSelectedInteriorId(null)
                }
              }}>Разомкнуть для продолжения</button>
          </div>
          <div className="plan-tool-section" data-testid="plan-interior-controls">
            <strong className="plan-section-title">02 · Внутренние стены</strong>
            <p className="plan-muted">Переключитесь на «Чертить». Нажмите начало на существующей стене, затем конец на другой. Пересечения станут узлами автоматически.</p>
            <label htmlFor="plan-interior-thickness">Толщина стены, мм</label>
            <input id="plan-interior-thickness" data-testid="plan-wall-thickness"
              type="number" min="50" max="500" step="1"
              value={interiorThickness} onChange={e => setInteriorThickness(e.target.value)} />
            <div className="plan-mode-buttons">
              <button type="button" data-testid="plan-tool-interior"
                className={tool === 'interior' ? 'plan-mode-active' : ''}
                onClick={() => { setTool('interior'); setSelectedInteriorId(null); setSelectedIndex(null) }}>
                + Чертить
              </button>
              <button type="button" data-testid="plan-tool-select"
                className={tool === 'select' ? 'plan-mode-active' : ''}
                onClick={() => { setTool('select'); setInteriorStart(null); setInteriorHover(null) }}>
                Выбрать
              </button>
            </div>
            {interiorStart && <div className="plan-anchor-info" data-testid="plan-anchor-info">
              Начало: X {meters(interiorStart.xMm)} · Z {meters(interiorStart.zMm)} м
              <button type="button" onClick={() => { setInteriorStart(null); setInteriorHover(null) }}>
                Отменить начало
              </button>
            </div>}
            <p className="plan-guidance">Построено стен: <strong data-testid="plan-wall-count">{plan.interiorWalls.length}</strong></p>
          </div>
          {selectedInterior && tool === 'select' && (
            <div className="plan-tool-section" data-testid="plan-selected-interior">
              <strong className="plan-section-title">Стена {selectedInterior.id}</strong>
              <p className="plan-muted">Координаты оси в метрах. Меняйте поля и нажимайте «Применить»; связанные соединения проверяются.</p>
              {([
                ['sx', 'Начало X, м'], ['sz', 'Начало Z, м'],
                ['ex', 'Конец X, м'], ['ez', 'Конец Z, м'],
                ['thickness', 'Толщина, мм'],
              ] as const).map(([key,label]) =>
                <label key={key}>{label}
                  <input data-testid={'plan-edit-' + key} type="text" value={interiorEdit[key]}
                    onChange={e => setInteriorEdit(prev => ({...prev, [key]: e.target.value}))} />
                </label>
              )}
              <p className="plan-guidance">Длина: {meters(planDistanceMm(selectedInterior.start, selectedInterior.end))} м</p>
              <button className="plan-button plan-primary" data-testid="plan-save-interior"
                type="button" onClick={updateInteriorWall}>Применить координаты</button>
              <button className="plan-button plan-text" data-testid="plan-remove-interior"
                type="button" onClick={() => {
                  if (window.confirm('Удалить внутреннюю стену ' + selectedInterior.id + '?')) {
                    if (apply({ type: 'PLAN_REMOVE_INTERIOR_WALL', payload: { id: selectedInterior.id } }))
                      setSelectedInteriorId(null)
                  }
                }}>Удалить стену</button>
            </div>
          )}
        </>}
        <div className="plan-tool-section plan-actions">
          {!plan.closed && <button type="button" className="plan-button plan-secondary"
            data-testid="plan-remove-last" disabled={!points.length}
            onClick={() => { if (apply({ type: 'PLAN_REMOVE_LAST', payload: {} })) setSelectedIndex(null) }}>
            Удалить последнюю точку
          </button>}
          <button type="button" className="plan-button plan-text" data-testid="plan-reset"
            disabled={!points.length} onClick={() => {
              if (window.confirm('Удалить весь наружный контур?')) {
                if (apply({ type: 'PLAN_CLEAR', payload: {} })) {
                  setSelectedIndex(null); setHover(null); fitView()
                }
              }
            }}>Очистить чертёж</button>
        </div>
        {selectedIndex !== null && points[selectedIndex] && (
          <div className="plan-tool-section" data-testid="plan-selected-point">
            <strong>Точка {selectedIndex + 1}</strong>
            {selectedIndex === 0 ? <p className="plan-muted">Начало координат зафиксировано: X=0, Z=0.</p> :
              <>
                <label htmlFor="plan-point-x">X, м</label>
                <input id="plan-point-x" type="text" value={pointX}
                  onChange={e => setPointX(e.target.value)} />
                <label htmlFor="plan-point-z">Z, м</label>
                <input id="plan-point-z" type="text" value={pointZ}
                  onChange={e => setPointZ(e.target.value)} />
                <button type="button" className="plan-button plan-secondary"
                  data-testid="plan-save-point" onClick={moveSelectedPoint}>
                  Применить координаты
                </button>
              </>}
          </div>
        )}
        {localError && <div className="plan-error" role="alert" data-testid="plan-error">{localError}</div>}
        <div className="plan-divider" />
        {!plan.closed && <div className="plan-step plan-step-secondary">
          <span className="plan-step-count">02</span>
          <div><strong>Внутренние стены</strong><small>Доступны после замыкания наружного периметра.</small></div>
        </div>}
        <button type="button" className="plan-button plan-export" onClick={onExport}
          data-testid="plan-export">Экспортировать план в JSON</button>
        <button type="button" className="plan-button plan-text" onClick={onImport}>Импортировать JSON</button>
      </aside>
      <main className="plan-drawing">
        <div className="plan-toolbar">
          <div className="plan-mode-mark"><span className="plan-dot" /> ПЛАН / {plan.closed ? tool === 'interior' ? 'ЧЕРЧЕНИЕ ПЕРЕГОРОДОК' : 'ВЫБОР СТЕН' : 'НАРУЖНЫЙ КОНТУР'}</div>
          <label className="plan-grid-select">Шаг привязки
            <select data-testid="plan-grid-step" value={snapMm}
              onChange={event => setSnapMm(Number(event.target.value))}>
              <option value={100}>0,10 м</option><option value={250}>0,25 м</option>
              <option value={500}>0,50 м</option><option value={1000}>1,00 м</option>
            </select>
          </label>
          <div className="plan-zoom-tools">
            <button type="button" title="Уменьшить масштаб" onClick={() => setZoom(s => Math.max(0.32,s/1.15))}>−</button>
            <span data-testid="plan-zoom">{Math.round(zoom*100)}%</span>
            <button type="button" title="Увеличить масштаб" onClick={() => setZoom(s => Math.min(2.8,s*1.15))}>+</button>
            <button type="button" data-testid="plan-fit" title="Показать весь план" onClick={fitView}>Весь план</button>
          </div>
        </div>
        <div className="plan-canvas-wrap">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="plan-canvas"
            data-testid="plan-canvas" role="img" aria-label="Чертёж периметра здания, метры"
            onClick={onCanvasClick} onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => setHover(null)}
            onWheel={wheel}>
            <defs>
              <pattern id="plan-small-grid" x={originX} y={originY}
                width={px/4} height={px/4} patternUnits="userSpaceOnUse">
                <path d={`M ${px/4} 0 L 0 0 0 ${px/4}`} fill="none" stroke="#e4eaf1" strokeWidth="0.8"/>
              </pattern>
              <pattern id="plan-big-grid" x={originX} y={originY}
                width={px} height={px} patternUnits="userSpaceOnUse">
                <path d={`M ${px} 0 L 0 0 0 ${px}`} fill="none" stroke="#ccd7e3" strokeWidth="1.1"/>
              </pattern>
            </defs>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fcfdff" />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-small-grid)" pointerEvents="none" />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-big-grid)" pointerEvents="none" />
            <line x1={originX} y1={0} x2={originX} y2={HEIGHT}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <line x1={0} y1={originY} x2={WIDTH} y2={originY}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <text x={WIDTH-32} y={originY-14} className="plan-axis-label" textAnchor="end">+X →</text>
            <text x={originX+14} y={22} className="plan-axis-label">−Z ↑</text>
            {plan.closed && <polygon points={fill} fill="#d9eafa" fillOpacity=".56" stroke="none" pointerEvents="none"/>}
            {edges.map(edge => {
              const a=xy(edge.from),b=xy(edge.to)
              const dx=b.x-a.x,dy=b.y-a.y
              const length=Math.hypot(dx,dy)
              const norm={x:-dy/length,y:dx/length}
              const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
              const boundingCenter={x:(bounds.minX+bounds.maxX)/2,
                z:(bounds.minZ+bounds.maxZ)/2}
              const centerScreen=xy({xMm:boundingCenter.x,zMm:boundingCenter.z})
              const dot=(center.x-centerScreen.x)*norm.x+(center.y-centerScreen.y)*norm.y
              const side=dot>=0?1:-1
              const offset=norm.x*26*side, offsetY=norm.y*26*side
              const labelX=center.x+offset, labelY=center.y+offsetY
              const rotation=Math.abs(dx)<Math.abs(dy)?-90:0
              const label=meters(planDistanceMm(edge.from,edge.to))+' м'
              return <g key={edge.index} pointerEvents="none">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plan-wall-line" />
                <line x1={a.x+norm.x*17*side} y1={a.y+norm.y*17*side}
                  x2={b.x+norm.x*17*side} y2={b.y+norm.y*17*side} className="plan-dimension-line"/>
                <g transform={`translate(${labelX} ${labelY}) rotate(${rotation})`}>
                  <rect x={-40} y={-11} width={80} height={22} rx={5} fill="white" stroke="#dbe6ef" />
                  <text y={5} textAnchor="middle" className="plan-dimension-text">{label}</text>
                </g>
              </g>
            })}
            {current && proposal && !plan.closed && !(
              current.xMm===proposal.xMm&&current.zMm===proposal.zMm) && (
              <g pointerEvents="none">
                <line x1={xy(current).x} y1={xy(current).y}
                  x2={xy(proposal).x} y2={xy(proposal).y}
                  stroke={proposalErrors.length ? '#da574c':'#27a59b'}
                  strokeWidth={4} strokeDasharray="9 8" />
                <circle cx={xy(proposal).x} cy={xy(proposal).y} r={6}
                  fill={proposalErrors.length ? '#da574c':'#27a59b'}/>
                <text x={xy(proposal).x+13} y={xy(proposal).y-12}
                  fill="#0f6d65" fontSize={15}>{meters(planDistanceMm(current,proposal))} м</text>
              </g>
            )}
            {plan.interiorWalls.map(w => {
              const a = xy(w.start), b = xy(w.end)
              const active = selectedInteriorId === w.id && tool === 'select'
              const label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
              return <g key={w.id} data-testid={'plan-internal-wall-' + w.id}
                onClick={e => {
                  if (tool === 'select') { e.stopPropagation(); selectInteriorWall(w) }
                }}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? '#db8c2d' : '#c27a2f'} strokeWidth={7}
                  strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent" strokeWidth={18} pointerEvents="stroke"
                  className="plan-interior-hit"/>
                <text x={label.x + (a.x === b.x ? 18 : 0)}
                  y={label.y + (a.y === b.y ? -15 : 0)}
                  textAnchor="middle" className="plan-inner-label" pointerEvents="none">
                  {meters(planDistanceMm(w.start,w.end))} м
                </text>
              </g>
            })}
            {innerJunctions.map((p,i) => {
              const pos=xy(p)
              return <circle key={i} cx={pos.x} cy={pos.y} r={6}
                fill="#ffe0ae" stroke="#a86622" strokeWidth={2} pointerEvents="none"/>
            })}
            {plan.closed && tool === 'interior' && interiorStart && (
              <g pointerEvents="none">
                {interiorHover && <line x1={xy(interiorStart).x} y1={xy(interiorStart).y}
                  x2={xy(interiorHover).x} y2={xy(interiorHover).y}
                  stroke="#2e9d7d" strokeWidth={4} strokeDasharray="9 6"
                  vectorEffect="non-scaling-stroke" />}
                <circle cx={xy(interiorStart).x} cy={xy(interiorStart).y}
                  r={8} fill="#1ebd9c" stroke="#fff" strokeWidth={3}/>
                {interiorHover && <circle cx={xy(interiorHover).x} cy={xy(interiorHover).y}
                  r={7} fill="#1ebd9c" stroke="#fff" strokeWidth={2}/>}
              </g>
            )}
            {points.map((point,i) => {
              const loc=xy(point)
              return <g key={i} data-testid={`plan-point-${i}`}
                className="plan-vertex" onClick={event => {event.stopPropagation();selectPoint(i)}}>
                <circle cx={loc.x} cy={loc.y} r={i===0?12:9}
                  fill={i===0?'#18a98b':selectedIndex===i?'#ffab40':'#ffffff'}
                  stroke={i===0?'#0f6f60':'#234765'} strokeWidth={3}/>
                <text x={loc.x} y={loc.y-19} textAnchor="middle"
                  className="plan-node-label">{i===0?'0,0':String(i+1)}</text>
                <circle cx={loc.x} cy={loc.y} r={19} fill="transparent"/>
              </g>
            })}
            {!points.length &&
              <g pointerEvents="none">
                <circle cx={originX} cy={originY} r={16} fill="#d9f6ec"
                  stroke="#169a78" strokeWidth={2} strokeDasharray="3 4"/>
                <text x={originX+22} y={originY-18} className="plan-start-caption">НАЧАЛО 0,0</text>
                <text x={originX+22} y={originY+2} className="plan-start-subcaption">
                  Щёлкните, чтобы поставить первую точку
                </text>
              </g>}
          </svg>
          <div className="plan-measure-panel" data-testid="plan-stats">
            <div><span>Габариты</span><strong data-testid="plan-dimensions">{meters(bounds.maxX-bounds.minX)} × {meters(bounds.maxZ-bounds.minZ)} м</strong></div>
            <div><span>{plan.closed?'Периметр':'Начерчено'}</span><strong data-testid="plan-perimeter">{meters(totalLength)} м</strong></div>
            <div><span>Площадь</span><strong data-testid="plan-area">{plan.closed?planAreaM2(plan).toLocaleString('ru-RU',{maximumFractionDigits:2}):'—'} м²</strong></div>
          </div>
          <div className="plan-canvas-hint">{plan.closed ? tool === 'interior'
            ? 'ЛКМ — начало и конец на существующих стенах · Shift + перетаскивание — сдвиг'
            : 'Нажмите на внутреннюю стену для редактирования · Shift + перетаскивание — сдвиг'
            : 'ЛКМ — следующая точка · Shift + перетаскивание — сдвиг · Колесо — масштаб'}</div>
        </div>
        <div className="plan-bottom">
          <span><strong>Узлов:</strong> {points.length}</span>
          <span><strong>Участков:</strong> {edges.length}</span>
          <span><strong>Внутренних стен:</strong> {plan.interiorWalls.length}</span>
          <span><strong>Статус:</strong> {plan.closed?'Замкнут':'Черновик'}</span>
          <span className="plan-bottom-right">План в мм · отображение в м · сохранение в JSON</span>
        </div>
      </main>
    </div>
  )
}
