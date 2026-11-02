import { useState, useMemo, useRef, useEffect } from 'react'
import { SceneView } from './scene/SceneView'
import { generateWallPanel } from './core/wall'
import { generateWallWithOpenings, type WindowOpening } from './core/window'
import { timberVolumeM3, type TimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'
import type { ProjectDocument } from './core/project'
import { createProjectFromCurrentState, serializeProject } from './core/project-store'

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

export default function App() {
  const [length, setLength] = useState(6000)
  const [height, setHeight] = useState(2700)
  const [spacing, setSpacing] = useState(600)
  const [openings, setOpenings] = useState<WindowOpening[]>([
    { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
    { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  ])
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEdges, setShowEdges] = useState(true)
  const [doorEnabled, setDoorEnabled] = useState(false)
  const [doorParams, setDoorParams] = useState({ positionXmm: 3000, widthMm: 900, heightMm: 2100 })
  const [projectDoc, setProjectDoc] = useState<ProjectDocument | null>(null)
  const idCounterRef = useRef(2)

  const selectedWindow = openings.find((o) => o.id === selectedWindowId) ?? null

  const params = { length, height, sectionWidth: 45, sectionHeight: 145, spacing, topLayers: 2 }
  const allOpenings = doorEnabled ? [...openings, { id: 'D01', positionXmm: doorParams.positionXmm, widthMm: doorParams.widthMm, heightMm: doorParams.heightMm, sillHeightMm: 0, type: 'door' } as WindowOpening] : openings

  const assembly = useMemo(() => {
    try {
      const a = allOpenings.length > 0 ? generateWallWithOpenings(params, allOpenings) : generateWallPanel(params)
      return a
    } catch (e) {
      console.error('Wall generation error:', e)
      return null
    }
  }, [length, height, spacing, openings, doorEnabled, doorParams])

  const elements = assembly ? assembly.elements : []

  useEffect(() => {
    const doc = createProjectFromCurrentState({ length, height, spacing, openings: allOpenings, projectName: 'SIGMA4 Project' })
    setProjectDoc(doc)
  }, [length, height, spacing, openings, doorEnabled, doorParams])

  const selected = elements.find((e) => e.id === selectedId) ?? null
  useEffect(() => { if (selectedId && !elements.find((e) => e.id === selectedId)) setSelectedId(null) }, [elements, selectedId])

  const updateWindow = (id: string, patch: Partial<WindowOpening>) => {
    setOpenings((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }
  const updateDoor = (patch: Partial<WindowOpening>) => {
    setDoorParams((prev) => ({ ...prev, ...patch }))
  }

  const addWindow = () => {
    const pos = findFreePosition(openings, length, 450)
    if (pos === null) {
      alert('Недостаточно места для нового окна. Увеличьте длину стены или измените размеры существующих проёмов.')
      return
    }
    idCounterRef.current += 1
    const id = 'W' + String(idCounterRef.current).padStart(2, '0')
    const newWin: WindowOpening = { id, positionXmm: pos, widthMm: 450, heightMm: 1200, sillHeightMm: 900, type: 'window' }
    setOpenings((prev) => [...prev, newWin])
    setSelectedWindowId(newWin.id)
  }

  const deleteWindow = (id: string) => {
    setOpenings((prev) => prev.filter((o) => o.id !== id))
    if (selectedWindowId === id) setSelectedWindowId(null)
  }

  const exportJson = () => {
    if (projectDoc) {
      const json = serializeProject(projectDoc)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'project.sigma4.json'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const dirText = (el: TimberElement) => {
    const m = el.orientation.mode
    if (m === 'x') return 'X'
    if (m === 'y') return 'Y'
    if (m === 'z') return 'Z'
    return 'slope ' + el.orientation.angle
  }

  const validation = projectDoc?.validation
  const hasErrors = validation && !validation.valid

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-title">SIGMA4</span>
        <span className="app-version">0.0.14</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Стена</h2>
          <div className="param-group">
            <SafeNumberInput label="Длина (мм)" value={length} onChange={setLength} validate={(r) => validateWallLength(r)} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Высота (мм)" value={height} onChange={setHeight} validate={(r) => validateInt(r, 300, 10000, 'высоту')} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Шаг стоек (мм)" value={spacing} onChange={setSpacing} validate={(r) => validateInt(r, 100, 5000, 'шаг')} />
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
            {openings.map((o) => (
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
                {o.id} (X={o.positionXmm})
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
          {projectDoc && (
            <div className="props" style={{ fontSize: 12 }}>
              <div>Project ID: {projectDoc.project.projectId}</div>
              <div>Schema: {projectDoc.project.schemaVersion}</div>
              <div>Ruleset: {projectDoc.project.rulesetVersion}</div>
              <div>Generator: {projectDoc.project.generatorVersion}</div>
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
          )}

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
              openings={allOpenings} selectedWindowId={selectedWindowId} wallLength={length}
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