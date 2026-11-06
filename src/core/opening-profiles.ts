import type { Opening, TimberElement, ValidationIssue, Wall } from './project'
import type { WindowOpening } from './window'
import type { TimberElement as PanelElement } from './timber'

/** Stage 3: independent, explicit PREVIEW profiles — no silent span-table approvals. */
export type HeaderProfileKind = 'bearing-double-preview' | 'nonbearing-flat' | 'garage-engineered-preview'
export interface ResolvedHeaderProfile {
  kind: HeaderProfileKind
  depthMm: number
  jackCount: number
  kingCount: number
}
const EPS = 0.001

export function headerProfile(opening: Opening, wall: Pick<Wall,'wallId'|'sectionMm'>): ResolvedHeaderProfile {
  if (wall.wallId.startsWith('partition-')) {
    return { kind: 'nonbearing-flat', depthMm: wall.sectionMm.width, jackCount: 0, kingCount: 1 }
  }
  if (opening.type === 'garage-door') {
    return {
      kind: 'garage-engineered-preview',
      depthMm: opening.garage?.lintelPreviewDepthMm ?? 286,
      jackCount: opening.garage?.jackStudsPerSide ?? 2, kingCount: 1,
    }
  }
  return {
    kind: 'bearing-double-preview',
    depthMm: opening.headerPreview?.depthMm ?? wall.sectionMm.height,
    jackCount: opening.headerPreview?.jackStudsPerSide ?? 1, kingCount: 1,
  }
}

/** Standalone source-preserving transform, applied only to LINKED exterior panels.
 * Everything is wall-local in mm. Two actual 45mm plies belong INSIDE the wall,
 * not on either side of its outer faces. Their strength remains unverified.
 */
export function applyLinkedHeaderProfile(
  panel: WindowOpening[], // authored openings, never mutated
  elements: PanelElement[],
  wall: Wall,
): void {
  const sw=wall.sectionMm.width, depth=wall.sectionMm.height
  for(const opening of panel) {
    const spec=headerProfile({
      id:opening.id,wallId:wall.wallId,type:opening.type,
      positionUmm:opening.positionXmm,widthMm:opening.widthMm,
      heightMm:opening.heightMm,sillHeightMm:opening.sillHeightMm,
      ...(opening.garage?{garage:opening.garage}:{}),
      ...(opening.headerPreview?{headerPreview:opening.headerPreview}:{}),
    },wall)
    if(spec.kind==='nonbearing-flat')continue
    const prefix=opening.id+'-'
    const x=opening.positionXmm, right=x+opening.widthMm
    const kingLeft=elements.find(e=>e.id===prefix+'king-left')
    const kingRight=elements.find(e=>e.id===prefix+'king-right')
    const headers=elements.filter(e=>e.id===prefix+'header-1'||e.id===prefix+'header-2')
    if(!kingLeft||!kingRight||headers.length!==2)
      throw Error('Не удалось найти обязательное обрамление '+opening.id)
    const requested=spec.jackCount
    const existing=elements.filter(e=>e.id.startsWith(prefix+'jack-')&&e.role==='jack-stud')
    if(existing.length!==requested*2) {
      if(opening.type==='garage-door')throw Error('Гаражные опоры не соответствуют спецификации')
      // Baseline window/door generator creates one jack on either side.
      if(existing.length!==2)throw Error('Не найден исходный комплект опор '+opening.id)
      for(let i=1;i<requested;i++)for(const side of ['left','right'] as const){
        const template=elements.find(e=>e.id===prefix+'jack-'+side)!
        elements.push({
          ...template,
          id:prefix+'jack-'+side+'-'+(i+1),
          position:{...template.position,
            x:side==='left'?x-sw/2-i*sw:right+sw/2+i*sw},
        })
      }
    }
    kingLeft.position={...kingLeft.position,x:x-requested*sw-sw/2}
    kingRight.position={...kingRight.position,x:right+requested*sw+sw/2}
    const length=opening.widthMm+2*requested*sw
    for(const e of headers){
      const front=e.id.endsWith('-1')
      e.length=length
      e.position={...e.position,
        x:x-requested*sw,
        z:front?-depth/2+sw/2:depth/2-sw/2}
      e.height=spec.depthMm
    }
    // One whole ply must fit each face with no overlap of the other ply.
    if(2*sw>depth+EPS)
      throw Error('Толщина наружной стены недостаточна для двух досок перемычки '+opening.id)
  }
}

/** Geometry and support checks on the final derived assembly, not a schematic. */
export function verifyOpeningFraming(opening:Opening,wall:Wall,assembly:readonly TimberElement[]):ValidationIssue[] {
  const issue=(code:string,severity:'error'|'warning',messageRu:string):ValidationIssue=>({
    code,severity,path:'building.openings[id='+opening.id+']',
    messageRu,affectedIds:[opening.id,wall.wallId],
  })
  const specs=headerProfile(opening,wall)
  const own=assembly.filter(e=>e.wallId===wall.wallId)
  const id=(suffix:string)=>wall.wallId+':'+opening.id+'-'+suffix
  const get=(suffix:string)=>own.find(e=>e.elementId===id(suffix))
  const head=own.filter(e=>e.elementId===id('header-1')||e.elementId===id('header-2'))
  const start=opening.positionUmm,finish=start+opening.widthMm
  const sill=opening.sillHeightMm+opening.heightMm
  const sw=wall.sectionMm.width
  const errors:ValidationIssue[]=[]
  const fullHeight=wall.heightMm-sw*3
  for(const side of ['left','right'] as const){
    const king=get('king-'+side)
    const centre=side==='left'
      ? start-specs.jackCount*sw-sw/2
      : finish+specs.jackCount*sw+sw/2
    if(!king||Math.abs(king.position.x-centre)>EPS||
      Math.abs(king.lengthMm-fullHeight)>EPS){
      errors.push(issue('OPENING_KING_STUD_INVALID','error',
        'Не установлена правильная крайняя стойка '+side+' проёма '+opening.id))
    }
    for(let n=0;n<specs.jackCount;n++){
      const jack=get('jack-'+side+(n?'-'+(n+1):''))
      const expected=side==='left'?start-sw/2-n*sw:finish+sw/2+n*sw
      if(!jack||jack.role!=='jack-stud'||Math.abs(jack.position.x-expected)>EPS||
        Math.abs(jack.position.y-sw)>EPS||
        Math.abs(jack.position.y+jack.lengthMm-sill)>EPS){
        errors.push(issue('OPENING_JACK_STUD_INVALID','error',
          'Опорная стойка №'+(n+1)+' ('+side+') не доходит до низа перемычки '+opening.id))
      }
    }
  }
  if(specs.kind==='nonbearing-flat'){
    const flat=get('header')
    if(!flat||head.length!==0||
      Math.abs(flat.position.x-start)>EPS||
      Math.abs(flat.position.y-(sill+sw/2))>EPS||
      Math.abs(flat.lengthMm-opening.widthMm)>EPS||
      flat.sectionMm.width!==sw){
      errors.push(issue('NONBEARING_FLAT_HEADER_INVALID','error',
        'В ненесущей перегородке должна быть одна плоская перемычка '+opening.id))
    }
    return errors
  }
  if(head.length!==2){
    errors.push(issue('HEADER_MEMBER_COUNT_INVALID','error',
      'Нужны две доски предварительной перемычки '+opening.id))
  }
  const expectedX=start-specs.jackCount*sw
  const expectedLen=opening.widthMm+2*specs.jackCount*sw
  head.forEach(h=>{
    if(Math.abs(h.position.x-expectedX)>EPS ||
      Math.abs(h.position.y-sill)>EPS ||
      Math.abs(h.lengthMm-expectedLen)>EPS ||
      Math.abs(h.sectionMm.height-specs.depthMm)>EPS ||
      h.orientation.mode!=='x'){
      errors.push(issue('HEADER_BEARING_GEOMETRY_INVALID','error',
        'Перемычка '+opening.id+' должна опираться всей шириной на jack-стойки с обеих сторон'))
    }
  })
  // Two plies must occupy the interior of the wall, not extend through
  // the exterior sheathing plane or overlap each other.
  if(head.length===2) {
    const ordered=[...head].sort((a,b)=>a.position.z-b.position.z)
    if(ordered[0].position.z-ordered[0].sectionMm.width/2< -wall.sectionMm.height/2-EPS||
      ordered[1].position.z+ordered[1].sectionMm.width/2>wall.sectionMm.height/2+EPS||
      ordered[0].position.z+ordered[0].sectionMm.width/2 >
        ordered[1].position.z-ordered[1].sectionMm.width/2+EPS)
      errors.push(issue('HEADER_PLY_OUTSIDE_WALL','error',
        'Доски перемычки '+opening.id+' должны находиться внутри толщины стены'))
  }
  return errors
}

/** Validate author-controlled framing and load inputs before regeneration. */
export function validateOpeningHeaderInputs(opening: Opening, wallIsPartition:boolean):ValidationIssue[] {
  const issues:ValidationIssue[]=[]
  const issue=(code:string,messageRu:string):ValidationIssue=>({
    code,severity:'error',path:'building.openings[id='+opening.id+']',
    messageRu,affectedIds:[opening.id,opening.wallId],
  })
  if (opening.headerPreview!==undefined) {
    const h=opening.headerPreview
    if (wallIsPartition||opening.type==='garage-door')
      issues.push(issue('HEADER_PROFILE_INCOMPATIBLE',
        'Предварительный двухдосочный профиль допустим только для наружного окна или двери'))
    if(!h||!Number.isInteger(h.depthMm)||h.depthMm<90||h.depthMm>610||
      !Number.isInteger(h.jackStudsPerSide)||h.jackStudsPerSide<1||h.jackStudsPerSide>4)
      issues.push(issue('HEADER_PREVIEW_INVALID',
        'Глубина перемычки должна быть от 90 до 610 мм, число jack-стоек от 1 до 4'))
  }
  if(opening.designLoads!==undefined){
    const d=opening.designLoads
    if(wallIsPartition||!d||
      !Number.isFinite(d.permanentKNPerM)||d.permanentKNPerM<0||
      !Number.isFinite(d.variableKNPerM)||d.variableKNPerM<0||
      d.permanentKNPerM+d.variableKNPerM<=0)
      issues.push(issue('HEADER_LOADS_INVALID',
        'Для наружной стены укажите неотрицательные постоянную и переменную нагрузки (кН/м), сумма должна быть >0'))
  }
  return issues
}

export function verifyHeaderLoadInputs(opening: Opening,wall:Wall):ValidationIssue[] {
  if(wall.wallId.startsWith('partition-'))return []
  const path='building.openings[id='+opening.id+']'
  const make=(code:string,severity:'error'|'warning',messageRu:string):ValidationIssue=>({
    code,severity,path,messageRu,affectedIds:[opening.id,opening.wallId],
  })
  const load=opening.designLoads
  if(load===undefined)return [make('HEADER_LOADS_UNSPECIFIED','warning',
    opening.id+': нагрузки на перемычку не заданы; подбор сечения и опор НЕ проверен')]
  const a=load.permanentKNPerM,b=load.variableKNPerM
  if(![a,b].every(v=>Number.isFinite(v)&&v>=0)||a+b<=0)
    return [make('HEADER_LOADS_INVALID','error',
      opening.id+': требуются неотрицательные постоянная и переменная погонные нагрузки, суммарно >0')]
  const L=opening.widthMm/1000
  const w=a+b
  const moment=w*L*L/8
  const reaction=w*L/2
  return [make('HEADER_DEMAND_REQUIRES_DESIGN','warning',
    opening.id+': при заданной равномерной нагрузке '+w.toFixed(2)+
    ' кН/м: M≈'+moment.toFixed(2)+' кН·м, реакция каждой опоры≈'+reaction.toFixed(2)+
    ' кН. Это только усилия по простой балочной схеме. Прочность, прогиб, опирание, '+
    'фактические нагрузки и крепёж должен подтвердить инженер; статус не оценён')]
}
