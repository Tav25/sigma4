import { useState, useEffect, useMemo } from 'react'
import { HorizontalSection } from './components/HorizontalSection'
import { SceneView } from './scene/SceneView'
import { FloorPlanEditor } from './components/FloorPlanEditor'
import { timberVolumeM3, type TimberElement as CoreTimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'
import type { WindowOpening } from './core/window'
import { projectToScene } from './scene/project-to-scene'
import { buildDimensionLayout } from './scene/dimension-model'
import { createProjectFromCurrentState } from './core/project-store'
import { createProjectStore, type ProjectCommand } from './core/ProjectStore'
import { rightCornerOrigin } from './core/corner'
import { firstWallExteriorLowerLeft } from './core/world-origin'
import { wallEnd, effectiveConnections } from './core/wall-topology'
import type { Wall } from './core/project'
import { ProjectTree } from './components/ProjectTree'
import { GARAGE_DOOR_PRESETS, defaultGarageDoorSpec } from './core/garage-door'
import packageInfo from '../package.json'

function findFreePosition(openings: WindowOpening[], wallLength: number, newW: number, minX = 135): number | null {
  for (let x = minX; x + newW + 90 <= wallLength; x += 50) {
    const fMin = x - 90
    const fMax = x + newW + 90
    let ok = true
    for (const o of openings) {
      const ofMin = o.positionXmm - 90
      const ofMax = o.positionXmm + o.widthMm + 90
      if (fMin < ofMax && ofMin < fMax) { ok = false; break }
    }
    if (ok) return x
  }
  return null
}

const initialDoc = createProjectFromCurrentState({
  length: 6000,
  height: 2700,
  spacing: 600,
  openings: [
    { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
    { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  ],
  projectId: 'proj-001',
  projectName: 'SIGMA4 Project',
})

const AUTO_SAVE_KEY = 'sigma4.autosave.v1'
let recoveredLocalProject = false
let recoveryError: string | null = null
const store = (() => {
  const candidate = createProjectStore(initialDoc)
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(AUTO_SAVE_KEY)
      if (saved) {
        const recovery = candidate.restoreJson(saved)
        if (recovery.success) recoveredLocalProject = true
        else recoveryError = 'Локальная копия не открыта: ' + (recovery.messageRu ?? 'ошибка JSON')
      }
    } catch {
      recoveryError = 'Не удалось прочитать локальную копию проекта'
    }
  }
  return candidate
})()

export default function App() {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot())
  const [revision, setRevision] = useState(() => store.getRevision())
  const [selectedWallId, setSelectedWallId] = useState('wall-001')
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<'plan' | 'frame'>('plan')
  const [showSection, setShowSection] = useState(false)
  const [showEdges, setShowEdges] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [commandError, setCommandError] = useState<string | null>(recoveryError)
  const [autosaveState, setAutosaveState] = useState<'saved' | 'failed'>('saved')
  const [changedSinceExport, setChangedSinceExport] = useState(false)

  useEffect(() => {
    const persist = (doc: typeof snapshot) => {
      try {
        window.localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(doc))
        setAutosaveState('saved')
      } catch {
        setAutosaveState('failed')
      }
    }
    const unsub = store.subscribe((doc, rev) => {
      setSnapshot(doc)
      setRevision(rev)
      setChangedSinceExport(true)
      persist(doc)
      // Import / Undo may remove the previously selected wall or board.
      setSelectedWallId(previous =>
        doc.building.walls.some(w => w.wallId === previous)
          ? previous : doc.building.walls[0]?.wallId ?? previous)
      setSelectedOpeningId(previous =>
        previous && doc.building.openings.some(o => o.id === previous) ? previous : null)
      setSelectedId(previous =>
        previous && doc.assembly.elements.some(e => e.elementId === previous) ? previous : null)
    })
    persist(store.getSnapshot())
    return unsub
  }, [])

  const wall = snapshot.building.walls.find(w => w.wallId === selectedWallId) ?? snapshot.building.walls[0]
  const linkedFrame = snapshot.building.floorPlan?.frame?.built === true
  const firstWall = snapshot.building.walls[0]
  const firstExteriorCorner = firstWall.orientation === 'x'
    ? firstWallExteriorLowerLeft(firstWall) : firstWall.origin
  const exteriorZeroAligned = firstWall.orientation === 'x' &&
    [firstExteriorCorner.x, firstExteriorCorner.y, firstExteriorCorner.z]
      .every(value => Math.abs(value) < 1e-6)
  const mainWall = snapshot.building.walls[0]
  const hasSecondWall = snapshot.building.walls.length > 1
  const wallLinks = effectiveConnections(snapshot)
  const wallHasParent = wallLinks.some(link => link.toWallId === wall.wallId)
  // Three.js reads a projection of ProjectDocument; it does not own geometry.
  const { openings: allOpenings, sceneOpenings, elements, markers } =
    useMemo(() => projectToScene(snapshot), [snapshot])
  const dimensions = useMemo(
    () => buildDimensionLayout(snapshot.building.walls, elements),
    [snapshot, elements],
  )
  const selectedOpening = allOpenings.find((o) => o.id === selectedOpeningId) ?? null
  const planOpening = snapshot.building.floorPlan?.frame?.openings.find(opening => opening.id === selectedOpeningId)
  const selectedMarker = snapshot.building.markers.find(marker => marker.openingId === selectedOpeningId) ?? null
  const selected = elements.find((e) => e.id === selectedId) ?? null
  const validation = snapshot.validation
  const hasErrors = validation && !validation.valid

  const dispatch = (command: ProjectCommand) => {
    const result = store.dispatch(command)
    setCommandError(result.success ? null : (result.messageRu || result.errorCode || 'Ошибка'))
    return result
  }

  const updateLength = (value: number) => {
    return dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: wall.wallId, lengthMm: value } }).success
  }

  const updateHeight = (value: number) => {
    return dispatch({ type: 'SET_WALL_HEIGHT', payload: { wallId: wall.wallId, heightMm: value } }).success
  }

  const updateSpacing = (value: number) => {
    return dispatch({ type: 'SET_STUD_SPACING', payload: { wallId: wall.wallId, studSpacingMm: value } }).success
  }

  const updateOpening = (id: string, patch: Partial<WindowOpening>) => {
    if (patch.positionXmm !== undefined) {
      dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: id, positionUmm: patch.positionXmm } })
    }
    if (patch.widthMm !== undefined) {
      dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: id, widthMm: patch.widthMm } })
    }
    if (patch.heightMm !== undefined) {
      dispatch({ type: 'SET_OPENING_HEIGHT', payload: { openingId: id, heightMm: patch.heightMm } })
    }
    if (patch.sillHeightMm !== undefined) {
      dispatch({ type: 'SET_WINDOW_SILL_HEIGHT', payload: { openingId: id, sillHeightMm: patch.sillHeightMm } })
    }
  }

  const addOpening = (type: 'window' | 'door' | 'garage-door') => {
    // Find room only among this wall's openings, in its own local U.
    const onThisWall = snapshot.building.openings
      .filter(opening => opening.wallId === wall.wallId)
      .map(opening => ({
        id: opening.id, positionXmm: opening.positionUmm,
        widthMm: opening.widthMm, heightMm: opening.heightMm,
        sillHeightMm: opening.sillHeightMm, type: opening.type,
      }))
    const isCornerFacade = wall.wallId === mainWall.wallId &&
      wallLinks.some(link => link.fromWallId === wall.wallId && link.type === 'california-right')
    const availableLength = wall.lengthMm - (isCornerFacade ? wall.sectionMm.height : 0)
    const width = type === 'garage-door' ? GARAGE_DOOR_PRESETS[0].widthMm : type === 'door' ? 900 : 450
    const pos = findFreePosition(onThisWall, availableLength, width, type === 'garage-door' ? 180 : 135)
    if (pos === null) {
      setCommandError('Недостаточно места для нового проёма. Увеличьте длину стены или измените размеры существующих проёмов.')
      return
    }
    // The counter is derived from canonical JSON, not from a session ref:
    // importing a project can never introduce duplicate W/D IDs.
    const prefix = type === 'garage-door' ? 'G' : type === 'door' ? 'D' : 'W'
    const existing = new Set(snapshot.building.openings.map(opening => opening.id))
    let number = 1
    while (existing.has(prefix + String(number).padStart(2, '0'))) number++
    const id = prefix + String(number).padStart(2, '0')
    const newOpening: WindowOpening = type === 'garage-door'
      ? { id, positionXmm: pos, widthMm: GARAGE_DOOR_PRESETS[0].widthMm,
          heightMm: GARAGE_DOOR_PRESETS[0].heightMm, sillHeightMm: 0,
          type, garage: defaultGarageDoorSpec() }
      : type === 'door'
        ? { id, positionXmm: pos, widthMm: 900, heightMm: 2100, sillHeightMm: 0, type: 'door' }
        : { id, positionXmm: pos, widthMm: 450, heightMm: 1200, sillHeightMm: 900, type: 'window' }
    
    if (dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: wall.wallId, opening: newOpening },
    }).success) {
      setSelectedOpeningId(newOpening.id)
      setSelectedId(null)
    }
  }

  const startOpeningDrag = (_id: string): boolean => store.beginTransaction()

  const previewOpeningX = (id: string, x: number): boolean => {
    const result = store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: id, positionUmm: x } })
    if (result.success) {
      const preview = store.getPreviewSnapshot()
      if (preview) setSnapshot(preview)
    }
    return result.success
  }

  const finishOpeningDrag = (_id: string, save: boolean) => {
    if (!save) {
      store.rollbackTransaction()
      setSnapshot(store.getSnapshot())
      return
    }
    const result = store.commitTransaction()
    if (!result.success) {
      store.rollbackTransaction()
      setSnapshot(store.getSnapshot())
      setCommandError(result.messageRu || 'Не удалось переместить проём')
    }
  }

  const addWall = (attached = true) => {
    const all = snapshot.building.walls
    const parent = all[all.length - 1]
    const nextNumber = Math.max(0, ...all.map(w => Number(w.wallId.match(/^wall-(\d+)$/)?.[1] ?? 0))) + 1
    const wallId = 'wall-' + String(nextNumber).padStart(3, '0')
    let wall: Wall
    let connection: { fromWallId: string; toWallId: string; type: 'california-right' | 'end-to-end' } | undefined
    if (all.length === 1 && attached) {
      wall = {
        ...parent, wallId, lengthMm: 3000,
        origin: rightCornerOrigin(parent, parent),
        orientation: 'z', sectionMm: { ...parent.sectionMm }, openings: [],
      }
      connection = { fromWallId: parent.wallId, toWallId: wallId, type: 'california-right' }
    } else {
      // A chain of straight end-to-end joints can be extended to any number
      // of walls. Isolated walls are positioned with a clearance from the
      // existing model and can subsequently be moved by coordinates.
      const start = attached ? wallEnd(parent) : {
        x: Math.max(...all.map(item => item.origin.x + item.lengthMm)) + 1000,
        y: parent.origin.y,
        z: parent.origin.z,
      }
      wall = {
        ...parent, wallId, lengthMm: 3000, origin: start,
        sectionMm: { ...parent.sectionMm }, openings: [],
      }
      if (attached) {
        connection = { fromWallId: parent.wallId, toWallId: wallId, type: 'end-to-end' }
      }
    }
    if (dispatch({ type: 'ADD_WALL', payload: { wall, connection } }).success) {
      setSelectedWallId(wallId)
      setSelectedOpeningId(null)
      setSelectedId(null)
    }
  }

  const removeLastWall = () => {
    const all = snapshot.building.walls
    if (all.length <= 1) return
    const last = all[all.length - 1]
    if (dispatch({ type: 'REMOVE_WALL', payload: { wallId: last.wallId } }).success) {
      setSelectedWallId(all[all.length - 2].wallId)
      setSelectedOpeningId(null)
      setSelectedId(null)
    }
  }

  const moveWall = (axis: 'x' | 'z', value: number) => {
    return dispatch({ type: 'SET_WALL_ORIGIN', payload: {
      wallId: wall.wallId, origin: { ...wall.origin, [axis]: value },
    } }).success
  }

  const deleteOpening = (id: string) => {
    if (selectedOpeningId === id) setSelectedOpeningId(null)
    dispatch({ type: 'REMOVE_OPENING', payload: { openingId: id } })
  }

  const exportJson = () => {
    const json = store.exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'project.sigma4.json'
    a.click()
    URL.revokeObjectURL(url)
    setChangedSinceExport(false)
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result
      if (typeof result === 'string') {
        const importResult = store.importJson(result)
        setCommandError(importResult.success ? null :
          (importResult.messageRu || importResult.errorCode || 'Ошибка импорта'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const dirText = (el: CoreTimberElement) => {
    const m = el.orientation.mode
    if (m === 'x') return 'X'
    if (m === 'y') return 'Y'
    if (m === 'z') return 'Z'
    return 'slope ' + el.orientation.angle
  }

  const undo = () => store.undo()
  const redo = () => store.redo()
  const canUndo = store.canUndo()
  const canRedo = store.canRedo()

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-title">SIGMA4</span>
        <span className="app-version">{packageInfo.version}</span>
        <nav className="workspace-tabs" aria-label="Режим работы">
          <button type="button" data-testid="tab-plan" role="tab"
            aria-selected={workspace === 'plan'} onClick={() => setWorkspace('plan')}>
            План 2D
          </button>
          <button type="button" data-testid="tab-frame" role="tab"
            aria-selected={workspace === 'frame'} onClick={() => setWorkspace('frame')}>
            Каркас 3D
          </button>
        </nav>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button onClick={undo} disabled={!canUndo} title="Отменить">↶</button>
          <button onClick={redo} disabled={!canRedo} title="Повторить">↷</button>
          <span className="project-autosave" role="status">
            {autosaveState === 'failed' ? 'Автосохранение недоступно' :
              recoveredLocalProject ? 'Локальная копия восстановлена' : 'Автосохранено в браузере'}
          </span>
          <button type="button" className="project-save-button" onClick={exportJson}
            title="Скачать текущий JSON-файл проекта">
            Сохранить JSON{changedSinceExport ? ' •' : ''}
          </button>
          <span className="project-revision">Rev: {revision}</span>
        </div>
      </header>
      <input type="file" accept=".sigma4.json,.json" onChange={handleImportJson}
        style={{ display: 'none' }} id="import-file" />
      {commandError && <div className="global-command-error" role="alert">
        <span>{commandError}</span>
        <button type="button" aria-label="Закрыть сообщение" onClick={() => setCommandError(null)}>×</button>
      </div>}
      <div className="plan-host" style={{ display: workspace === 'plan' ? 'flex' : 'none' }}
        aria-hidden={workspace !== 'plan'}>
        <ErrorBoundary>
          <FloorPlanEditor plan={snapshot.building.floorPlan}
            onCommand={dispatch} onExport={exportJson} onUndo={undo} onRedo={redo}
            onImport={() => document.getElementById('import-file')?.click()}
            onFrameBuilt={() => setWorkspace('frame')} />
        </ErrorBoundary>
      </div>
      <div className="main" style={{ display: workspace === 'frame' ? 'flex' : 'none' }}
        aria-hidden={workspace !== 'frame'}>
        <aside className="left-panel">
          <div style={{ fontSize: 11, padding: '8px 9px', border: '1px solid #d8e2ee',
            borderRadius: 7, background: '#edf5fc', color: '#3c647f', marginBottom: 12 }}>
            {linkedFrame ? <>
              Каркас стен построен по плану. Размеры и проёмы редактируются в 2D.
              <button type="button" className="plan-button plan-secondary" onClick={() => setWorkspace('plan')}>
                Редактировать план
              </button>
            </> : 'Самостоятельный 3D-каркас. Связанный каркас можно построить из прямоугольника во вкладке «План 2D».'}
          </div>
          <h2 className="panel-title">Дерево проекта</h2>
          <ProjectTree
            document={snapshot}
            selectedWallId={wall.wallId}
            selectedOpeningId={selectedOpeningId}
            selectedElementId={selectedId}
            onSelectWall={(wallId) => {
              setSelectedWallId(wallId)
              setSelectedOpeningId(null)
              setSelectedId(null)
            }}
            onSelectOpening={(wallId, openingId) => {
              setSelectedWallId(wallId)
              setSelectedOpeningId(openingId)
              setSelectedId(null)
            }}
            onSelectElement={(wallId, elementId) => {
              setSelectedWallId(wallId)
              setSelectedId(elementId)
              setSelectedOpeningId(null)
            }}
          />
          {!linkedFrame && <>
          <h2 className="panel-title" style={{ marginTop: 16 }}>Стены</h2>
          <div className="param-group">
            <button type="button" className="param-input" style={{ cursor: 'pointer' }}
              onClick={() => addWall(true)}>
              {hasSecondWall ? '+ Продолжить стену' : '+ Добавить вторую стену'}
            </button>
            <button type="button" className="param-input"
              style={{ cursor: 'pointer', marginTop: 5 }}
              onClick={() => addWall(false)}>+ Свободная стена</button>
            {hasSecondWall && (
              <button type="button" className="param-input" style={{ cursor: 'pointer', marginTop: 5 }}
                onClick={removeLastWall}>
                Удалить {snapshot.building.walls.length === 2 ? 'вторую стену' : 'последнюю стену'}
              </button>
            )}
          </div>
          {hasSecondWall && <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
            Калифорнийский угол первой пары стен сохранён. Остальные связи — прямой стык.
          </div>}
          <h2 className="panel-title" style={{ marginTop: 14 }}>
            Стена {snapshot.building.walls.findIndex(w => w.wallId === wall.wallId) + 1} — параметры
          </h2>
          <div className="param-group">
            <SafeNumberInput label="Длина (мм)" value={wall.lengthMm} onChange={updateLength} validate={(r) => validateWallLength(r)} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Высота (мм)" value={wall.heightMm} onChange={updateHeight} validate={(r) => validateInt(r, 300, 10000, 'высоту')} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Шаг стоек (мм)" value={wall.studSpacingMm} onChange={updateSpacing} validate={(r) => validateInt(r, 100, 5000, 'шаг')} />
          </div>
          <div className="param-group">
            <div>Направление: {wall.orientation === 'z' ? '−Z' : '+X'}</div>
            <label className="param-label" htmlFor="wall-axis">Ось стены</label>
            <select id="wall-axis" className="param-input" value={wall.orientation}
              disabled={wallLinks.some(link => link.fromWallId === wall.wallId ||
                link.toWallId === wall.wallId)}
              onChange={event => dispatch({ type: 'SET_WALL_AXIS', payload: {
                wallId: wall.wallId, orientation: event.target.value as 'x' | 'z',
              } })}>
              <option value="x">Вдоль +X</option>
              <option value="z">Вдоль −Z</option>
            </select>
            <div>Координаты начала: X={wall.origin.x}, Y={wall.origin.y}, Z={wall.origin.z} мм</div>
            {wallHasParent
              ? <div style={{ color: '#666', fontSize: 12, marginTop: 5 }}>
                  Положение закреплено соединением с предыдущей стеной
                </div>
              : <>
                  <SafeNumberInput label="Начало X (мм)" value={wall.origin.x}
                    onChange={v => moveWall('x', v)}
                    validate={r => validateInt(r, -100000, 100000, 'координату X')} />
                  <SafeNumberInput label="Начало Z (мм)" value={wall.origin.z}
                    onChange={v => moveWall('z', v)}
                    validate={r => validateInt(r, -100000, 100000, 'координату Z')} />
                </>
            }
          </div>
          <div className="param-group">
            <label className="param-label">Сечение</label>
            <input type="text" className="param-input" value="45x145" readOnly />
          </div>
          </>}
          <div className="param-group">
            <div>Количество элементов: {elements.length}</div>
            <div>Количество стен: {snapshot.building.walls.length}</div>
            {linkedFrame
              ? <div>Наружные габариты: {Math.round(dimensions.overallXmm)} × {Math.round(dimensions.overallZmm)} мм</div>
              : <div>Соединения: {wallLinks.length}</div>}
          </div>
          <div className="param-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />
              Показывать рёбра
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 9 }}>
              <input type="checkbox" data-testid="show-wall-dimensions"
                checked={showDimensions} onChange={e => setShowDimensions(e.target.checked)} />
              Показывать размеры стен
            </label>
          </div>

          {(!linkedFrame || selectedOpening) && <h2 className="panel-title" style={{ marginTop: 16 }}>Проёмы</h2>}
          {!linkedFrame && <div className="param-group">
            <button type="button" className="param-input" onClick={() => addOpening('window')} style={{ cursor: 'pointer' }}>Добавить окно</button>
            <button type="button" className="param-input" onClick={() => addOpening('door')} style={{ cursor: 'pointer', marginLeft: 8 }}>Добавить дверь</button>
            <button type="button" className="param-input" data-testid="add-garage-door"
              onClick={() => addOpening('garage-door')} style={{ cursor: 'pointer', marginTop: 6 }}>
              + Гаражные ворота
            </button>
          </div>}
          {selectedOpening && (
            <div className="props">
              <h3 className="props-title">
                Свойства {selectedOpening.type === 'garage-door' ? 'гаражных ворот' : selectedOpening.type === 'door' ? 'дверного проёма' : 'оконного проёма'} ({selectedOpening.id})
              </h3>
              <div>ID: {selectedOpening.id}</div>
              <div>Тип: {selectedOpening.type === 'garage-door' ? 'Гаражные секционные ворота' : selectedOpening.type === 'door' ? 'Дверь' : 'Окно'}</div>
              {linkedFrame ? <>
                <div>Размер: {selectedOpening.widthMm} × {selectedOpening.heightMm} мм</div>
                <div>От начала линии стены: {planOpening?.positionUmm} мм</div>
              </> : <>
              {selectedOpening.type === 'garage-door' && (
                <div style={{ margin: '8px 0', fontSize: 12 }}>
                  <label className="param-label" htmlFor="garage-preset">Североамериканский размер</label>
                  <select id="garage-preset" className="param-input"
                    value={GARAGE_DOOR_PRESETS.find(p => p.widthMm === selectedOpening.widthMm &&
                      p.heightMm === selectedOpening.heightMm)?.label ?? ''}
                    onChange={event => {
                      const preset = GARAGE_DOOR_PRESETS.find(p => p.label === event.target.value)
                      if (preset) {
                        updateOpening(selectedOpening.id, { widthMm: preset.widthMm })
                        if (selectedOpening.heightMm !== preset.heightMm)
                          updateOpening(selectedOpening.id, { heightMm: preset.heightMm })
                      }
                    }}>
                    <option value="">Индивидуальный размер</option>
                    {GARAGE_DOOR_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                  </select>
                  <div style={{ marginTop: 8 }}>
                    Профиль: Clopay, стандартные торсионные направляющие (справочный)
                  </div>
                  <div>Требуется сбоку: ≥ {selectedOpening.garage?.minSideRoomMm} мм с каждой стороны</div>
                  <div>Требуется сверху: ≥ {selectedOpening.garage?.minHeadRoomMm} мм</div>
                  <div>Требуется в глубину: ≥ {selectedOpening.heightMm +
                    (selectedOpening.garage?.minBackRoomExtraMm ?? 0)} мм</div>
                  <div style={{ marginTop: 7, color: '#a25a00' }}>
                    Перемычка {selectedOpening.garage?.lintelPreviewDepthMm} мм и
                    {' '}{selectedOpening.garage?.jackStudsPerSide} опорные стойки на сторону — предварительная компоновка.
                    Несущая способность, portal frame и реальные зазоры НЕ проверены.
                  </div>
                </div>
              )}
              <SafeNumberInput label="Положение вдоль стены U (мм)" value={selectedOpening.positionXmm} onChange={(v) => updateOpening(selectedOpening.id, { positionXmm: v })} validate={(r) => validateInt(r, 135, 100000, 'положение')} />
              <SafeNumberInput label="Ширина (мм)" value={selectedOpening.widthMm} onChange={(v) => updateOpening(selectedOpening.id, { widthMm: v })} validate={(r) => validateInt(r, 300, 5000, 'ширина')} />
              <SafeNumberInput label="Высота (мм)" value={selectedOpening.heightMm} onChange={(v) => updateOpening(selectedOpening.id, { heightMm: v })} validate={(r) => validateInt(r, 300, 5000, 'высота')} />
              {selectedOpening.type === 'window' && (
                <SafeNumberInput label="Высота подоконника (мм)" value={selectedOpening.sillHeightMm} onChange={(v) => updateOpening(selectedOpening.id, { sillHeightMm: v })} validate={(r) => validateInt(r, 300, 5000, 'высота подоконника')} />
              )}
              {selectedMarker && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={selectedMarker.visible}
                    onChange={e => dispatch({
                      type: 'SET_MARKER_SETTINGS',
                      payload: { openingId: selectedOpening.id, visible: e.target.checked },
                    })} />
                  Показывать маркер проёма
                </label>
              )}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="param-input" onClick={() => deleteOpening(selectedOpening.id)} style={{ cursor: 'pointer' }}>Удалить {selectedOpening.type === 'garage-door' ? 'гаражные ворота' : selectedOpening.type === 'door' ? 'дверь' : 'окно'}</button>
              </div>
              </>}
            </div>
          )}

          <h2 className="panel-title" style={{ marginTop: 16 }}>Проект</h2>
          <div className="param-group" style={{ fontSize: 12 }} data-testid="first-wall-exterior-corner">
            {linkedFrame ? 'Начало первой панели:' : 'Нижний левый наружный угол стены 1:'}
            X={firstExteriorCorner.x}, Y={firstExteriorCorner.y}, Z={firstExteriorCorner.z} мм
          </div>
          {!linkedFrame && !exteriorZeroAligned && (
            <div className="param-group">
              <button type="button" data-testid="anchor-first-wall-to-zero"
                className="param-input" style={{ cursor: 'pointer' }}
                onClick={() => dispatch({ type: 'ANCHOR_FIRST_WALL_AT_ZERO', payload: {} })}>
                Установить угол стены 1 в (0, 0, 0)
              </button>
            </div>
          )}
          <div className="param-group">
            <button type="button" className="param-input" onClick={exportJson} style={{ cursor: 'pointer' }}>Экспорт JSON</button>
          </div>
          <div className="param-group">
            <button type="button" className="param-input" onClick={() => document.getElementById('import-file')?.click()} style={{ cursor: 'pointer' }}>Импорт JSON</button>
          </div>
          {commandError && (
            <div style={{ color: '#cc0000', margin: '8px 0', fontSize: 12 }}>{commandError}</div>
          )}
          <div className="props" style={{ fontSize: 12 }}>
            <div>Project ID: {snapshot.project.projectId}</div>
            <div>Schema: {snapshot.project.schemaVersion}</div>
            <div>Ruleset: {snapshot.project.rulesetVersion}</div>
            <div>Generator: {snapshot.project.generatorVersion}</div>
            <div style={{ color: hasErrors ? '#cc0000' : '#006600', marginTop: 4 }}>
              Валидация: {validation?.valid ? 'OK' : 'ОШИБКИ'}
            </div>
            {linkedFrame && <div data-testid="structural-validator-summary" style={{ marginTop: 4 }}>
              Геометрический контроль каркаса: {validation?.issues.filter(i =>
                i.code.startsWith('STRUCTURAL_') && i.severity === 'error').length ?? 0} ошибок
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                Проверяются контакты, пересечения и опоры досок.
              </div>
            </div>}
            {linkedFrame && <div>Инженерный расчёт: не выполнен</div>}
            {snapshot.building.openings.some(o => o.type === 'garage-door') && (
              <div style={{ color: '#a25a00', marginTop: 4 }}>
                Гаражные ворота: расчёт несущей перемычки и пространственной жёсткости не выполнен.
              </div>
            )}
            {hasErrors && validation?.issues.length && (
              <div style={{ marginTop: 4 }}>
                {validation.issues.filter(i => i.severity === 'error').slice(0, 3).map((i, idx) => (
                  <div key={idx} style={{ color: '#cc0000' }}>{i.messageRu}</div>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="props">
              <h3 className="props-title">Свойства детали</h3>
              <div>ID: {selected.id}</div>
              <div>Роль: {selected.role}</div>
              <div>Длина: {selected.length} мм</div>
              <div>Сечение: {selected.width}x{selected.height} мм</div>
              <div>Объём: {timberVolumeM3(selected).toFixed(6)} м³</div>
              <div>Направление: {dirText(selected)}</div>
              <div>Угол roll: {selected.orientation.roll}</div>
              <div>Опорная точка: {selected.position.x}, {selected.position.y}, {selected.position.z} мм</div>
            </div>
          )}
        </aside>
        <main className="viewport-wrap">
          {elements.length > 0 &&
            <button type="button" className="frame-section-toggle" data-testid="frame-section-toggle"
              onClick={() => setShowSection(value => !value)}>{showSection ? 'Вернуться в 3D' : 'Горизонтальный разрез'}</button>}
          {elements.length > 0 && <div className="section-host"
            style={{ display: showSection ? 'flex' : 'none' }}>
            <HorizontalSection elements={elements} selectedId={selectedId}
              onSelect={id => { setSelectedId(id); if (id) setSelectedOpeningId(null) }} />
          </div>}
          <ErrorBoundary>
            <SceneView elements={elements} selectedId={selectedId} showEdges={showEdges}
              active={workspace === 'frame' && !showSection}
              canDragOpenings={!linkedFrame}
              openings={sceneOpenings} markers={markers} wallCount={snapshot.building.walls.length}
              dimensions={dimensions} showDimensions={showDimensions}
              selectedWindowId={selectedOpeningId}
              onWindowDragStart={linkedFrame ? () => false : startOpeningDrag}
              onWindowDragPreview={previewOpeningX}
              onWindowDragEnd={finishOpeningDrag}
              onWindowSelect={id => {
                setSelectedOpeningId(id)
                if (id) setSelectedId(null)
                if (id) {
                  const opening = store.getSnapshot().building.openings.find(item => item.id === id)
                  if (opening) setSelectedWallId(opening.wallId)
                }
              }}
              onSelect={id => {
                setSelectedId(id)
                if (id) setSelectedOpeningId(null)
              }} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}