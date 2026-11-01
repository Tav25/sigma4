
import { useState, useMemo, useRef, useEffect } from 'react'
import { SceneView } from './scene/SceneView'
import { generateWallPanel } from './core/wall'
import { generateWallWithOpenings } from './core/window'
import { timberVolumeM3, type TimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'
import type { WindowOpening } from './core/window'

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
  const idCounterRef = useRef(2)

  const selectedWindow = openings.find((o) => o.id === selectedWindowId) ?? null

  const params = { length, height, sectionWidth: 45, sectionHeight: 145, spacing, topLayers: 2 }
  const defaultAssembly = useMemo(() => generateWallPanel({ length: 3000, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 }), [])
  const lastElementsRef = useRef(defaultAssembly.elements)
  const assembly = useMemo(() => {
    try {
      const a = openings.length > 0 ? generateWallWithOpenings(params, openings) : generateWallPanel(params)
      lastElementsRef.current = a.elements
      return a
    } catch (e) {
      console.error('Wall generation error:', e)
      return null
    }
  }, [length, height, spacing, openings])
  const elements = assembly ? assembly.elements : lastElementsRef.current
  const selected = elements.find((e) => e.id === selectedId) ?? null
  useEffect(() => { if (selectedId && !elements.find((e) => e.id === selectedId)) setSelectedId(null) }, [elements, selectedId])


  const updateWindow = (id: string, patch: Partial<WindowOpening>) => {
    setOpenings((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const addWindow = () => {
    const pos = findFreePosition(openings, length, 450)
    if (pos === null) {
      alert('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043c\u0435\u0441\u0442\u0430 \u0434\u043b\u044f \u043d\u043e\u0432\u043e\u0433\u043e \u043e\u043a\u043d\u0430. \u0423\u0432\u0435\u043b\u0438\u0447\u044c\u0442\u0435 \u0434\u043b\u0438\u043d\u0443 \u0441\u0442\u0435\u043d\u044b \u0438\u043b\u0438 \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u0435 \u0440\u0430\u0437\u043c\u0435\u0440\u044b \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0445 \u043f\u0440\u043e\u0451\u043c\u043e\u0432.')
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

  const dirText = (el: TimberElement) => {
    const m = el.orientation.mode
    if (m === 'x') return 'X'
    if (m === 'y') return 'Y'
    if (m === 'z') return 'Z'
    return 'slope ' + el.orientation.angle
  }

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-title">Конструктор каркасных строений</span>
        <span className="app-version">0.0.11.1</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Стена</h2>
          <div className="param-group">
            <SafeNumberInput label="Длина (мм)" value={length} onChange={setLength} validate={(r) => validateWallLength(r)} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Высота (мм)" value={height} onChange={setHeight} validate={(r) => validateInt(r, 300, 10000, '\u0432\u044b\u0441\u043e\u0442\u0443')} />
          </div>
          <div className="param-group">
            <SafeNumberInput label="Шаг стоек (мм)" value={spacing} onChange={setSpacing} validate={(r) => validateInt(r, 100, 5000, '\u0448\u0430\u0433')} />
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
              <SafeNumberInput label="Положение окна X (мм)" value={selectedWindow.positionXmm} onChange={(v) => updateWindow(selectedWindow.id, { positionXmm: v })} validate={(r) => validateInt(r, 135, 100000, '\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435')} />
              <SafeNumberInput label="Ширина окна (мм)" value={selectedWindow.widthMm} onChange={(v) => updateWindow(selectedWindow.id, { widthMm: v })} validate={(r) => validateInt(r, 300, 5000, '\u0448\u0438\u0440\u0438\u043d\u0430')} />
              <SafeNumberInput label="Высота окна (мм)" value={selectedWindow.heightMm} onChange={(v) => updateWindow(selectedWindow.id, { heightMm: v })} validate={(r) => validateInt(r, 300, 5000, '\u0432\u044b\u0441\u043e\u0442\u0430')} />
              <SafeNumberInput label="Высота подоконника (мм)" value={selectedWindow.sillHeightMm} onChange={(v) => updateWindow(selectedWindow.id, { sillHeightMm: v })} validate={(r) => validateInt(r, 300, 5000, '\u0432\u044b\u0441\u043e\u0442\u0430 \u043f\u043e\u0434\u043e\u043a\u043e\u043d\u043d\u0438\u043a\u0430')} />
              <div style={{ marginTop: 8 }}>
                <button type="button" className="param-input" onClick={() => deleteWindow(selectedWindow.id)} style={{ cursor: 'pointer' }}>Удалить окно</button>
              </div>
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
              openings={openings} selectedWindowId={selectedWindowId} wallLength={length}
              onWindowXChange={(id, x) => updateWindow(id, { positionXmm: x })}
              onWindowSelect={setSelectedWindowId}
              onSelect={setSelectedId} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
