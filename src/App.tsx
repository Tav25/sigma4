
import { useState, useMemo, useRef } from 'react'
import { SceneView } from './scene/SceneView'
import { generateWallPanel, type WallPanelParams } from './core/wall'
import { timberVolumeM3, type TimberElement } from './core/timber'
import { SafeNumberInput } from './components/SafeNumberInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { validateWallLength, validateInt } from './core/validation'

export default function App() {
  const [length, setLength] = useState(3000)
  const [height, setHeight] = useState(2700)
  const [spacing, setSpacing] = useState(600)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEdges, setShowEdges] = useState(true)

  const params: WallPanelParams = { length, height, sectionWidth: 45, sectionHeight: 145, spacing, topLayers: 2 }
  const defaultAssembly = useMemo(() => generateWallPanel({ length: 3000, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 }), [])
  const lastElementsRef = useRef(defaultAssembly.elements)
  const assembly = useMemo(() => {
    try {
      const a = generateWallPanel(params)
      lastElementsRef.current = a.elements
      return a
    } catch (e) {
      console.error('Wall generation error:', e)
      return null
    }
  }, [length, height, spacing])
  const elements = assembly ? assembly.elements : lastElementsRef.current
  const selected = elements.find((e) => e.id === selectedId) ?? null

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
        <span className="app-version">0.0.6.3</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Стена</h2>
          <SafeNumberInput label="Длина (мм)" value={length} onChange={setLength} validate={validateWallLength} />
          <SafeNumberInput label="Высота (мм)" value={height} onChange={setHeight} validate={(r) => validateInt(r, 300, 10000, 'высоту')} />
          <SafeNumberInput label="Шаг стоек (мм)" value={spacing} onChange={setSpacing} validate={(r) => validateInt(r, 100, 5000, 'шаг')} />
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
          <div className="param-group">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Количество элементов:</div>
            {elements.map((el) => (
              <div
                key={el.id}
                onClick={() => setSelectedId(el.id)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: selectedId === el.id ? '#dbeafe' : 'transparent',
                  fontWeight: selectedId === el.id ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {el.id}
              </div>
            ))}
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
            <SceneView elements={elements} selectedId={selectedId} showEdges={showEdges} onSelect={setSelectedId} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
