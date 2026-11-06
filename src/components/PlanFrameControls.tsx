import { useEffect, useState } from 'react'
import type { CommandResult, ProjectCommand } from '../core/ProjectStore'
import { decimalMetersToMm, planBounds, type FloorPlan } from '../core/floor-plan'
import {
  MIN_FRAME_SIDE_MM, PLAN_OPENING_PRESETS, nextPlanOpeningId, planFrameOpeningSides, planOpeningPreset,
} from '../core/plan-frame'
import { isPartitionWall } from '../core/partition-layout'
import type { Opening } from '../core/project'

export type PlanFramePick = { wallId: string; offsetMm: number } | { opening: Opening }

const fields = [
  { name: 'positionUmm', label: 'От начала стены, мм' },
  { name: 'widthMm', label: 'Ширина, мм' },
  { name: 'heightMm', label: 'Высота, мм' },
  { name: 'sillHeightMm', label: 'Подоконник от пола, мм' },
] as const

const emptyOpenings: Opening[] = []
const doorDefaults = { type: 'door', widthMm: 900, heightMm: 2100, sillHeightMm: 0, garage: undefined, swing: undefined } as const

interface Props {
  plan: FloorPlan
  pick: PlanFramePick | null
  picking: boolean
  onPick: () => void
  onCommand: (command: ProjectCommand) => CommandResult
  onIssues: (ids: string[]) => void
  onBuilt: () => void
}

export function PlanFrameControls({ plan, pick, picking, onPick, onCommand, onIssues, onBuilt }: Props) {
  const sides = planFrameOpeningSides(plan)
  const openings = plan.frame?.openings ?? emptyOpenings
  const bounds = planBounds(plan.exterior)
  const width = (bounds.maxX - bounds.minX) / 1000
  const depth = (bounds.maxZ - bounds.minZ) / 1000
  const [widthDraft, setWidthDraft] = useState(String(width))
  const [depthDraft, setDepthDraft] = useState(String(depth))
  const [draft, setDraft] = useState<Opening | null>(null)
  const [error, setError] = useState('')
  const editing = openings.find(opening => opening.id === draft?.id)

  useEffect(() => {
    setWidthDraft(String(width))
    setDepthDraft(String(depth))
  }, [width, depth])

  useEffect(() => {
    if (!picking) setDraft(null)
  }, [picking])

  useEffect(() => {
    if (pick && 'opening' in pick) {
      setDraft(pick.opening)
    } else if (pick) {
      setDraft(previous => ({
        widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window', id: '', ...previous,
        ...(isPartitionWall(pick.wallId) && previous?.type !== 'door' ? doorDefaults : {}),
        wallId: pick.wallId, positionUmm: pick.offsetMm,
      }))
    }
  }, [pick])

  const apply = (command: ProjectCommand) => {
    const result = onCommand(command)
    setError(result.success ? '' : result.messageRu || 'Операция недоступна')
    onIssues(result.success ? [] : result.validation?.issues.flatMap(issue => issue.affectedIds) ?? [])
    return result.success
  }

  const changeType = (value: Opening['type']) => {
    setDraft(previous => previous && ({
      ...planOpeningPreset(value, previous.wallId, previous.id), positionUmm: previous.positionUmm,
      ...(value === previous.type && previous.swing ? { swing: previous.swing } : {}),
    }))
  }

  const save = () => {
    if (!draft) return
    const id = editing?.id ?? nextPlanOpeningId(openings, draft.type)
    if (apply({ type: 'PLAN_FRAME_SAVE_OPENING', payload: { opening: { ...draft, id } } })) setDraft(null)
  }

  return <section className="plan-tool-section" aria-label="Каркас по плану">
    <strong className="plan-section-title">Каркас по плану</strong>
    {!sides.length ? <p className="plan-guidance">Для генерации нужен замкнутый прямоугольник из четырёх углов.</p> : <>
      <button type="button" className="plan-button plan-primary" data-testid="plan-frame-build" onClick={() => {
        if (plan.frame?.built || apply({ type: 'PLAN_FRAME_BUILD', payload: {} })) onBuilt()
      }}>{plan.frame?.built ? 'Открыть каркас 3D' : 'Построить каркас'}</button>
      <div className="plan-frame-fields">
        <label>Габарит X, м<input data-testid="plan-frame-width" inputMode="decimal"
          value={widthDraft} onChange={event => setWidthDraft(event.target.value)} /></label>
        <label>Габарит Z, м<input data-testid="plan-frame-depth" inputMode="decimal"
          value={depthDraft} onChange={event => setDepthDraft(event.target.value)} /></label>
      </div>
      <button type="button" className="plan-button plan-secondary" data-testid="plan-frame-resize" onClick={() => {
        const widthMm = decimalMetersToMm(widthDraft), depthMm = decimalMetersToMm(depthDraft)
        if (widthMm === null || depthMm === null || Math.min(widthMm, depthMm) < MIN_FRAME_SIDE_MM) {
          setError('Укажите оба габарита от 0,38 до 100 м с точностью 1 мм')
          return
        }
        apply({ type: 'PLAN_FRAME_RESIZE', payload: { widthMm, depthMm } })
      }}>Применить габариты</button>
      {!!(plan.graph?.edges.length || plan.interiorWalls.length) && !plan.frame?.partitions &&
        <button type="button" className="plan-button plan-secondary" data-testid="plan-frame-enable-partitions"
          onClick={() => apply({ type: 'PLAN_FRAME_ENABLE_PARTITIONS', payload: {} })}>
          Включить перегородки в каркас
        </button>}
      <details className="plan-manual-openings">
        <summary data-testid="plan-manual-openings">Точный ввод проёмов</summary>
      <div className="plan-frame-fields">
        <button type="button" className="plan-button plan-secondary" data-testid="plan-frame-add-opening"
          onClick={() => {
            if (!picking) onPick()
            setDraft({ ...planOpeningPreset('window', sides[0].wallId, ''), positionUmm: 800 })
          }}>+ Проём</button>
        <button type="button" className="plan-button plan-text" aria-pressed={picking}
          data-testid="plan-frame-pick" onClick={onPick}>Выбрать на плане</button>
      </div>
      {openings.map(opening => <button key={opening.id} type="button"
        className="plan-button plan-text" data-testid={'plan-frame-edit-' + opening.id}
        onClick={() => {
          if (!picking) onPick()
          setDraft(opening)
        }}>
        {opening.id} · {PLAN_OPENING_PRESETS.find(type => type.value === opening.type)?.label} · {opening.widthMm} мм
      </button>)}
      {draft && <div className="plan-frame-form">
        <label>Стена<select data-testid="plan-frame-opening-wall" value={draft.wallId}
          onChange={event => {
            const wallId = event.target.value
            setDraft({ ...draft, wallId, ...(isPartitionWall(wallId) && draft.type !== 'door' ? doorDefaults : {}) })
          }}>
          {sides.map(side => <option key={side.wallId} value={side.wallId}>{side.label}</option>)}
        </select></label>
        <label>Тип<select data-testid="plan-frame-opening-type" value={draft.type}
          onChange={event => changeType(event.target.value as Opening['type'])}>
          {PLAN_OPENING_PRESETS.filter(type => !isPartitionWall(draft.wallId) || type.value === 'door').map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select></label>
        <p className="plan-guidance">Отступ измеряется по стрелке от начала линии стены до начала проёма.</p>
        <div className="plan-frame-fields">
          {fields.filter(field => field.name !== 'sillHeightMm' || draft.type === 'window').map(field =>
            <label key={field.name}>{field.label}
              <input type="number" step="1" min="0" value={Number.isFinite(draft[field.name]) ? draft[field.name] : ''}
                data-testid={'plan-frame-opening-' + field.name}
                onChange={event => setDraft({ ...draft, [field.name]: event.target.valueAsNumber })} />
            </label>)}
        </div>
        <div className="plan-frame-fields">
          <button type="button" className="plan-button plan-secondary" data-testid="plan-frame-save-opening"
            onClick={save}>Сохранить проём</button>
          <button type="button" className="plan-button plan-text" onClick={() => setDraft(null)}>Закрыть</button>
        </div>
        {editing && <button type="button" className="plan-button plan-text"
          data-testid="plan-frame-remove-opening" onClick={() => {
            if (apply({ type: 'PLAN_FRAME_REMOVE_OPENING', payload: { openingId: editing.id } })) setDraft(null)
          }}>Удалить проём</button>}
      </div>}
      </details>
      {error && <div className="plan-error" role="alert" data-testid="plan-frame-error">{error}</div>}
      <p className="plan-guidance">Наружные стены · 45 × 145 мм · высота 2700 мм · шаг 600 мм.</p>
      {!plan.frame?.built && <p className="plan-guidance">Связанный каркас заменит текущую модель во вкладке 3D. Действие можно отменить.</p>}
      {plan.frame?.partitions && <p className="plan-guidance">
        Ненесущие перегородки · толщина от 89 мм · шаг стоек 400 мм · обычные двери.
      </p>}
    </>}
  </section>
}
