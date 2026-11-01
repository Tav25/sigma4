import { useState } from 'react'
import { SceneView } from './scene/SceneView'
import {
  createTimberElement,
  timberVolumeM3,
  type TimberElement,
} from './core/timber'

const initial = createTimberElement({
  length: 3000,
  width: 45,
  height: 145,
  position: { x: 1500, y: 72.5, z: 0 },
  material: 'wood',
})

export default function App() {
  const [element, setElement] = useState<TimberElement>(initial)
  const [length, setLength] = useState(3000)
  const [height, setHeight] = useState(145)
  const [thickness, setThickness] = useState(45)
  const [selected, setSelected] = useState<TimberElement | null>(null)

  const updateLength = (v: number) => {
    setLength(v)
    setElement((prev) => ({ ...prev, length: v, position: { ...prev.position, x: v / 2 } }))
  }
  const updateHeight = (v: number) => {
    setHeight(v)
    setElement((prev) => ({ ...prev, height: v, position: { ...prev.position, y: v / 2 } }))
  }
  const updateThickness = (v: number) => {
    setThickness(v)
    setElement((prev) => ({ ...prev, width: v }))
  }

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-title">Конструктор каркасных строений</span>
        <span className="app-version">0.0.3</span>
      </header>
      <div className="main">
        <aside className="left-panel">
          <h2 className="panel-title">Параметры проекта</h2>
          <div className="param-group">
            <label className="param-label">Длина (мм)</label>
            <input
              type="number"
              className="param-input"
              value={length}
              onChange={(e) => updateLength(Number(e.target.value))}
            />
          </div>
          <div className="param-group">
            <label className="param-label">Высота сечения (мм)</label>
            <input
              type="number"
              className="param-input"
              value={height}
              onChange={(e) => updateHeight(Number(e.target.value))}
            />
          </div>
          <div className="param-group">
            <label className="param-label">Толщина (мм)</label>
            <input
              type="number"
              className="param-input"
              value={thickness}
              onChange={(e) => updateThickness(Number(e.target.value))}
            />
          </div>

          {selected && (
            <div className="props">
              <h3 className="props-title">Свойства детали</h3>
              <div>Название: Доска {selected.width}x{selected.height}x{selected.length} мм</div>
              <div>Длина:: {selected.length} мм</div>
              <div>Сечение:: {selected.width}x{selected.height} мм</div>
              <div>Объём: {timberVolumeM3(selected).toFixed(6)} м³</div>
            </div>
          )}
        </aside>
        <main className="viewport-wrap">
          <SceneView element={element} onSelect={setSelected} />
        </main>
      </div>
    </div>
  )
}
