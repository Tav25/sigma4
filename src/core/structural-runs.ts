import { graphView } from './plan-graph'
import type { FloorPlan, PlanInteriorWall, PlanPoint } from './floor-plan'

/**
 * Haun-style physical framing runs.
 *
 * Graph edges are EDITING entities: a tee node splits an edge for precise
 * selection, but does NOT necessarily split the carpentered wall. Merge the collinear arms of a T, and choose the X-axis as the single
 * through-run at a four-arm X; all graph edges remain individually editable.
 * Only matching-thickness, opposite-direction collinear arms may merge.
 *
 * This is derived geometry. Graph IDs and authored door wallIds remain intact.
 */
export interface PhysicalPartitionRuns {
  walls: PlanInteriorWall[]
  /** authored graph wall ID -> physical, through-run wall ID */
  ownerBySegment: ReadonlyMap<string, string>
  /** physical run ID -> IDs of authored members */
  segmentsByRun: ReadonlyMap<string, readonly string[]>
}

const same = (a:PlanPoint,b:PlanPoint)=>
  a.xMm===b.xMm && a.zMm===b.zMm
const key = (p:PlanPoint)=>p.xMm+':'+p.zMm
const horizontal=(w:PlanInteriorWall)=>w.start.zMm===w.end.zMm
const axisValue=(p:PlanPoint,h:boolean)=>h?p.xMm:p.zMm

export function physicalPartitionRuns(plan:FloorPlan):PhysicalPartitionRuns {
  const authored=graphView(plan).interiorWalls
  const parent=authored.map((_,i)=>i)
  const root=(i:number):number=>{
    while(parent[i]!==i)i=parent[i]
    return i
  }
  const join=(a:number,b:number)=>{
    const x=root(a),y=root(b)
    if(x!==y) parent[Math.max(x,y)]=Math.min(x,y)
  }
  const nodes=new Map<string,number[]>()
  authored.forEach((wall,i)=>{
    for(const point of [wall.start,wall.end]){
      const k=key(point),at=nodes.get(k)??[]
      at.push(i)
      nodes.set(k,at)
    }
  })
  for(const [nodeKey,indexes] of nodes){
    if(indexes.length!==3 && indexes.length!==4)continue
    const [x,z]=nodeKey.split(':').map(Number)
    const pairs: [number,number][]=[]
    for(let a=0;a<indexes.length;a++)for(let b=a+1;b<indexes.length;b++){
      const wa=authored[indexes[a]],wb=authored[indexes[b]]
      if(wa.thicknessMm!==wb.thicknessMm||horizontal(wa)!==horizontal(wb))continue
      if(horizontal(wa)?wa.start.zMm!==wb.start.zMm:wa.start.xMm!==wb.start.xMm)
        continue
      const h=horizontal(wa)
      const other=(wall:PlanInteriorWall)=>{
        const v= h ? x : z
        const p=axisValue(wall.start,h),q=axisValue(wall.end,h)
        return p===v?q-v:p-v
      }
      if(other(wa)*other(wb)<0)pairs.push([indexes[a],indexes[b]])
    }
    if(indexes.length===3 && pairs.length===1)join(...pairs[0])
    if(indexes.length===4){
      const xPairs=pairs.filter(([a,b])=>horizontal(authored[a])&&horizontal(authored[b]))
      const zArms=indexes.filter(i=>!horizontal(authored[i]))
      // The cross's X run remains unbroken; the two Z branches butt to
      // opposite faces of that run. A second through-wall would intersect it.
      if(xPairs.length===1 && zArms.length===2 &&
        authored[indexes[0]].thicknessMm===authored[indexes[1]].thicknessMm &&
        indexes.every(i=>authored[i].thicknessMm===authored[indexes[0]].thicknessMm))
        join(...xPairs[0])
    }
  }
  const groups=new Map<number,number[]>()
  authored.forEach((_,i)=>{
    const id=root(i),members=groups.get(id)??[]
    members.push(i)
    groups.set(id,members)
  })
  const walls:PlanInteriorWall[]=[]
  const ownerBySegment=new Map<string,string>()
  const segmentsByRun=new Map<string,readonly string[]>()
  for(const memberIndexes of groups.values()){
    // ID and direction of the FIRST authored segment are carried forward.
    // A later T does not renumber the building's physical wall.
    const first=authored[memberIndexes[0]]
    const h=horizontal(first)
    const sign=Math.sign(axisValue(first.end,h)-axisValue(first.start,h))
    if(!sign)throw Error('Нулевая длина конструктивного участка '+first.id)
    const endpoints=memberIndexes.flatMap(i=>[authored[i].start,authored[i].end])
    const sorted=endpoints.sort((a,b)=>
      sign*(axisValue(a,h)-axisValue(b,h)))
    const start=sorted[0],end=sorted[sorted.length-1]
    if(same(start,end))throw Error('Нулевая длина конструктивной стены '+first.id)
    const memberIds=memberIndexes.map(i=>authored[i].id)
    const derived:PlanInteriorWall={
      id:first.id,
      start:{...start},end:{...end},thicknessMm:first.thicknessMm,
    }
    walls.push(derived)
    segmentsByRun.set(first.id,memberIds)
    for(const id of memberIds)ownerBySegment.set(id,first.id)
  }
  return {walls,ownerBySegment,segmentsByRun}
}

/** X points have exactly four incident graph edges (two per axis). */
export function physicalCrossNodes(plan:FloorPlan):PlanPoint[] {
  if(!plan.graph)return []
  const edges=graphView(plan).interiorWalls
  return plan.graph.nodes.filter(node=>{
    const around=edges.filter(e=>same(e.start,node)||same(e.end,node))
    return around.length===4 && around.filter(e=>horizontal(e)).length===2 &&
      around.filter(e=>!horizontal(e)).length===2
  }).map(node=>({xMm:node.xMm,zMm:node.zMm}))
}

/**
 * A geometric contact validator alone cannot tell whether the WRONG set of
 * boards was generated. Assert the actual Haun T construction from the
 * authored graph, independent from the three.js visualization.
 */
export function validatePhysicalThroughRuns(
  doc: import('./project').ProjectDocument,
): import('./project').ValidationIssue[] {
  const plan=doc.building.floorPlan
  if(!plan?.frame?.built || !plan.graph)return []
  const issues:import('./project').ValidationIssue[]=[]
  const bad=(code:string, messageRu:string, ids:readonly string[])=>{
    issues.push({code,severity:'error',path:'building.floorPlan.graph',
      messageRu,affectedIds:[...ids]})
  }
  const runs=physicalPartitionRuns(plan)
  const walls=new Map(doc.building.walls.map(w=>[w.wallId,w]))
  const elements=doc.assembly.elements
  for(const [runId,ids] of runs.segmentsByRun){
    if(ids.length<2)continue
    const wallId='partition-'+runId
    const physical=walls.get(wallId)
    if(!physical){
      bad('HAUN_MISSING_THROUGH_WALL','Не построена сквозная стена '+wallId,ids)
      continue
    }
    const first=elements.filter(e=>e.wallId===wallId &&
      e.elementId===wallId+':plate-top-1')
    if(first.length!==1 ||
      Math.abs(first[0].lengthMm-physical.lengthMm)>0.001)
      bad('HAUN_BROKEN_FIRST_PLATE',
        'Первый слой обвязки сквозной стены '+wallId+
        ' должен быть непрерывным, без стыка в Т-узле',ids)
    const left=elements.filter(e=>e.elementId===wallId+':stud-01')
    const right=elements.filter(e=>e.elementId===wallId+':stud-02')
    if(left.length!==1||right.length!==1)
      bad('HAUN_PHANTOM_PANEL_END',
        'У сквозной стены '+wallId+' появились лишние торцевые стойки',ids)
  }

  // Each T node has exactly 3 incident authored graph arms. Two are the
  // same continuous run; the remaining perpendicular branch must terminate
  // in a receiver made of 2 uprights and 1 flatwise nailer.
  for(const node of plan.graph.nodes){
    const incident=plan.graph.edges.filter(edge=>edge.a===node.id||edge.b===node.id)
    if(incident.length!==3)continue
    const arms=incident.map(edge=>({
      edge,wall:graphView(plan).interiorWalls.find(w=>w.id===edge.id)!,
    }))
    if(arms.some(a=>!a.wall))continue
    const groups=new Map<string,typeof arms>()
    for(const arm of arms){
      const owner=runs.ownerBySegment.get(arm.edge.id)!
      const group=groups.get(owner)??[]
      group.push(arm)
      groups.set(owner,group)
    }
    if(groups.size!==2)continue
    const through=[...groups].find(([_,a])=>a.length===2)
    const branch=[...groups].find(([_,a])=>a.length===1)
    if(!through||!branch)continue
    const throughId='partition-'+through[0]
    const branchId='partition-'+branch[0]
    const branchSide=branch[1][0].wall
    const atStart=same(branchSide.start,node)
    const atEnd=same(branchSide.end,node)
    if(!atStart&&!atEnd)continue
    const prefix=throughId+':partition-backing-'+branchId+
      (atStart?'-start':'-end')
    const expected=[prefix+'-left',prefix+'-right',prefix+'-flat']
    if(!expected.every(id=>elements.some(e=>e.elementId===id))){
      bad('HAUN_T_CHANNEL_MISSING',
        'Т-узел '+node.id+': отсутствует трёхстоечный приёмный канал '+
        throughId+' ← '+branchId,[throughId,branchId,node.id])
    }
  }
  // Crosses: the physical X through-run retains its first top plate;
  // one receiver (2 uprights + 2 opposite flat nailers) is shared by
  // both Z butt arms. Do not accept two overlapping 3-stud packages.
  for(const node of physicalCrossNodes(plan)){
    const run=runs.walls.find(w=>horizontal(w)&&
      w.start.zMm===node.zMm &&
      node.xMm>Math.min(w.start.xMm,w.end.xMm) &&
      node.xMm<Math.max(w.start.xMm,w.end.xMm))
    if(!run) {
      bad('HAUN_X_THROUGH_WALL_MISSING',
        'X-узел: отсутствует сквозная горизонтальная стена',
        [node.xMm+':'+node.zMm])
      continue
    }
    const id='partition-'+run.id+':cross-backing-'+node.xMm+'_'+node.zMm
    for(const suffix of ['-left','-right','-flat-a','-flat-b']){
      if(!elements.some(e=>e.elementId===id+suffix))
        bad('HAUN_X_RECEIVER_MISSING','X-узел: отсутствует деталь '+id+suffix,
          [id+suffix])
    }
    if(elements.filter(e=>e.elementId.startsWith(id+'-')).length!==4)
      bad('HAUN_X_RECEIVER_COUNT','X-узел должен содержать ровно четыре элемента',
        [id])
  }
  return issues
}
