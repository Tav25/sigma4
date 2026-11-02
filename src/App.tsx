import { useState, useRef, useEffect } from 'react'
import { SceneView } from './scene/SceneView'
import { timberVolumeM3, type TimberElement as CoreTimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'
import type { WindowOpening } from './core/window'
import type { TimberElement, Opening } from './core/project'
import { createProjectFromCurrentState } from './core/project-store'
import { createProjectStore, type ProjectCommand } from './core/ProjectStore'

function findFreePosition(openings: WindowOpening[], wallLength: number, newW: number): number | null {
  for (let x = 135; x + newW + 90 <= wallLength; x += 50) {
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

function convertToCoreTimber(el: TimberElement): CoreTimberElement {
  return {
    id: el.elementId,
    role: el.role,
    length: el.lengthMm,
    width: el.sectionMm.width,
    height: el.sectionMm.height,
    position: el.position,
    orientation: el.orientation,
    material: 'wood',
  }
}

function convertOpeningsToWindow(openings: Opening[]): WindowOpening[] {
  return openings.map(o => ({
    id: o.id,
    positionXmm: o.positionUmm,
    widthMm: o.widthMm,
    heightMm: o.heightMm,
    sillHeightMm: o.sillHeightMm,
    type: o.type,
  }))
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

const store = createProjectStore(initialDoc)

export default function App() {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot())
  const [revision, setRevision] = useState(() => store.getRevision())
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEdges, setShowEdges] = useState(true)
  const [doorEnabled, setDoorEnabled] = useState(false)
  const [doorParams, setDoorParams] = useState({ positionXmm: 3000, widthMm: 900, heightMm: 2100 })
  const [commandError, setCommandError] = useState<string | null>(null)
  const idCounterRef = useRef(2)

  useEffect(() => {
    const unsub = store.subscribe((doc, rev) => {
      setSnapshot(doc)
      setRevision(rev)
    })
    return unsub
  }, [])

  const wall = snapshot.building.walls[0]
  const allOpeningsCore = doorEnabled
    ? [...snapshot.building.openings, { id: 'D01', wallId: wall.wallId, positionUmm: doorParams.positionXmm, widthMm: doorParams.widthMm, heightMm: doorParams.heightMm, sillHeightMm: 0, type: 'door' as const }]
    : snapshot.building.openings

  const allOpenings = convertOpeningsToWindow(allOpeningsCore)
  const elements = snapshot.assembly.elements.map(convertToCoreTimber)
  const selectedWindow = allOpenings.find((o) => o.id === selectedWindowId) ?? null
  const selected = elements.find((e) => e.id === selectedId) ?? null
  const validation = snapshot.validation
  const hasErrors = validation && !validation.valid

  const dispatch = (command: ProjectCommand) => {
    const result = store.dispatch(command)
    if (!result.success) {
      setCommandError(result.messageRu || result.errorCode || 'Ошибка')
      setTimeout(() => setCommandError(null), 3000)
    }
    return result
  }

  const updateLength = (value: number) => {
    dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: wall.wallId, lengthMm: value } })
  }

  const updateHeight = (value: number) => {
    dispatch({ type: 'SET_WALL_HEIGHT', payload: { wallId: wall.wallId, heightMm: value } })
  }

  const updateSpacing = (value: number) => {
    dispatch({ type: 'SET_STUD_SPACING', payload: { wallId: wall.wallId, studSpacingMm: value } })
  }

  const updateWindow = (id: string, patch: Partial<WindowOpening>) => {
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

  const updateDoor = (patch: Partial<WindowOpening>) => {
    setDoorParams((prev) => ({ ...prev, ...patch }))
  }

  const addWindow = () => {
    const pos = findFreePosition(allOpenings, wall.lengthMm, 450)
    if (pos === null) {
      alert('Недостаточно места для нового окна. Увеличьте длину стены или измените размеры существующих проёмов.')
      return
    }
    idCounterRef.current += 1
    const id = 'W' + String(idCounterRef.current).padStart(2, '0')
    const newWin: WindowOpening = { id, positionXmm: pos, widthMm: 450, heightMm: 1200, sillHeightMm: 900, type: 'window' }
    console.log('Add window:', newWin)
  }

  const deleteWindow = (id: string) => {
    if (selectedWindowId === id) setSelectedWindowId(null)
    console.log('Delete window:', id)
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
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result
      if (typeof result === 'string') {
        const importResult = store.importJson(result)
        if (!importResult.success) {
          setCommandError(importResult.messageRu || importResult.errorCode || 'Ошибка импорта')
          setTimeout(() => setCommandError(null), 3000)
        }
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
        <span className="app-version">0.0.14</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button onClick={undo} disabled={!canUndo} title="Отменить">↶</button>
          <button onClick={redo} disabled={!canRedo} title="Повторить">↷</button>
          <span style={{ fontSize: 12, color: '#666', paddingTop: 4 }}>Rev: {revision}</span>
        </div>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Стена</h2>
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
            <label className="param-label">Сечение</label>
            <input type="text" className="param-input" value="45x145" readOnly />
          </div>
          <div className="param-group">
            <div>Количество элементов: {elements.length}</div>
          </div>
          <div className="param-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />
              Показывать рёбра
            </label>
          </div>

          <h2 className="panel-title" style={{ marginTop: 16 }}>Оконный проём</h2>
          <div className="param-group">
            <button type="button" className="param-input" onClick={addWindow} style={{ cursor: 'pointer' }}>Добавить окно</button>
          </div>
          <div className="param-group">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Количество элементов:</div>
            {snapshot.building.openings.map((o) => (
              <div
                key={o.id}
                onClick={() => setSelectedWindowId(o.id)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: selectedWindowId === o.id ? '#dbeafe' : 'transparent',
                  fontWeight: selectedWindowId === o.id ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {o.id} (X={o.positionUmm})
              </div>
            ))}
          </div>

          {selectedWindow && (
            <div className="props">
              <h3 className="props-title">Свойства детали ({selectedWindow.id})</h3>
              <div>ID: {selectedWindow.id}</div>
              <SafeNumberInput label="Положение окна X (мм)" value={selectedWindow.positionXmm} onChange={(v) => updateWindow(selectedWindow.id, { positionXmm: v })} validate={(r) => validateInt(r, 135, 100000, 'положение')} />
              <SafeNumberInput label="Ширина окна (мм)" value={selectedWindow.widthMm} onChange={(v) => updateWindow(selectedWindow.id, { widthMm: v })} validate={(r) => validateInt(r, 300, 5000, 'ширина')} />
              <SafeNumberInput label="Высота окна (мм)" value={selectedWindow.heightMm} onChange={(v) => updateWindow(selectedWindow.id, { heightMm: v })} validate={(r) => validateInt(r, 300, 5000, 'высота')} />
              <SafeNumberInput label="Высота подоконника (мм)" value={selectedWindow.sillHeightMm} onChange={(v) => updateWindow(selectedWindow.id, { sillHeightMm: v })} validate={(r) => validateInt(r, 300, 5000, 'высота подоконника')} />
              <div style={{ marginTop: 8 }}>
                <button type="button" className="param-input" onClick={() => deleteWindow(selectedWindow.id)} style={{ cursor: 'pointer' }}>Удалить окно</button>
              </div>
            </div>
          )}

          <h2 className="panel-title" style={{ marginTop: 16 }}>Дверной проём</h2>
          <div className="param-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={doorEnabled} onChange={(e) => setDoorEnabled(e.target.checked)} />
              Добавить дверь
            </label>
          </div>
          {doorEnabled && (
            <div className="props">
              <div>ID: D01</div>
              <SafeNumberInput label="Положение X (мм)" value={doorParams.positionXmm} onChange={(v) => updateDoor({ positionXmm: v })} validate={(r) => validateInt(r, 135, 100000, 'положение')} />
              <SafeNumberInput label="Ширина (мм)" value={doorParams.widthMm} onChange={(v) => updateDoor({ widthMm: v })} validate={(r) => validateInt(r, 600, 5000, 'ширина')} />
              <SafeNumberInput label="Высота (мм)" value={doorParams.heightMm} onChange={(v) => updateDoor({ heightMm: v })} validate={(r) => validateInt(r, 1600, 5000, 'высота')} />
            </div>
          )}

          <h2 className="panel-title" style={{ marginTop: 16 }}>Проект</h2>
          <div className="param-group">
            <button type="button" className="param-input" onClick={exportJson} style={{ cursor: 'pointer' }}>Экспорт JSON</button>
          </div>
          <div className="param-group">
            <input type="file" accept=".sigma4.json,.json" onChange={handleImportJson} style={{ display: 'none' }} id="import-file" />
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
          <ErrorBoundary>
            <SceneView elements={elements} selectedId={selectedId} showEdges={showEdges}
              openings={allOpenings} selectedWindowId={selectedWindowId} wallLength={wall.lengthMm}
              onWindowXChange={(id, x) => {
                if (id.startsWith('D')) setDoorParams((prev) => ({ ...prev, positionXmm: x }))
                else updateWindow(id, { positionXmm: x })
              }}
              onWindowSelect={setSelectedWindowId}
              onSelect={setSelectedId} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}