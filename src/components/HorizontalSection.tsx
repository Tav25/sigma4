import { useEffect, useMemo, useState } from 'react'
import { buildHorizontalCut, type SectionPiece } from '../core/horizontal-cut'
import type { TimberElement } from '../core/timber'
import { isPartitionWall } from '../core/partition-layout'

function pieceFill(piece:SectionPiece):string {
  if(piece.elementId.includes(':partition-backing-'))return '#ec8939'
  if(isPartitionWall(piece.wallId)){
    return piece.role==='stud'||piece.role==='king-stud'||piece.role==='jack-stud'
      ? '#43a783':'#7babc0'
  }
  if(piece.role.includes('header')||piece.role.includes('lintel'))return '#ad8b52'
  return piece.role==='stud'||piece.role==='king-stud'||piece.role==='jack-stud'
    ? '#b98b5d':'#907054'
}
const fmt=(n:number)=>n.toLocaleString('ru-RU',{maximumFractionDigits:1})
export function HorizontalSection({ elements }: { elements: TimberElement[] }) {
  const bounds=useMemo(()=>buildHorizontalCut(elements,0).bounds,[elements])
  const minHeight=Math.ceil(bounds.minY)
  const maxHeight=Math.max(minHeight,Math.ceil(bounds.maxY)-1)
  const [height,setHeight]=useState(1200)
  const [zoom,setZoom]=useState(1)
  const [selectedId,setSelectedId]=useState<string|null>(null)
  useEffect(()=>{
    setHeight(h=>Math.min(maxHeight,Math.max(minHeight,h)))
  },[minHeight,maxHeight])
  useEffect(()=>{
    if(selectedId&&!elements.some(e=>e.id===selectedId))setSelectedId(null)
  },[elements,selectedId])
  const cut=useMemo(()=>buildHorizontalCut(elements,height),[elements,height])
  const selected=cut.pieces.find(p=>p.elementId===selectedId)
  const margin=Math.max(300,Math.min(750,(bounds.maxX-bounds.minX)*0.07))
  const fullWidth=Math.max(1000,bounds.maxX-bounds.minX+2*margin)
  const fullHeight=Math.max(1000,bounds.maxZ-bounds.minZ+2*margin)
  const midX=(bounds.minX+bounds.maxX)/2
  const midY=-(bounds.minZ+bounds.maxZ)/2
  const width=fullWidth/zoom,heightView=fullHeight/zoom
  const viewBox=[midX-width/2,midY-heightView/2,width,heightView].join(' ')
  const gridLines=useMemo(()=>{
    const xs:number[]=[],zs:number[]=[]
    for(let x=Math.ceil((bounds.minX-margin)/1000)*1000;
      x<=bounds.maxX+margin;x+=1000)xs.push(x)
    for(let z=Math.ceil((bounds.minZ-margin)/1000)*1000;
      z<=bounds.maxZ+margin;z+=1000)zs.push(z)
    return{xs,zs}
  },[bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ,margin])
  const setCutHeight=(n:number)=>{
    if(Number.isFinite(n)&&Number.isInteger(n)&&n>=minHeight&&n<=maxHeight)setHeight(n)
  }
  return <section className="frame-horizontal-section" data-testid="frame-section">
    <div className="frame-section-toolbar">
      <div className="frame-section-main-controls">
        <label htmlFor="frame-section-height">Высота сечения, мм</label>
        <input id="frame-section-height" data-testid="frame-section-height"
          type="number" inputMode="numeric" step={1} min={minHeight} max={maxHeight}
          value={height} onChange={event=>setCutHeight(event.target.valueAsNumber)} />
        <button type="button" onClick={()=>setCutHeight(Math.max(minHeight,height-100))}
          disabled={height<=minHeight} aria-label="Опустить плоскость на 100 мм">−100</button>
        <button type="button" onClick={()=>setCutHeight(Math.min(maxHeight,height+100))}
          disabled={height>=maxHeight} aria-label="Поднять плоскость на 100 мм">+100</button>
      </div>
      <input className="frame-section-range" type="range" data-testid="frame-section-slider"
        aria-label="Высота горизонтального разреза" min={minHeight} max={maxHeight}
        step={1} value={height} onChange={event=>setCutHeight(event.target.valueAsNumber)}/>
      <div className="frame-section-summary">
        <strong>{fmt(height)} мм</strong> · <span data-testid="frame-section-count">
          {cut.pieces.length}</span> из {elements.length} деталей пересекают плоскость
      </div>
    </div>
    <div className="frame-section-canvas">
      <div className="frame-section-zoom">
        <button type="button" aria-label="Увеличить разрез" onClick={()=>setZoom(z=>Math.min(8,z*1.25))}>+</button>
        <button type="button" aria-label="Уменьшить разрез" onClick={()=>setZoom(z=>Math.max(0.65,z/1.25))}>−</button>
        <button type="button" aria-label="Показать весь каркас" onClick={()=>setZoom(1)}>Вписать</button>
      </div>
      <svg viewBox={viewBox} role="img" aria-label="Точный горизонтальный разрез всех деревянных элементов каркаса"
        data-testid="frame-section-svg">
        <rect x={midX-width/2} y={midY-heightView/2} width={width} height={heightView}
          fill="#f7fafc"/>
        <g className="frame-section-grid" pointerEvents="none">
          {gridLines.xs.map(x=><line key={'x'+x} x1={x} x2={x}
            y1={midY-heightView/2} y2={midY+heightView/2}/>)}
          {gridLines.zs.map(z=><line key={'z'+z} x1={midX-width/2} x2={midX+width/2}
            y1={-z} y2={-z}/>)}
        </g>
        {cut.pieces.map(piece=><polygon key={piece.elementId}
          data-testid="frame-section-piece" data-wall-id={piece.wallId}
          data-element-id={piece.elementId} data-role={piece.role}
          data-area-mm2={piece.areaMm2}
          className={selectedId===piece.elementId?'frame-section-piece selected':'frame-section-piece'}
          points={piece.polygon.map(p=>p.xMm+','+(-p.zMm)).join(' ')}
          fill={pieceFill(piece)}
          onClick={()=>setSelectedId(piece.elementId)}>
          <title>{piece.elementId} · {piece.role} · {piece.wallId}</title>
        </polygon>)}
        <g className="frame-section-axes" pointerEvents="none">
          <text x={bounds.minX} y={-bounds.minZ+margin*0.55}>+X →</text>
          <text x={bounds.minX} y={-bounds.maxZ-margin*0.45}>↑ −Z</text>
        </g>
      </svg>
    </div>
    <div className="frame-section-footer">
      <span>Вид сверху · реальное пересечение 3D-элементов плоскостью Y = {fmt(height)} мм</span>
      <span className="frame-section-legend">
        <i className="frame-legend-outside"/> Наружные
        <i className="frame-legend-joining"/> Закладные
        <i className="frame-legend-inside"/> Перегородки
      </span>
      {selected&&<span data-testid="frame-section-selected">
        Деталь: <strong>{selected.elementId}</strong> · {selected.role} · {selected.wallId}
      </span>}
    </div>
  </section>
}
