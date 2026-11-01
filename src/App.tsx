
import { useState, useMemo } from 'react'
import { SceneView } from './scene/SceneView'
import { createMiniAssembly } from './core/assembly'
import { timberVolumeM3, type TimberElement } from './core/timber'

export default function App() {
  const assembly = useMemo(() => createMiniAssembly(), [])
  const elements = assembly.elements
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = elements.find((e) => e.id === selectedId) ?? null

  const dirText = (el: TimberElement) => {
    const m = el.orientation.mode
    if (m === 'x') return 'X'
    if (m === 'y') return 'Y'
    if (m === 'z') return 'Z'
    return 'slope ' + el.orientation.angle + '°'
  }

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-title">Конструктор каркасных строений</span>
        <span className="app-version">0.0.5</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Сборка 0.0.5</h2>
          <div className="param-group">
            <div>Число элементов: {elements.length}</div>
          </div>
          <div className="param-group">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Число элементов:</div>
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
              <div>Угол roll: {selected.orientation.roll}°</div>
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
