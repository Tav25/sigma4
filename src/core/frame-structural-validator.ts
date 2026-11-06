/**
 * SIGMA4 S18 — independent assembly-contact and support validator.
 *
 * Evaluates the final DERIVED 3D solids, after all wall, corner, opening,
 * T/L/X, and top-cap algorithms have run. It never mutates the authored JSON.
 * This is a geometric integrity check — NOT a timber engineering design.
 *
 * The AABBs are evaluated in millimetres using exactly the scene orientation
 * transforms. Current linked frames are orthogonal; if sloped timber is
 * introduced later, a true oriented-box intersection is needed for collisions.
 */
import type { ProjectDocument, TimberElement, ValidationIssue } from './project'
import { projectToScene } from '../scene/project-to-scene'
import {
  boxCenterWorld, generateTimberGeometry, rotateVectorByQuaternion,
} from './timber'

type Axis = 'x' | 'y' | 'z'
export interface StructuralBox {
  id: string
  wallId: string
  element: TimberElement
  min: Record<Axis, number>
  max: Record<Axis, number>
}
const TOUCH = 0.15 // mm of purely numerical tolerance, not an acceptable physical gap
const OVERLAP = 0.15 // strictly positive intersection threshold, mm
const AXES: readonly Axis[] = ['x','y','z']

function issue(code:string, severity: 'error'|'warning', details:string, ids:string[]):ValidationIssue {
  return {
    code, severity, messageRu:details,
    path:ids.length ? 'assembly.elements[id='+ids[0]+']' : 'assembly.elements',
    affectedIds:ids,
  }
}

/** Read the renderer's actual physical orientation; return world mm bounds. */
export function physicalTimberBoxes(doc:ProjectDocument):StructuralBox[] {
  const original=new Map(doc.assembly.elements.map(e=>[e.elementId,e]))
  return projectToScene(doc).elements.flatMap(scene=>{
    const el=original.get(scene.id)
    if(!el)return []
    const spec=generateTimberGeometry(scene)
    const centre=boxCenterWorld(scene)
    const ux=rotateVectorByQuaternion({x:1,y:0,z:0},spec.quaternion)
    const uy=rotateVectorByQuaternion({x:0,y:1,z:0},spec.quaternion)
    const uz=rotateVectorByQuaternion({x:0,y:0,z:1},spec.quaternion)
    const half={x:spec.size.x/2,y:spec.size.y/2,z:spec.size.z/2}
    const extent=(axis:Axis)=>
      Math.abs(ux[axis])*half.x+Math.abs(uy[axis])*half.y+
      Math.abs(uz[axis])*half.z
    if(!AXES.every(axis=>Number.isFinite(centre[axis])&&Number.isFinite(extent(axis))))
      return []
    return [{
      id:scene.id,wallId:el.wallId,element:el,
      min:{x:centre.x-extent('x'),y:centre.y-extent('y'),z:centre.z-extent('z')},
      max:{x:centre.x+extent('x'),y:centre.y+extent('y'),z:centre.z+extent('z')},
    }]
  })
}
function intersection(a:StructuralBox,b:StructuralBox,axis:Axis):number {
  return Math.min(a.max[axis],b.max[axis])-Math.max(a.min[axis],b.min[axis])
}
export function volumesOverlap(a:StructuralBox,b:StructuralBox):boolean {
  return AXES.every(axis=>intersection(a,b,axis)>OVERLAP)
}
/** A face contact has 2 positive-overlap dimensions, 1 flush dimension. */
export function boxesFaceContact(a:StructuralBox,b:StructuralBox):boolean {
  const gaps=AXES.map(axis=>intersection(a,b,axis))
  return gaps.every(delta=>delta>=-TOUCH) &&
    gaps.filter(delta=>delta>OVERLAP).length===2 &&
    gaps.some(delta=>Math.abs(delta)<=TOUCH)
}
function horizontalAreaOverlap(a:StructuralBox,b:StructuralBox):boolean {
  return intersection(a,b,'x')>OVERLAP && intersection(a,b,'z')>OVERLAP
}
function restsOn(upper:StructuralBox,lower:StructuralBox):boolean {
  return horizontalAreaOverlap(upper,lower) &&
    Math.abs(upper.min.y-lower.max.y)<=TOUCH
}
function supportsAbove(lower:StructuralBox,upper:StructuralBox):boolean {
  return horizontalAreaOverlap(lower,upper) &&
    Math.abs(lower.max.y-upper.min.y)<=TOUCH
}
const isVertical=(e:TimberElement)=>[
  'stud','king-stud','jack-stud','corner-backing',
  'cripple-top','cripple-bottom','cripple-stud',
].includes(e.role) && e.orientation.mode==='y'
const isFullHeight=(e:TimberElement)=>
  (e.role==='stud'||e.role==='king-stud'||e.role==='corner-backing') &&
  e.orientation.mode==='y'
const firstTop=(e:TimberElement)=>
  e.role==='top-plate' && e.elementId.includes(':plate-top-1') ||
  (e.role==='top-plate'&&e.elementId==='plate-top-1')
const upperCap=(e:TimberElement)=>
  e.role==='top-plate' && e.elementId.includes(':plate-top-2')
const isHeader=(e:TimberElement)=>
  e.role==='header'||e.role==='garage-lintel-preview'

/**
 * Structural check is deliberately scoped to linked generated frames.
 * Legacy stand-alone timber assemblies keep their previous validation and
 * corner handling; geometry and connection conventions differ there.
 */
export function validateAssemblyContacts(doc:ProjectDocument):ValidationIssue[] {
  if(doc.building.floorPlan?.frame?.built!==true)return []
  const issues:ValidationIssue[]=[]
  const boxes=physicalTimberBoxes(doc)
  const byId=new Map(boxes.map(box=>[box.id,box]))
  const byWall=new Map<string,StructuralBox[]>()
  for(const box of boxes){
    const list=byWall.get(box.wallId)??[]
    list.push(box)
    byWall.set(box.wallId,list)
  }

  // A broken logical joint must not look like a real physical connection:
  // require known, non-self and reciprocal edges; require face contact on
  // the generated Haun top caps and receiving-channel/backing assemblies.
  // For header↔jack links, the contact is checked by load-path checks below.
  for(const a of boxes){
    const used=new Set<string>()
    for(const target of a.element.connectionIds){
      if(used.has(target)){
        issues.push(issue('STRUCTURAL_DUPLICATE_CONNECTION','error',
          'Повторная связь '+a.id+' → '+target,[a.id,target]))
        continue
      }
      used.add(target)
      const b=byId.get(target)
      if(!b||a.id===target){
        issues.push(issue('STRUCTURAL_INVALID_CONNECTION','error',
          'Конструктивная связь '+a.id+' с несуществующим или тем же элементом '+target,
          [a.id,target]))
        continue
      }
      if(!b.element.connectionIds.includes(a.id)){
        issues.push(issue('STRUCTURAL_ONE_WAY_CONNECTION','error',
          'Несимметричная связь между досками '+a.id+' и '+target,[a.id,target]))
      }
      // Inspect a pair once; the opposite end is still verified above.
      if(a.id>=b.id)continue
      if(a.id.includes(':plate-top-2')||b.id.includes(':plate-top-2')||
        a.id.includes(':partition-backing-')||b.id.includes(':partition-backing-')){
        if(!boxesFaceContact(a,b)){
          issues.push(issue('STRUCTURAL_JOINT_NOT_TOUCHING','error',
            'Объявленное соединение не имеет контакта граней: '+a.id+' ↔ '+b.id+
            '; пересечение X/Y/Z, мм = '+
            AXES.map(axis=>intersection(a,b,axis).toFixed(2)).join(' / '),
            [a.id,b.id]))
        }
      }
    }
  }

  // Do not count touching ends as collisions. Exclude overlaid horizontal
  // courses and intentional fastener/connection surfaces; inspect the actual
  // volumetric timber of vertical members (including rolled nailers) and
  // independently the physical second top-cap plies.
  const collisionGroups=[
    (box:StructuralBox)=>isVertical(box.element),
    (box:StructuralBox)=>upperCap(box.element),
  ]
  for(const [wallId,list] of byWall){
    for(const predicate of collisionGroups){
      const solids=list.filter(predicate)
      const wall=doc.building.walls.find(w=>w.wallId===wallId)
      const along:Axis=wall?.orientation==='z'?'z':'x'
      solids.sort((a,b)=>a.min[along]-b.min[along])
      for(let i=0;i<solids.length;i++){
        const a=solids[i]
        for(let j=i+1;j<solids.length;j++){
          const b=solids[j]
          if(b.min[along]>=a.max[along]-OVERLAP)break
          if(volumesOverlap(a,b)) {
            issues.push(issue('STRUCTURAL_TIMBER_COLLISION','error',
              'Доски занимают один объём: '+a.id+' и '+b.id+
              ' (стена '+wallId+')',[a.id,b.id]))
          }
        }
      }
    }
  }

  for(const [wallId,solids] of byWall){
    const bases=solids.filter(b=>b.element.role==='bottom-plate')
    const caps=solids.filter(b=>firstTop(b.element))
    const headers=solids.filter(b=>isHeader(b.element))
    const sills=solids.filter(b=>b.element.role==='sill')
    for(const stud of solids.filter(b=>isVertical(b.element))){
      const e=stud.element
      const shouldHaveBottom=isFullHeight(e)||
        e.role==='jack-stud'||e.role==='cripple-bottom'
      if(shouldHaveBottom && !bases.some(base=>restsOn(stud,base))){
        issues.push(issue('STRUCTURAL_MISSING_BOTTOM_SUPPORT','error',
          'Стойка '+stud.id+' не опирается на нижнюю обвязку стены '+wallId,
          [stud.id,wallId]))
      }
      const shouldHaveTop=isFullHeight(e)||e.role==='cripple-top'
      if(shouldHaveTop && !caps.some(cap=>supportsAbove(stud,cap))){
        issues.push(issue('STRUCTURAL_MISSING_TOP_CONTACT','error',
          'Стойка '+stud.id+' не касается первого слоя верхней обвязки '+wallId,
          [stud.id,wallId]))
      }
      if(e.role==='jack-stud' && !headers.some(header=>supportsAbove(stud,header))){
        issues.push(issue('STRUCTURAL_JACK_NOT_SUPPORTING_HEADER','error',
          'Опорная стойка '+stud.id+' не касается снизу перемычки',
          [stud.id,wallId]))
      }
      if(e.role==='cripple-top' && !headers.some(header=>restsOn(stud,header)) &&
        !sills.some(sill=>restsOn(stud,sill))){
        issues.push(issue('STRUCTURAL_UPPER_CRIPPLE_UNSUPPORTED','error',
          'Короткая верхняя стойка '+stud.id+' не опирается на перемычку',
          [stud.id,wallId]))
      }
      if(e.role==='cripple-bottom' && !sills.some(sill=>supportsAbove(stud,sill))){
        issues.push(issue('STRUCTURAL_SILL_UNSUPPORTED','error',
          'Короткая нижняя стойка '+stud.id+' не касается подоконной доски',
          [stud.id,wallId]))
      }
    }

    // Both upper courses must touch a lower plate in at least one physical
    // footprint. The long Haun lap may bridge a T gap, but the non-bridging
    // portion must genuinely bear on the first course.
    const second=solids.filter(box=>upperCap(box.element))
    for(const cap of second){
      if(!caps.some(lower=>restsOn(cap,lower))){
        issues.push(issue('STRUCTURAL_UPPER_PLATE_UNSUPPORTED','error',
          'Верхняя доска '+cap.id+' не касается нижнего слоя обвязки',
          [cap.id,wallId]))
      }
    }
  }

  // Engineering checks deliberately never set "passed": design load paths,
  // foundation, lateral bracing, fastening and header capacities require
  // an independently selected building code and material/load model.
  return issues
}
