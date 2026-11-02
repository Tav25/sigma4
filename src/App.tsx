import { useState, useRef, useEffect } from 'react'
import { SceneView } from './scene/SceneView'
import { timberVolumeM3, type TimberElement as CoreTimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'
import type { WindowOpening } from './core/window'
import { projectToScene } from './scene/project-to-scene'
import { createProjectFromCurrentState } from './core/project-store'
import { createProjectStore, type ProjectCommand } from './core/ProjectStore'
import { rightCornerOrigin } from './core/corner'

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
  const [selectedWallId, setSelectedWallId] = useState('wall-001')
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEdges, setShowEdges] = useState(true)
  const [commandError, setCommandError] = useState<string | null>(null)
  const idCounterRef = useRef(2)

  useEffect(() => {
    const unsub = store.subscribe((doc, rev) => {
      setSnapshot(doc)
      setRevision(rev)
    })
    return unsub
  }, [])

  const wall = snapshot.building.walls.find(w => w.wallId === selectedWallId) ?? snapshot.building.walls[0]
  const mainWall = snapshot.building.walls[0]
  const hasSecondWall = snapshot.building.walls.length > 1
  // Three.js reads a projection of ProjectDocument; it does not own geometry.
  const { openings: allOpenings, elements, markers } = projectToScene(snapshot)
  const selectedOpening = allOpenings.find((o) => o.id === selectedOpeningId) ?? null
  const selectedMarker = snapshot.building.markers.find(marker => marker.openingId === selectedOpeningId) ?? null
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

  const addOpening = (type: 'window' | 'door') => {
    if (wall.wallId !== mainWall.wallId) return
    const pos = findFreePosition(allOpenings, wall.lengthMm, type === 'door' ? 900 : 450)
    if (pos === null) {
      alert('Недостаточно места для нового проёма. Увеличьте длину стены или измените размеры существующих проёмов.')
      return
    }
    idCounterRef.current += 1
    const prefix = type === 'door' ? 'D' : 'W'
    const id = prefix + String(idCounterRef.current).padStart(2, '0')
    const newOpening: WindowOpening = type === 'door'
      ? { id, positionXmm: pos, widthMm: 900, heightMm: 2100, sillHeightMm: 0, type: 'door' }
      : { id, positionXmm: pos, widthMm: 450, heightMm: 1200, sillHeightMm: 900, type: 'window' }
    
    dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: wall.wallId, opening: newOpening }
    })
    setSelectedOpeningId(newOpening.id)
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

  const addSecondWall = () => {
    if (hasSecondWall) return
    const newWall = {
      ...mainWall,
      wallId: 'wall-002',
      lengthMm: 3000,
      origin: rightCornerOrigin(mainWall, mainWall),
      orientation: 'z' as const,
      sectionMm: { ...mainWall.sectionMm },
      openings: [],
    }
    if (dispatch({ type: 'ADD_WALL', payload: { wall: newWall } }).success) {
      setSelectedWallId('wall-002')
      setSelectedOpeningId(null)
      setSelectedId(null)
    }
  }

  const removeSecondWall = () => {
    if (dispatch({ type: 'REMOVE_WALL', payload: { wallId: 'wall-002' } }).success) {
      setSelectedWallId(mainWall.wallId)
      setSelectedOpeningId(null)
      setSelectedId(null)
    }
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
          <h2 className="panel-title">Стены</h2>
          <div className="param-group" style={{ display: 'flex', gap: 6 }}>
            {snapshot.building.walls.map((item, index) => (
              <button key={item.wallId} type="button" className="param-input"
                style={{
                  cursor: 'pointer',
                  background: wall.wallId === item.wallId ? '#dbeafe' : '#fff',
                }}
                onClick={() => { setSelectedWallId(item.wallId); setSelectedOpeningId(null) }}>
                Стена {index + 1}
              </button>
            ))}
          </div>
          <div className="param-group">
            {!hasSecondWall
              ? <button type="button" className="param-input" style={{ cursor: 'pointer' }}
                  onClick={addSecondWall}>+ Добавить вторую стену</button>
              : <button type="button" className="param-input" style={{ cursor: 'pointer' }}
                  onClick={removeSecondWall}>Удалить вторую стену</button>}
          </div>
          {hasSecondWall && <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
            Угол: три примыкающие стойки 45×145 мм. Утепление — в соседней полости.
          </div>}
          <h2 className="panel-title" style={{ marginTop: 14 }}>Стена {wall.wallId === mainWall.wallId ? '1' : '2'} — параметры</h2>
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

          <h2 className="panel-title" style={{ marginTop: 16 }}>Проёмы</h2>
          <div className="param-group">
            <button type="button" className="param-input" disabled={wall.wallId !== mainWall.wallId} onClick={() => addOpening('window')} style={{ cursor: 'pointer' }}>Добавить окно</button>
            <button type="button" className="param-input" disabled={wall.wallId !== mainWall.wallId} onClick={() => addOpening('door')} style={{ cursor: 'pointer', marginLeft: 8 }}>Добавить дверь</button>
          </div>
          {wall.wallId !== mainWall.wallId && <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>Окна и двери на второй стене добавим следующим шагом.</div>}
          <div className="param-group">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Список проёмов:</div>
            {allOpenings.filter(o => snapshot.building.openings.find(opening => opening.id === o.id)?.wallId === wall.wallId).map((o) => (
              <div
                key={o.id}
                onClick={() => setSelectedOpeningId(o.id)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: selectedOpeningId === o.id ? '#dbeafe' : 'transparent',
                  fontWeight: selectedOpeningId === o.id ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {o.id} ({o.type === 'door' ? 'Дверь' : 'Окно'} X={o.positionXmm})
              </div>
            ))}
          </div>

          {selectedOpening && (
            <div className="props">
              <h3 className="props-title">
                Свойства {selectedOpening.type === 'door' ? 'дверного проёма' : 'оконного проёма'} ({selectedOpening.id})
              </h3>
              <div>ID: {selectedOpening.id}</div>
              <div>Тип: {selectedOpening.type === 'door' ? 'Дверь' : 'Окно'}</div>
              <SafeNumberInput label="Положение X (мм)" value={selectedOpening.positionXmm} onChange={(v) => updateOpening(selectedOpening.id, { positionXmm: v })} validate={(r) => validateInt(r, 135, 100000, 'положение')} />
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
                <button type="button" className="param-input" onClick={() => deleteOpening(selectedOpening.id)} style={{ cursor: 'pointer' }}>Удалить {selectedOpening.type === 'door' ? 'дверь' : 'окно'}</button>
              </div>
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
              openings={allOpenings} markers={markers} wallCount={snapshot.building.walls.length} selectedWindowId={selectedOpeningId} wallLength={mainWall.lengthMm}
              onWindowDragStart={startOpeningDrag}
              onWindowDragPreview={previewOpeningX}
              onWindowDragEnd={finishOpeningDrag}
              onWindowSelect={setSelectedOpeningId}
              onSelect={setSelectedId} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}