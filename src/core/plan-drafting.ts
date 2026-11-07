import { pointOnPlanSegment, planDistanceMm, type FloorPlan } from './floor-plan'
import { exteriorDimensionNormal } from './plan-visualization'
import { graphView } from './plan-graph'
import { planSidePoint, type PlanFrameSide } from './plan-frame'
import type { Opening } from './project'

export type DraftingChain = { kind: 'openings'|'axes'|'overall'; stationsMm: number[] }

/** Display-only chains. Exterior dimensions reference the outer framing face;
 * partition locations reference their authored centre lines; RO references jambs.
 * Never mix shortened built wall origins with authored plan offsets.
 */
export function draftingChains(plan: FloorPlan, edgeIndex: number,
  sides: readonly PlanFrameSide[], openings: readonly Opening[]): DraftingChain[] {
  if (!plan.closed || edgeIndex<0 || edgeIndex>=plan.exterior.length) return []
  const a=plan.exterior[edgeIndex], b=plan.exterior[(edgeIndex+1)%plan.exterior.length]
  const length=planDistanceMm(a,b)
  if (!length) return []
  const horizontal=a.zMm===b.zMm
  const station=(p:typeof a)=>(horizontal?p.xMm-a.xMm:p.zMm-a.zMm)*
    Math.sign(horizontal?b.xMm-a.xMm:b.zMm-a.zMm)
  const sorted=(values:number[])=>[...new Set([0,...values.filter(v=>v>0&&v<length),length])].sort((x,y)=>x-y)
  const jambs:number[]=[]
  for (const side of sides) {
    if ('thicknessMm' in side || !pointOnPlanSegment(side.start,a,b) || !pointOnPlanSegment(side.end,a,b)) continue
    for (const o of openings.filter(o=>o.wallId===side.wallId)) {
      jambs.push(station(planSidePoint(side,o.positionUmm)),station(planSidePoint(side,o.positionUmm+o.widthMm)))
    }
  }
  const axes=graphView(plan).interiorWalls.flatMap(w=>[w.start,w.end])
    .filter(p=>pointOnPlanSegment(p,a,b)).map(station)
  const chains:DraftingChain[]=[]
  if (jambs.length) chains.push({kind:'openings',stationsMm:sorted(jambs)})
  if (sorted(axes).length>2) chains.push({kind:'axes',stationsMm:sorted(axes)})
  chains.push({kind:'overall',stationsMm:[0,length]})
  return chains
}

/** Space required outside an edge by the authored outward door swing. */
export function outwardDoorSwingMm(plan:FloorPlan,index:number,sides:readonly PlanFrameSide[],openings:readonly Opening[]) {
  const a=plan.exterior[index],b=plan.exterior[(index+1)%plan.exterior.length]
  if (!a||!b) return 0
  const n=exteriorDimensionNormal(plan.exterior,index)
  const widths=sides.filter(s=>!('thicknessMm' in s)&&pointOnPlanSegment(s.start,a,b)&&pointOnPlanSegment(s.end,a,b))
    .flatMap(side=>{
      const dx=Math.sign(side.end.xMm-side.start.xMm),dy=Math.sign(side.end.zMm-side.start.zMm)
      return openings.filter(o=>o.wallId===side.wallId&&o.type==='door'&&
        (-dy*n.x+dx*n.y)*(o.swing?.side==='left'?-1:1)>0).map(o=>o.widthMm)
    })
  return Math.max(0,...widths)
}
