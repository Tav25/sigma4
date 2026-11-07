import type { HorizontalCut, SectionPiece } from '../core/horizontal-cut'
import type { PlanPoint } from '../core/floor-plan'
import { isPartitionWall } from '../core/partition-layout'

/** Actual intersects of world-space 3D timber, never schematic/approximate studs. */
export function structuralPieceColor(piece: Pick<SectionPiece,'role'|'wallId'|'elementId'>): string {
  if(piece.elementId.includes(':partition-backing-')||piece.elementId.includes(':cross-backing-'))return '#de985b'
  if(piece.role.includes('header')||piece.role.includes('lintel'))return '#aa885a'
  if(piece.role==='top-plate'||piece.role==='bottom-plate')return '#a5b4bb'
  if(isPartitionWall(piece.wallId))return '#71b4a0'
  return '#ba9970'
}

interface Props {
  cut: HorizontalCut
  xy: (point: PlanPoint)=>{x:number;y:number}
  selectedId: string|null
  onSelect: (id:string)=>void
}
export function PlanStructuralOverlay({cut,xy,selectedId,onSelect}:Props) {
  return <g className="plan-structural-layer" data-testid="plan-structural-layer"
    data-height-mm={cut.heightMm} data-piece-count={cut.pieces.length}>
    {cut.pieces.map(piece=><polygon key={piece.elementId}
      data-testid="plan-structural-piece" data-element-id={piece.elementId}
      data-wall-id={piece.wallId} data-role={piece.role} data-area-mm2={piece.areaMm2}
      data-selected={selectedId===piece.elementId}
      className="plan-structural-piece" role="button" tabIndex={0}
      aria-label={piece.elementId+' · '+piece.role}
      points={piece.polygon.map(p=>{const q=xy(p);return q.x+','+q.y}).join(' ')}
      fill={structuralPieceColor(piece)}
      onPointerDown={event=>event.stopPropagation()}
      onClick={event=>{event.stopPropagation();onSelect(piece.elementId)}}
      onKeyDown={event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();event.stopPropagation();onSelect(piece.elementId)
        }
      }}>
      <title>{piece.elementId} · {piece.role} · {piece.wallId} · {Math.round(piece.areaMm2)} мм²</title>
    </polygon>)}
  </g>
}
