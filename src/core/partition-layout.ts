import { planBounds, pointOnPlanSegment, samePlanPoint, type FloorPlan, type PlanPoint } from './floor-plan'
import { graphView } from './plan-graph'
import type { TimberElement, Wall } from './project'

export interface PartitionHost {
  wallId: string
  start: PlanPoint
  end: PlanPoint
  insetMm: number
}

export interface PartitionSide extends PartitionHost {
  label: string
  endInsetMm: number
  thicknessMm: number
  startHost?: PartitionHost
  endHost?: PartitionHost
}

export const PARTITION_MIN_DEPTH = 89
export const isPartitionWall = (wallId: string) => wallId.startsWith('partition-')
const alongX = (side: { start: PlanPoint; end: PlanPoint }) => side.start.zMm === side.end.zMm

export function partitionSides(plan: FloorPlan, exterior: PartitionHost[], depth: number): PartitionSide[] {
  const sides = graphView(plan).interiorWalls.map(wall => ({
    ...wall, wallId: 'partition-' + wall.id, label: 'Перегородка ' + wall.id, insetMm: 0, endInsetMm: 0,
  }))
  function joint(side: PartitionSide, point: PlanPoint) {
    const outside = exterior.find(host => pointOnPlanSegment(point, host.start, host.end))
    if (outside) return { trim: depth, host: outside }
    const neighbours = sides.filter(other => other !== side && pointOnPlanSegment(point, other.start, other.end))
    const perpendicular = neighbours.filter(other => alongX(other) !== alongX(side))
    if (!perpendicular.length) return { trim: 0 }

    // SIGMA4's canonical graph splits continuous walls at every intersection.
    // A former "through" wall is therefore TWO collinear edge modules, each
    // ending at this same node. Resolve the node topology, not just whether
    // another segment happens to contain the endpoint in its interior.
    const incident = [side, ...neighbours]
    const xArms = incident.filter(member => alongX(member))
    const zArms = incident.filter(member => !alongX(member))
    // A physical X has a continuous X run and two Z butt arms. The
    // continuous perpendicular host takes priority over endpoint counts.
    const continuous=perpendicular.find(other=>
      !samePlanPoint(point,other.start) && !samePlanPoint(point,other.end))
    if(continuous) return {trim:continuous.thicknessMm/2,host:continuous}
    // The authored graph may still contain a T split into two arms.
    const throughX = xArms.length >= 2
    const throughZ = zArms.length >= 2 && !throughX
    if (throughX || throughZ) {
      const sideThrough = throughX ? alongX(side) : !alongX(side)
      if (sideThrough) return { trim: 0 }
      const carriers = perpendicular.slice().sort((a, b) => a.wallId.localeCompare(b.wallId))
      return { trim: carriers[0].thicknessMm / 2, host: carriers[0] }
    }

    // At an interior L, the X-axis arm is the first-course through-wall;
    // the Z arm butts against its face. The second course will reverse this
    // joint and overlap the corner; don't extend a negative-length wall.
    const host = perpendicular[0]
    return alongX(side) ? {trim:0} : {trim:host.thicknessMm/2,host}
  }
  return sides.map(side => {
    const start = joint(side, side.start), end = joint(side, side.end)
    return { ...side, insetMm: start.trim, endInsetMm: end.trim, startHost: start.host, endHost: end.host }
  })
}

export function sideOffset(side: PartitionHost, point: PlanPoint): number {
  return alongX(side)
    ? (point.xMm - side.start.xMm) * Math.sign(side.end.xMm - side.start.xMm)
    : (point.zMm - side.start.zMm) * Math.sign(side.end.zMm - side.start.zMm)
}

export function partitionAttachments(side: PartitionSide) {
  const ends = [[side.start, side.startHost], [side.end, side.endHost]] as const
  return ends.flatMap(([point, host], index) => host
    ? [{ host, positionUmm: sideOffset(host, point), atStart: index === 0 }]
    : [])
}

export function partitionInside(plan: FloorPlan, side: PartitionSide, depth: number): boolean {
  const { minX, maxX, minZ, maxZ } = planBounds(plan.exterior)
  const horizontal = alongX(side)
  const normal = horizontal ? side.start.zMm : side.start.xMm
  const half = side.thicknessMm / 2
  return horizontal
    ? normal - half >= minZ + depth && normal + half <= maxZ - depth
    : normal - half >= minX + depth && normal + half <= maxX - depth
}

/**
 * Larry Haun's three-stud channel, viewed in a horizontal stud-level cut.
 *
 * Two full-depth upright studs frame the incoming partition. Between their
 * inner edges a third *flatwise* upright stud provides a continuous nailing
 * surface flush with the INSIDE face of the exterior wall.
 *
 * A vertical stud's TimberElement position.x is the centre of its 45-mm
 * footprint; a flatwise stud uses roll=90, so sectionMm.height is its span
 * ALONG the host wall and sectionMm.width is its in-wall depth. Its x anchor
 * is therefore the left edge, not the centre. This geometry is rebuilt from
 * canonical wall / plan sources and must not be stored as authoring data.
 */
export function addPartitionBacking(
  elements: TimberElement[], walls: readonly Wall[], side: PartitionSide,
  crossPoints: ReadonlySet<string> = new Set(),
): void {
  for (const { host, positionUmm, atStart } of partitionAttachments(side)) {
    const contact=atStart?side.start:side.end
    if(crossPoints.has(contact.xMm+':'+contact.zMm))continue
    const wall = walls.find(item => item.wallId === host.wallId)
    const branch = walls.find(item => item.wallId === side.wallId)
    if (!wall || !branch) continue

    const { width, height } = wall.sectionMm
    const u = positionUmm - sideOffset(host, { xMm: wall.origin.x, zMm: wall.origin.z })
    const studLength = wall.heightMm - width * 3
    const branchEndU = atStart ? branch.sectionMm.width / 2 : branch.lengthMm - branch.sectionMm.width / 2
    const branchStud = elements.find(element =>
      element.wallId === side.wallId && element.role === 'stud' &&
      Math.abs(element.position.x - branchEndU) < 0.001)
    if (!branchStud) {
      throw new Error('У перегородки отсутствует торцевая стойка в узле примыкания')
    }

    const connect = (a: TimberElement, b: TimberElement): void => {
      if (!a.connectionIds.includes(b.elementId)) a.connectionIds.push(b.elementId)
      if (!b.connectionIds.includes(a.elementId)) b.connectionIds.push(a.elementId)
    }

    // A joined, continuous through-wall has NO physical end stud at its T.
    // Form the true Haun 3-stud receiver in both exterior and interior walls.
    // Four-arm X junctions still use their separate endpoint profile.
    const hostLength=Math.abs(host.end.xMm-host.start.xMm)+
      Math.abs(host.end.zMm-host.start.zMm)
    const isInteriorThrough=isPartitionWall(wall.wallId) &&
      positionUmm > 0 && positionUmm < hostLength
    if (!isPartitionWall(wall.wallId) || isInteriorThrough) {
      // The partition depth is the clear opening between the two 45-mm
      // exterior studs. E.g. partition 100 mm: stud centres u ±72.5 mm.
      // The flat nailer spans exactly this opening and is 45 mm deep;
      // it faces the partition at the inner face of the exterior wall.
      const clearWidth = branch.sectionMm.height
      const halfGap = clearWidth / 2
      const halfStud = width / 2
      const leftU = u - halfGap - halfStud
      const rightU = u + halfGap + halfStud
      const windowStart = leftU - halfStud
      const windowEnd = rightU + halfStud
      if (windowStart < 0 || windowEnd > wall.lengthMm) {
        throw new Error('Трёхстоечный узел выходит за край наружной стены')
      }
      // Only remove standard layout studs, whose bodies would otherwise
      // pierce the two new uprights or the flat nailer. Preserve all special
      // studs (door framing, corners, prior receivers) and reject collisions.
      const intersects = (a0: number, a1: number, b0: number, b1: number) =>
        Math.min(a1, b1) - Math.max(a0, b0) > 0.0001
      const isOrdinaryStud = (element: TimberElement) =>
        element.wallId === wall.wallId &&
        element.role === 'stud' &&
        element.elementId.startsWith(wall.wallId + ':stud-')
      const occupied = elements.filter(element =>
        element.wallId === wall.wallId &&
        (element.role === 'stud' || element.role === 'king-stud' ||
          element.role === 'jack-stud' || element.role === 'corner-backing'))
      for (const member of occupied) {
        const rolled = member.orientation.mode === 'y' && Math.abs(member.orientation.roll) === 90
        const begin = rolled
          ? member.position.x + (member.orientation.roll > 0 ? 0 : -member.sectionMm.height)
          : member.position.x - member.sectionMm.width / 2
        const end = rolled
          ? member.position.x + (member.orientation.roll > 0 ? member.sectionMm.height : 0)
          : member.position.x + member.sectionMm.width / 2
        if (!intersects(begin, end, windowStart, windowEnd)) continue
        if (!isOrdinaryStud(member)) {
          throw new Error('Трёхстоечный узел пересекает существующие элементы каркаса')
        }
        const index = elements.indexOf(member)
        if (index >= 0) elements.splice(index, 1)
      }

      const baseId = wall.wallId + ':partition-backing-' + side.wallId +
        (atStart ? '-start' : '-end')
      const upright = (suffix: string, positionU: number): TimberElement => ({
        elementId: baseId + '-' + suffix,
        wallId: wall.wallId,
        role: 'stud',
        lengthMm: studLength,
        sectionMm: { ...wall.sectionMm },
        position: { x: positionU, y: width, z: -height / 2 },
        orientation: { mode: 'y', angle: 0, roll: 0 },
        connectionIds: [],
        generated: true,
      })
      const left = upright('left', leftU)
      const right = upright('right', rightU)
      const flat: TimberElement = {
        elementId: baseId + '-flat',
        wallId: wall.wallId,
        role: 'stud',
        lengthMm: studLength,
        sectionMm: { width, height: clearWidth },
        // For mode=y, roll=90 maps local section HEIGHT to host +X and
        // local section WIDTH to -Z. The resulting cross-section fills
        // u±halfGap and sits in the innermost 45 mm of the host.
        position: {
          x: u - halfGap, y: width,
          z: isInteriorThrough
            ? (() => {
              const node=atStart ? side.start : side.end
              const other=atStart ? side.end : side.start
              // Face the arriving wall in the host's signed local normal.
              const approach=wall.orientation==='x'
                ? other.zMm-node.zMm : other.xMm-node.xMm
              return (wall.reversed ? -approach : approach)<0
                ? -height/2+width/2 : height/2-width/2
            })()
            : -height/2+width/2,
        },
        orientation: { mode: 'y', angle: 0, roll: 90 },
        connectionIds: [],
        generated: true,
      }
      elements.push(left, right, flat)
      connect(left, flat)
      connect(right, flat)
      connect(flat, branchStud)
      continue
    }

    // Remaining exception: X junction with separate physical endpoint arms.
    // Do not insert two overlapping receiver packages at the same node.
    const support = elements
      .filter(element => element.wallId === wall.wallId &&
        (element.role === 'stud' || element.role === 'king-stud'))
      .sort((a, b) => Math.abs(a.position.x - u) - Math.abs(b.position.x - u))[0]
    if (!support || Math.abs(support.position.x - u) > width + 0.001) {
      throw new Error('У внутреннего Т-узла отсутствует опорная стойка')
    }
    connect(support, branchStud)
  }
}


/**
 * Four-arm X receiver: ONE through wall with two edge uprights and two
 * flatwise nailers facing the opposite butt-wall approaches.
 * The middle pair occupies opposite faces of the 100mm host depth:
 * there is no duplicated stud, hidden 3D overlap or unsupported centre seam.
 */
export function addCrossBacking(
  elements: TimberElement[], walls: readonly Wall[], partitions: readonly PartitionSide[],
  point:PlanPoint,
): void {
  const x=partitions.find(side=>
    alongX(side)&&pointOnPlanSegment(point,side.start,side.end)&&
    !samePlanPoint(point,side.start)&&!samePlanPoint(point,side.end))
  const branches=partitions.filter(side=>
    !alongX(side)&&(samePlanPoint(point,side.start)||samePlanPoint(point,side.end)))
  if(!x||branches.length!==2)
    throw Error('X-узел требует одну сквозную стену по X и две торцевые ветви по Z')
  const wall=walls.find(w=>w.wallId===x.wallId)
  if(!wall)throw Error('Не найдена сквозная стена X-узла')
  const width=wall.sectionMm.width,depth=wall.sectionMm.height
  if(depth<2*width)throw Error('X-узел: толщина стены недостаточна для двух плоских крепёжных досок')
  if(branches.some(side=>side.thicknessMm!==branches[0].thicknessMm))
    throw Error('X-узел: разные толщины примыкающих перегородок')
  const clear=branches[0].thicknessMm
  const u=sideOffset(x,point)-sideOffset(x,{xMm:wall.origin.x,zMm:wall.origin.z})
  const half=clear/2, studHalf=width/2
  if(u-half-width<0||u+half+width>wall.lengthMm)
    throw Error('X-узел слишком близко к торцу сквозной стены')
  const prefix=wall.wallId+':cross-backing-'+point.xMm+'_'+point.zMm
  const height=wall.heightMm-3*width
  const member=(suffix:string,xPos:number,zPos:number,flat:boolean):TimberElement=>({
    elementId:prefix+'-'+suffix,wallId:wall.wallId,role:'stud',
    lengthMm:height,
    sectionMm: flat?{width,height:clear}:{...wall.sectionMm},
    position:{x:xPos,y:width,z:zPos},
    orientation:{mode:'y',angle:0,roll:flat?90:0},
    connectionIds:[],generated:true,
  })
  const left=member('left',u-half-studHalf,-depth/2,false)
  const right=member('right',u+half+studHalf,-depth/2,false)
  const near=member('flat-a',u-half,-depth/2+width/2,true)
  const far=member('flat-b',u-half,depth/2-width/2,true)
  const connect=(a:TimberElement,b:TimberElement)=>{
    if(!a.connectionIds.includes(b.elementId))a.connectionIds.push(b.elementId)
    if(!b.connectionIds.includes(a.elementId))b.connectionIds.push(a.elementId)
  }
  for(const flat of [near,far]){connect(left,flat);connect(right,flat)}
  for(const branchSide of branches){
    const atStart=samePlanPoint(branchSide.start,point)
    const branch=walls.find(w=>w.wallId===branchSide.wallId)
    if(!branch)throw Error('Отсутствует примыкающая стена X-узла')
    const studU=atStart?width/2:branch.lengthMm-width/2
    const post=elements.find(e=>e.wallId===branch.wallId&&e.role==='stud'&&
      Math.abs(e.position.x-studU)<0.001)
    if(!post)throw Error('Нет торцевой стойки примыкающей стены X-узла')
    // Host local normal (Z) follows the global 2D normal: x->+X
    // corresponds to host -Z; the two approaches choose opposite faces.
    const outgoing=atStart?branchSide.end:branchSide.start
    const approach=outgoing.zMm-point.zMm
    const facingNegative=(wall.reversed?-approach:approach)<0
    connect(post,facingNegative?near:far)
  }
  const ids=[left,right,near,far]
  if(ids.some(e=>elements.some(old=>old.elementId===e.elementId)))
    throw Error('Повторный X-узел '+prefix)
  elements.push(...ids)
}
