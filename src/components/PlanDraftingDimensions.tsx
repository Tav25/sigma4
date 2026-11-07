import { exteriorDimensionNormal } from '../core/plan-visualization'
import { draftingChains, outwardDoorSwingMm } from '../core/plan-drafting'
import { pointOnPlanSegment, type FloorPlan, type PlanPoint } from '../core/floor-plan'
import type { PlanFrameSide } from '../core/plan-frame'
import type { Opening } from '../core/project'

export function PlanDraftingDimensions({plan,sides,openings,xy,pxPerMm,activeOpeningWallId}:{
  plan:FloorPlan;sides:readonly PlanFrameSide[];openings:readonly Opening[];
  xy:(point:PlanPoint)=>{x:number;y:number};pxPerMm:number;activeOpeningWallId?:string;
}) {
  return <g className="plan-drafting-dimensions" pointerEvents="none" data-testid="plan-drafting-dimensions">
    {plan.exterior.map((a,i)=>{
      const b=plan.exterior[(i+1)%plan.exterior.length],p=xy(a),q=xy(b)
      const n=exteriorDimensionNormal(plan.exterior,i)
      const len=Math.hypot(q.x-p.x,q.y-p.y)
      if (!len) return null
      const t={x:(q.x-p.x)/len,y:(q.y-p.y)/len}
      const at=(u:number,offset:number)=>({x:p.x+t.x*u*pxPerMm+n.x*offset,y:p.y+t.y*u*pxPerMm+n.y*offset})
      const vertical=a.xMm===b.xMm
      const swing=outwardDoorSwingMm(plan,i,sides,openings)
      const firstOffset=Math.max(36,swing? swing*pxPerMm+28:0)
      const active=sides.find(side=>side.wallId===activeOpeningWallId)
      const activeOnEdge=active&&!('thicknessMm' in active)&&
        pointOnPlanSegment(active.start,a,b)&&pointOnPlanSegment(active.end,a,b)
      return draftingChains(plan,i,sides,openings).map((chain,row)=>{
        if (chain.kind==='openings'&&activeOnEdge) return null
        const offset=firstOffset+row*34
        return <g key={chain.kind} data-edge={i} data-chain={chain.kind}>
          <title>{{openings:'Грани черновых проёмов (RO)',axes:'Оси перегородок (CL)',overall:'Наружные грани каркаса'}[chain.kind]}</title>
          {chain.stationsMm.map(u=>{
            const s=at(u,7),e=at(u,offset+6),c=at(u,offset)
            return <g key={u}><line className="draft-witness" x1={s.x} y1={s.y} x2={e.x} y2={e.y}/>
              <line className="draft-tick" x1={c.x-3} y1={c.y+5} x2={c.x+3} y2={c.y-5}/></g>
          })}
          {chain.stationsMm.slice(1).map((to,j)=>{
            const from=chain.stationsMm[j],s=at(from,offset),e=at(to,offset)
            const short=(to-from)*pxPerMm<40
            const c=at((from+to)/2,offset+ (short&&j%2?14: -8))
            return <g key={j} data-dimension-mm={to-from}>
              <line x1={s.x} y1={s.y} x2={e.x} y2={e.y}/>
              <text transform={`translate(${c.x} ${c.y}) rotate(${vertical?-90:0})`}
                textAnchor="middle" className="draft-value">{Math.round(to-from)}</text>
            </g>
          })}
          {chain.kind==='axes'&&(()=>{const c=at(chain.stationsMm[chain.stationsMm.length-1],offset)
            return <text x={c.x+n.x*12} y={c.y+n.y*12} className="draft-cl">CL</text>})()}
        </g>
      })
    })}
  </g>
}
