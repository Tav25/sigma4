/**
 * SIGMA4 0.1.12: canonical free-point + segment editor.
 * Legacy interiorWalls are accepted until the first graph command converts
 * them to graph.nodes and graph.edges. Never persist both representations.
 */
import {
  type FloorPlan, type PlanPoint, type PlanInteriorWall,
  planIsOrthogonal, planDistanceMm, planAxisIntersection, planWallClearances,
  pointOnPlanSegment, MIN_PLAN_EDGE_MM, PLAN_LIMIT_MM,
} from './floor-plan'

export interface PlanGraphNode extends PlanPoint { id: string }
export interface PlanGraphEdge { id: string; a: string; b: string; thicknessMm: number }
export interface PlanGraph { nodes: PlanGraphNode[]; edges: PlanGraphEdge[] }

const same=(a:PlanPoint,b:PlanPoint)=>a.xMm===b.xMm && a.zMm===b.zMm
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
const key=(p:PlanPoint)=>p.xMm+':'+p.zMm
const within=(p:PlanPoint)=>Number.isInteger(p.xMm) && Number.isInteger(p.zMm) &&
  Math.abs(p.xMm)<=PLAN_LIMIT_MM && Math.abs(p.zMm)<=PLAN_LIMIT_MM
const along=(p:PlanPoint,a:PlanPoint,b:PlanPoint)=>
  pointOnPlanSegment(p,a,b)
const betweenStrict=(p:PlanPoint,a:PlanPoint,b:PlanPoint)=>
  !same(p,a)&&!same(p,b)&&along(p,a,b)
const length=(a:PlanPoint,b:PlanPoint)=>planDistanceMm(a,b)
function freshId(prefix:string,used:Set<string>):string {
  let n=1
  while(used.has(prefix+String(n).padStart(3,'0')))n++
  return prefix+String(n).padStart(3,'0')
}
const graphOf=(plan:FloorPlan):PlanGraph=>{
  if(!plan.graph) throw Error('Отсутствует граф стен')
  return plan.graph
}
const nodeFor=(g:PlanGraph,id:string)=>g.nodes.find(n=>n.id===id)
const endpoints=(g:PlanGraph,e:PlanGraphEdge):[PlanGraphNode,PlanGraphNode]=>{
  const a=nodeFor(g,e.a),b=nodeFor(g,e.b)
  if(!a||!b) throw Error('Отрезок ссылается на отсутствующую точку')
  return [a,b]
}
function getOrAddNode(g:PlanGraph,p:PlanPoint):PlanGraphNode {
  if(!within(p))throw Error('Координаты точки должны быть в миллиметрах (±100 м)')
  const previous=g.nodes.find(n=>same(n,p))
  if(previous)return previous
  const node={id:freshId('N',new Set(g.nodes.map(n=>n.id))),...p}
  g.nodes.push(node)
  return node
}
/** Split every segment containing the point, preserving each original first-half ID. */
function placeAndSplit(g:PlanGraph,p:PlanPoint):PlanGraphNode {
  const joint=getOrAddNode(g,p)
  const originals=[...g.edges]
  for(const e of originals) {
    const [a,b]=endpoints(g,e)
    if(!betweenStrict(p,a,b))continue
    const secondId=freshId('I',new Set(g.edges.map(w=>w.id)))
    e.b=joint.id
    g.edges.push({id:secondId,a:joint.id,b:b.id,thicknessMm:e.thicknessMm})
  }
  return joint
}
function pointInside(p:PlanPoint,poly:PlanPoint[]):boolean {
  if(poly.length<3)return false
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j]
    if(along(p,a,b))return true
    if((a.zMm>p.zMm)!==(b.zMm>p.zMm)&&
      p.xMm<(b.xMm-a.xMm)*(p.zMm-a.zMm)/(b.zMm-a.zMm)+a.xMm)inside=!inside
  }
  return inside
}
function positiveOverlap(a:PlanPoint,b:PlanPoint,c:PlanPoint,d:PlanPoint):boolean {
  if(a.xMm===b.xMm && c.xMm===d.xMm && a.xMm===c.xMm)
    return Math.min(Math.max(a.zMm,b.zMm),Math.max(c.zMm,d.zMm))>
      Math.max(Math.min(a.zMm,b.zMm),Math.min(c.zMm,d.zMm))
  if(a.zMm===b.zMm && c.zMm===d.zMm && a.zMm===c.zMm)
    return Math.min(Math.max(a.xMm,b.xMm),Math.max(c.xMm,d.xMm))>
      Math.max(Math.min(a.xMm,b.xMm),Math.min(c.xMm,d.xMm))
  return false
}
function boundary(plan:FloorPlan):[PlanPoint,PlanPoint][] {
  if(!plan.closed)return []
  return plan.exterior.map((a,i)=>[a,plan.exterior[(i+1)%plan.exterior.length]])
}
export function graphView(plan:FloorPlan):FloorPlan {
  if(!plan.graph)return plan
  const walls:PlanInteriorWall[]=plan.graph.edges.flatMap(edge=>{
    const a=nodeFor(plan.graph!,edge.a),b=nodeFor(plan.graph!,edge.b)
    return a&&b?[{id:edge.id,start:{xMm:a.xMm,zMm:a.zMm},
      end:{xMm:b.xMm,zMm:b.zMm},thicknessMm:edge.thicknessMm}]:[]
  })
  // View only. NEVER serialize this projection; graph remains sole source.
  return {...plan,graph:undefined,interiorWalls:walls}
}
export function ensureWallGraph(plan:FloorPlan):FloorPlan {
  if(plan.graph)return copy(plan)
  const next:FloorPlan={...copy(plan),interiorWalls:[],graph:{nodes:[],edges:[]}}
  for(const old of plan.interiorWalls) {
    const migrated=addGraphSegment(next,old.start,old.end,old.thicknessMm,old.id)
    next.graph=migrated.graph
  }
  return next
}
export function addGraphPoint(plan:FloorPlan,p:PlanPoint):FloorPlan {
  const next=ensureWallGraph(plan)
  placeAndSplit(graphOf(next),p)
  return next
}
export function addGraphSegment(
  plan:FloorPlan,from:PlanPoint,to:PlanPoint,thicknessMm:number,preferredId?:string
):FloorPlan {
  if(!within(from)||!within(to))throw Error('Точки должны иметь допустимые координаты')
  if(!planIsOrthogonal(from,to)||length(from,to)<MIN_PLAN_EDGE_MM)
    throw Error('Отрезок должен быть прямым по осям X/Z и не короче 0,30 м')
  if(!Number.isInteger(thicknessMm)||thicknessMm<50||thicknessMm>500)
    throw Error('Толщина должна быть от 50 до 500 мм')
  const next=ensureWallGraph(plan)
  const g=graphOf(next)
  // Auto-promote all crossings into common graph nodes, including T-joints.
  const junctions:PlanPoint[]=[from,to]
  for(const edge of [...g.edges]){
    const [a,b]=endpoints(g,edge)
    const intersection=planAxisIntersection(from,to,a,b)
    if(intersection)junctions.push(intersection)
  }
  for(const node of g.nodes){
    if(along(node,from,to))junctions.push(node)
  }
  for(const p of junctions)placeAndSplit(g,p)
  const dedup=[...new Map(junctions.map(p=>[key(p),p])).values()]
    .sort((a,b)=>length(from,a)-length(from,b))
  for(let i=0;i<dedup.length-1;i++){
    const a=dedup[i],b=dedup[i+1]
    if(same(a,b))continue
    const start=getOrAddNode(g,a),end=getOrAddNode(g,b)
    const existing=new Set(g.edges.map(edge=>edge.id))
    const id=i===0 && preferredId && !existing.has(preferredId)
      ?preferredId:freshId('I',existing)
    g.edges.push({id,a:start.id,b:end.id,thicknessMm})
  }
  return next
}
export function splitGraphEdge(plan:FloorPlan,id:string,p:PlanPoint):FloorPlan {
  const next=ensureWallGraph(plan),g=graphOf(next)
  const edge=g.edges.find(e=>e.id===id)
  if(!edge)throw Error('Отрезок стены не найден')
  const [a,b]=endpoints(g,edge)
  if(!betweenStrict(p,a,b))throw Error('Точка разреза должна быть внутри отрезка')
  if(length(a,p)<MIN_PLAN_EDGE_MM || length(p,b)<MIN_PLAN_EDGE_MM)
    throw Error('После разреза каждый участок должен быть не короче 0,30 м')
  placeAndSplit(g,p)
  return next
}
export function deleteGraphEdge(plan:FloorPlan,id:string):FloorPlan {
  const next=ensureWallGraph(plan),g=graphOf(next)
  const len=g.edges.length
  g.edges=g.edges.filter(e=>e.id!==id)
  if(g.edges.length===len)throw Error('Отрезок стены не найден')
  // Intentionally retain nodes as separately editable free points.
  return next
}
export function deleteGraphPoint(plan:FloorPlan,id:string):FloorPlan {
  const next=ensureWallGraph(plan),g=graphOf(next)
  if(g.edges.some(e=>e.a===id||e.b===id))
    throw Error('Сначала удалите присоединённые отрезки')
  const size=g.nodes.length
  g.nodes=g.nodes.filter(n=>n.id!==id)
  if(size===g.nodes.length)throw Error('Точка не найдена')
  return next
}
export function moveGraphPoint(plan:FloorPlan,id:string,to:PlanPoint):FloorPlan {
  const next=ensureWallGraph(plan),g=graphOf(next)
  const node=nodeFor(g,id)
  if(!node)throw Error('Точка не найдена')
  if(!within(to))throw Error('Недопустимые координаты точки')
  if(g.nodes.some(n=>n.id!==id&&same(n,to)))
    throw Error('В этом месте уже есть точка. Удалите или соедините узлы')
  node.xMm=to.xMm;node.zMm=to.zMm
  return next
}
export function changeGraphEdge(
  plan:FloorPlan,id:string,start:PlanPoint,end:PlanPoint,thicknessMm:number
):FloorPlan {
  const next=ensureWallGraph(plan),g=graphOf(next)
  const edge=g.edges.find(e=>e.id===id)
  if(!edge)throw Error('Отрезок стены не найден')
  const a=nodeFor(g,edge.a)!,b=nodeFor(g,edge.b)!
  if(!within(start)||!within(end))throw Error('Недопустимые координаты')
  if(g.nodes.some(n=>n.id!==a.id&&n.id!==b.id&&same(n,start)) ||
     g.nodes.some(n=>n.id!==a.id&&n.id!==b.id&&same(n,end)))
    throw Error('Другая точка уже занимает целевую координату')
  a.xMm=start.xMm;a.zMm=start.zMm
  b.xMm=end.xMm;b.zMm=end.zMm
  edge.thicknessMm=thicknessMm
  return next
}
export function moveGraphEdge(plan:FloorPlan,id:string,offsetMm:number):FloorPlan {
  if(!Number.isInteger(offsetMm))throw Error('Смещение должно быть целым числом миллиметров')
  const next=ensureWallGraph(plan),g=graphOf(next)
  const segment=g.edges.find(e=>e.id===id)
  if(!segment)throw Error('Отрезок стены не найден')
  const [start,end]=endpoints(g,segment)
  const vertical=start.xMm===end.xMm
  const axis=vertical?'xMm':'zMm'
  const coordinate=start[axis]
  // Move the entire connected collinear run, including split edges, T joints
  // and the attached perpendicular wall ends (shared nodes).
  const affected=new Set<string>([start.id,end.id])
  let changed=true
  while(changed){
    changed=false
    for(const edge of g.edges){
      const [a,b]=endpoints(g,edge)
      if(a[axis]!==coordinate||b[axis]!==coordinate)continue
      if(!affected.has(a.id)&&!affected.has(b.id))continue
      if(!affected.has(a.id)){affected.add(a.id);changed=true}
      if(!affected.has(b.id)){affected.add(b.id);changed=true}
    }
  }
  for(const n of g.nodes)if(affected.has(n.id))n[axis]+=offsetMm
  return next
}
export function moveGraphEdgeToDimension(
  plan:FloorPlan,id:string,side:'negative'|'positive',desiredMm:number,
):FloorPlan {
  if(!Number.isInteger(desiredMm)||desiredMm<MIN_PLAN_EDGE_MM)
    throw Error('Размер должен быть не меньше 0,30 м')
  const clearance=planWallClearances(graphView(plan),id)
  const ref=clearance?.[side]
  if(!clearance||!ref)throw Error('Не удалось найти соседнюю стену')
  const offset=(desiredMm-ref.distanceMm)*(side==='negative'?1:-1)
  return moveGraphEdge(plan,id,Math.round(offset))
}
/** Validation must never mutate author data. */
export function validatePlanGraph(plan:FloorPlan):string[] {
  const g=plan.graph
  if(!g)return []
  if(!plan.closed)return ['Для свободного черчения сначала замкните наружный контур']
  if(!Array.isArray(g.nodes)||!Array.isArray(g.edges))return ['Повреждена структура графа стен']
  if(plan.interiorWalls.length)return ['Нельзя сохранять две независимые модели внутренних стен']
  if(g.nodes.length>500||g.edges.length>500)return ['Слишком много точек или отрезков (предел 500)']
  const errors:string[]=[]
  const nodeIds=new Set<string>(),coords=new Set<string>()
  for(const n of g.nodes){
    if(!n||typeof n.id!=='string'||!n.id||!within(n)){
      errors.push('Повреждён узел графа');continue
    }
    if(nodeIds.has(n.id))errors.push('Повторяющийся ID точки')
    if(coords.has(key(n)))errors.push('Дублирующие координаты разных узлов')
    nodeIds.add(n.id);coords.add(key(n))
    if(!pointInside(n,plan.exterior))errors.push('Точка выходит за периметр дома')
  }
  if(errors.length)return [...new Set(errors)]
  const edgeIds=new Set<string>(),bs=boundary(plan)
  for(const e of g.edges){
    if(!e||typeof e.id!=='string'||!e.id||typeof e.a!=='string'||typeof e.b!=='string'){
      errors.push('Неверное описание отрезка');continue
    }
    if(edgeIds.has(e.id))errors.push('Повторяющийся ID отрезка')
    edgeIds.add(e.id)
    const a=nodeFor(g,e.a),b=nodeFor(g,e.b)
    if(!a||!b){errors.push('Отрезок ссылается на отсутствующую точку');continue}
    if(!planIsOrthogonal(a,b)||length(a,b)<MIN_PLAN_EDGE_MM)
      errors.push('Отрезок должен быть по осям X/Z и не короче 0,30 м')
    if(!Number.isInteger(e.thicknessMm)||e.thicknessMm<50||e.thicknessMm>500)
      errors.push('Неверная толщина отрезка (50–500 мм)')
    const mid={xMm:(a.xMm+b.xMm)/2,zMm:(a.zMm+b.zMm)/2}
    if(!pointInside(mid,plan.exterior))errors.push('Отрезок расположен вне наружного периметра')
    for(const [c,d] of bs){
      if(positiveOverlap(a,b,c,d))errors.push('Внутренний отрезок совпадает с наружной стеной')
      const intersection=planAxisIntersection(a,b,c,d)
      if(intersection&&!same(intersection,a)&&!same(intersection,b))
        errors.push('Отрезок пересекает наружную границу')
    }
  }
  if(errors.length)return [...new Set(errors)]
  for(let i=0;i<g.edges.length;i++){
    const one=g.edges[i],[a,b]=endpoints(g,one)
    for(let j=i+1;j<g.edges.length;j++){
      const other=g.edges[j],[c,d]=endpoints(g,other)
      if(positiveOverlap(a,b,c,d))errors.push('Отрезки перекрывают друг друга')
      const intersection=planAxisIntersection(a,b,c,d)
      if(intersection){
        const joint=g.nodes.find(n=>same(n,intersection))
        if(!joint ||
          !([one.a,one.b].includes(joint.id)&&[other.a,other.b].includes(joint.id)))
          errors.push('Пересечение стен должно быть общим узлом')
      }
    }
    // No node may lie in the middle of an authored edge.
    for(const n of g.nodes){
      if(n.id!==one.a&&n.id!==one.b&&betweenStrict(n,a,b)){
        errors.push('Отрезок должен быть разделён в расположении точки')
      }
    }
  }
  return [...new Set(errors)]
}
