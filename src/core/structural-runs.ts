import { graphView } from './plan-graph'
import type { FloorPlan, PlanInteriorWall, PlanPoint } from './floor-plan'

/**
 * Haun-style physical framing runs.
 *
 * Graph edges are EDITING entities: a tee node splits an edge for precise
 * selection, but does NOT necessarily split the carpentered wall. Merge only
 * the two COLLINEAR arms of a three-arm T node, and only if both have the
 * same thickness. Never merge through an X node (4 arms) or a corner.
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
  for(const indexes of nodes.values()){
    if(indexes.length!==3)continue
    const pairs: [number,number][]=[]
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++){
      const wa=authored[indexes[a]],wb=authored[indexes[b]]
      if(wa.thicknessMm!==wb.thicknessMm||horizontal(wa)!==horizontal(wb))continue
      // Equal axis and same coordinate guarantee true collinearity.
      if(horizontal(wa)?wa.start.zMm===wb.start.zMm:wa.start.xMm===wb.start.xMm)
        pairs.push([indexes[a],indexes[b]])
    }
    if(pairs.length===1)join(...pairs[0])
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
  const bad=(code:string, messageRu:string, ids:string[])=>{
    issues.push({code,severity:'error',path:'building.floorPlan.graph',
      messageRu,affectedIds:ids})
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
  return issues
}
