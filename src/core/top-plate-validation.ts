/**
 * SIGMA4 0.1.28 S22.2 — physical double-top-plate lap and splice validation.
 *
 * IRC 2024 R602.3.2:
 *  - double top plate overlaps at corners / bearing intersections;
 *  - END joints of the two top-plate layers are offset >= 610 mm;
 *  - a 610 mm offset is NOT a requirement for extending a plate past an
 *    orthogonal T/X crossing. Validate those as real face-contact ties.
 * Table R602.3(1), item 14 also calls for a 24-inch splice lap each side
 * of a butt joint; check a single continuous opposing course across both
 * 610-mm shoulders. Actual nail patterns are not represented in the JSON
 * and engineeringStatus therefore remains 'not_evaluated'.
 *
 * All measurements use derived, materialized boards; NEVER alter source JSON.
 */
import { planStructuralFrameSides } from './plan-frame'
import { isPartitionWall, partitionAttachments, type PartitionSide } from './partition-layout'
import { physicalTimberBoxes, boxesFaceContact, type StructuralBox } from './frame-structural-validator'
import type { ProjectDocument, TimberElement, ValidationIssue, Wall } from './project'
import type { PlanPoint } from './floor-plan'

export const TOP_PLATE_SPLICE_LAP_MM = 610
const EPS = 0.15
const atX=(point:PlanPoint)=>point.xMm+'_'+point.zMm
const isFirst=(el:TimberElement,wallId:string)=>
  el.role==='top-plate'&&el.elementId.startsWith(wallId+':plate-top-1')
const isUpper=(el:TimberElement,wallId:string)=>
  el.role==='top-plate'&&el.elementId.startsWith(wallId+':plate-top-2')
type Plate={element:TimberElement;start:number;end:number}
const asPlate=(element:TimberElement):Plate=>({
  element,start:element.position.x,end:element.position.x+element.lengthMm,
})
const centreU=(wall:Wall,p:PlanPoint)=>
  wall.orientation==='z'
    ?(wall.origin.z-p.zMm)*(wall.reversed?-1:1)
    :(p.xMm-wall.origin.x)*(wall.reversed?-1:1)

function addIssue(issues:ValidationIssue[],code:string,messageRu:string,ids:string[]){
  issues.push({code,severity:'error',path:'assembly.elements',
    messageRu,affectedIds:ids})
}
const near=(box:StructuralBox,p:PlanPoint,radius:number)=>
  box.min.x<=p.xMm+radius && box.max.x>=p.xMm-radius &&
  box.min.z<=p.zMm+radius && box.max.z>=p.zMm-radius

/** Independent final-board validation. Invalid derived geometry blocks build/import/edit. */
export function validateTopPlateLaps(doc:ProjectDocument):ValidationIssue[] {
  const plan=doc.building.floorPlan
  if(!plan?.frame?.built)return []
  const issues:ValidationIssue[]=[]
  const walls=new Map(doc.building.walls.map(w=>[w.wallId,w]))
  const all=doc.assembly.elements
  const layer=new Map<string,{first:Plate[];upper:Plate[]}>()
  for(const wall of doc.building.walls){
    const first=all.filter(el=>isFirst(el,wall.wallId)).map(asPlate)
      .sort((a,b)=>a.start-b.start)
    const upper=all.filter(el=>isUpper(el,wall.wallId)).map(asPlate)
      .sort((a,b)=>a.start-b.start)
    layer.set(wall.wallId,{first,upper})
    if(!first.length||!upper.length){
      addIssue(issues,'TOP_PLATE_MISSING_COURSE',
        'У стены '+wall.wallId+' отсутствует один из двух слоёв верхней обвязки',
        [wall.wallId])
      continue
    }
    for(const ply of [...first,...upper]){
      if(!Number.isFinite(ply.start)||!Number.isFinite(ply.end)||
        ply.end-ply.start<EPS){
        addIssue(issues,'TOP_PLATE_INVALID_BOARD',
          'Некорректная длина верхней доски '+ply.element.elementId,
          [ply.element.elementId])
      }
    }
    // First-course panels must have continuous support even at a T/X junction.
    // First-course butt splices are permitted if the second course spans them.
    if(first[0].start>EPS || first[first.length-1].end<wall.lengthMm-EPS)
      addIssue(issues,'TOP_PLATE_FIRST_COURSE_GAP',
        'Первый верхний слой стены '+wall.wallId+' не покрывает её полную длину',
        first.map(p=>p.element.elementId))
    for(const [course,opposite,name] of [
      [first,upper,'нижнем'],[upper,first,'верхнем'],
    ] as const){
      for(let i=1;i<course.length;i++){
        const left=course[i-1],right=course[i]
        if(right.start<left.end-EPS){
          addIssue(issues,'TOP_PLATE_COURSE_OVERLAP',
            'В '+name+' слое стены '+wall.wallId+
            ' наложились две доски в одной плоскости',
            [left.element.elementId,right.element.elementId])
          continue
        }
        if(Math.abs(right.start-left.end)>EPS){
          if(name==='нижнем')addIssue(issues,'TOP_PLATE_FIRST_COURSE_GAP',
            'Разрыв первого верхнего слоя стены '+wall.wallId,
            [left.element.elementId,right.element.elementId])
          // The upper course may have a deliberately opened T/X channel,
          // spanned physically by a perpendicular wall's second plate.
          continue
        }
        const joint=left.end
        const cover=opposite.find(piece=>
          piece.start<=joint-TOP_PLATE_SPLICE_LAP_MM+EPS &&
          piece.end>=joint+TOP_PLATE_SPLICE_LAP_MM-EPS)
        if(!cover){
          addIssue(issues,'TOP_PLATE_SPLICE_LAP_TOO_SHORT',
            'Торцевой стык верхней обвязки '+wall.wallId+' на отметке '+
            joint.toFixed(1)+' мм: противоположный слой должен непрерывно '+
            'перекрывать минимум по 610 мм с каждой стороны (IRC R602.3.2)',
            [left.element.elementId,right.element.elementId])
        }
      }
    }
  }

  // Check physical T/L/X ties at the intersection, not just connectionIds
  // (which could be missing or stale). Need two host-cap contacts at an
  // interior T, or two contacts in total at an X with opposing branches.
  const sides=planStructuralFrameSides(plan)
  const partitions=sides.filter((side):side is PartitionSide=>'endInsetMm' in side)
  type Lap={point:PlanPoint;hostId:string;branches:{wallId:string}[]}
  const joints=new Map<string,Lap>()
  for(const side of partitions){
    for(const att of partitionAttachments(side)){
      const trim=att.atStart?side.insetMm:side.endInsetMm
      if(trim<=EPS)continue
      const point=att.atStart?side.start:side.end
      const key=atX(point)
      const old=joints.get(key)
      if(old){
        if(old.hostId!==att.host.wallId)
          addIssue(issues,'TOP_PLATE_AMBIGUOUS_INTERSECTION',
            'Перекрёстный узел имеет неоднозначную сквозную стену '+key,
            [old.hostId,att.host.wallId])
        old.branches.push({wallId:side.wallId})
      }else joints.set(key,{point,hostId:att.host.wallId,
        branches:[{wallId:side.wallId}]})
    }
  }
  const upperBoxes=physicalTimberBoxes(doc).filter(box=>
    isUpper(box.element,box.wallId))
  for(const joint of joints.values()){
    const host=walls.get(joint.hostId)
    if(!host)continue
    const branchWalls=joint.branches.map(b=>walls.get(b.wallId)).filter(
      (w):w is Wall=>!!w)
    if(!branchWalls.length)continue
    const radius=Math.max(host.sectionMm.height,
      ...branchWalls.map(w=>w.sectionMm.height))*2+host.sectionMm.width
    const nearby=(id:string)=>upperBoxes.filter(box=>
      box.wallId===id && near(box,joint.point,radius))
    const hostCaps=nearby(host.wallId)
    const incoming=joint.branches.map(b=>nearby(b.wallId))
    const contacts=new Set<string>()
    let disconnected=false
    for(const branchCaps of incoming){
      const touching=hostCaps.filter(cap=>branchCaps.some(branch=>
        boxesFaceContact(branch,cap)))
      for(const cap of touching)contacts.add(cap.id)
      if(!touching.length)disconnected=true
    }
    const u=centreU(host,joint.point)
    const inside=u>radius/3&&u<host.lengthMm-radius/3
    // At an interior T or X the host cap must terminate on BOTH sides of
    // the incoming double-top-plate overlap; a missing half is not a lap.
    if(inside&&contacts.size<2)disconnected=true
    if(joint.branches.length===2 &&
      !incoming[0].some(a=>incoming[1].some(b=>boxesFaceContact(a,b))))
      disconnected=true
    if(disconnected){
      addIssue(issues,'TOP_PLATE_INTERSECTION_LAP_MISSING',
        'В узле '+atX(joint.point)+' нет непрерывной перевязки второго слоя '+
        'с реальным контактом досок: '+host.wallId+' ← '+
        joint.branches.map(b=>b.wallId).join(', '),
        [host.wallId,...joint.branches.map(b=>b.wallId)])
    }
    // The host first course must bridge the width of the incoming partition
    // where this is a true through-junction, not a physical panel-end butt.
    if(inside){
      const half=Math.max(...branchWalls.map(w=>w.sectionMm.height))/2
      if(!layer.get(host.wallId)?.first.some(piece=>
        piece.start<=u-half+EPS&&piece.end>=u+half-EPS)){
        addIssue(issues,'TOP_PLATE_THROUGH_FIRST_BROKEN',
          'Первый слой сквозной стены '+host.wallId+
          ' должен проходить через весь узел '+atX(joint.point),
          [host.wallId])
      }
    }
  }
  return issues
}
