import { useMemo, useState } from 'react'
import type { TimberElement } from '../core/timber'
import { calculateWorldBounds } from '../scene/view-bounds'
import { isPartitionWall } from '../core/partition-layout'

export function HorizontalSection({ elements }: { elements: TimberElement[] }) {
  const [height, setHeight] = useState(1000)
  const geometry = useMemo(() => ({
    bounds: calculateWorldBounds(elements),
    pieces: elements.map(element => ({ element, box: calculateWorldBounds([element]) })),
  }), [elements])
  const { bounds, pieces } = geometry
  const visible = pieces.filter(({ box }) => height >= Math.round(box.min.y * 1000) && height < Math.round(box.max.y * 1000))
  const mm = (meters: number) => Math.round(meters * 1000 * 1000) / 1000
  const margin = 300
  const viewBox = [mm(bounds.min.x) - margin, mm(bounds.min.z) - margin,
    mm(bounds.max.x - bounds.min.x) + 2 * margin, mm(bounds.max.z - bounds.min.z) + 2 * margin].join(' ')
  return <section className="frame-horizontal-section" data-testid="frame-section">
    <div className="frame-section-toolbar">
      <label>Высота разреза, мм <input type="number" min={0} max={Math.round(bounds.max.y * 1000) - 1}
        step={1} value={height} data-testid="frame-section-height"
        onChange={event => {
          const value = event.target.valueAsNumber
          if (Number.isInteger(value) && value >= 0 && value < Math.round(bounds.max.y * 1000)) setHeight(value)
        }} /></label>
      <span>Синим показаны перегородки</span>
    </div>
    <svg viewBox={viewBox} role="img" aria-label="Горизонтальный разрез каркаса" data-testid="frame-section-svg">
      {visible.map(({ element, box }) => <rect key={element.id}
        data-testid="frame-section-piece" data-wall-id={element.wallId}
        x={mm(box.min.x)} y={mm(box.min.z)}
        width={mm(box.max.x - box.min.x)} height={mm(box.max.z - box.min.z)}
        fill={isPartitionWall(element.wallId ?? '') ? '#2782a7' : '#7a583d'}>
        <title>{element.id}</title>
      </rect>)}
    </svg>
  </section>
}
