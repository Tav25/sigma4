
import { useState, useMemo } from 'react'
import { SceneView } from './scene/SceneView'
import { generateWallPanel, type WallPanelParams } from './core/wall'
import { timberVolumeM3, type TimberElement } from './core/timber'

export default function App() {
  const [length, setLength] = useState(3000)
  const [height, setHeight] = useState(2700)
  const [spacing, setSpacing] = useState(600)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const params: WallPanelParams = { length, height, sectionWidth: 45, sectionHeight: 145, spacing, topLayers: 2 }
  const assembly = useMemo(() => generateWallPanel(params), [length, height, spacing])
  const elements = assembly.elements
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
        <span className="app-version">0.0.6</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Стена</h2>
          <div className="param-group">
            <label className="param-label">Длина (мм)</label>
            <input type="number" className="param-input" value={length} onChange={(e) => setLength(Number(e.target.value))} />
          </div>
          <div className="param-group">
            <label className="param-label">Высота (мм)</label>
            <input type="number" className="param-input" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
          </div>
          <div className="param-group">
            <label className="param-label">Шаг стоек (мм)</label>
            <input type="number" className="param-input" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
          </div>
          <div className="param-group">
            <label className="param-label">Сечение</label>
            <input type="text" className="param-input" value="45x145" readOnly />
          </div>
          <div className="param-group">
            <div>Количество элементов: {elements.length}</div>
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
          <SceneView elements={elements} selectedId={selectedId} onSelect={setSelectedId} />
        </main>
      </div>
    </div>
  )
}
