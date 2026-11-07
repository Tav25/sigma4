/**
 * Derived SIGMA4 floor rooms. Pure computation from the canonical FloorPlan.
 *
 * An exact axis-aligned cell arrangement represents usable floor surface:
 * outside the exterior polygon and all wall footprints are excluded.
 * Rooms are four-neighbour connected components (point contact is NOT a door).
 * Doors/windows do not erase the partition separating two floor rooms.
 * Neither Three.js nor React stores independent geometry.
 */
import {
  DEFAULT_EXTERIOR_THICKNESS_MM, exteriorWallStrips,
  type FloorPlan, type PlanPoint,
} from './floor-plan'
import { graphView } from './plan-graph'

export interface RoomRectangle {
  minXmm: number
  maxXmm: number
  minZmm: number
  maxZmm: number
}
export interface FloorRoom {
  id: string
  label: string
  areaMm2: number
  areaM2: number
  center: PlanPoint
  rectangles: RoomRectangle[]
  bounds: RoomRectangle
}

const EPS=1e-7
const bounds=(points:readonly PlanPoint[]):RoomRectangle=>({
  minXmm:Math.min(...points.map(p=>p.xMm)),
  maxXmm:Math.max(...points.map(p=>p.xMm)),
  minZmm:Math.min(...points.map(p=>p.zMm)),
  maxZmm:Math.max(...points.map(p=>p.zMm)),
})
const insideRect=(x:number,z:number,r:RoomRectangle)=>
  x>=r.minXmm-EPS&&x<=r.maxXmm+EPS&&
  z>=r.minZmm-EPS&&z<=r.maxZmm+EPS

function pointInPolygon(x:number,z:number,points:readonly PlanPoint[]):boolean {
  let inside=false
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j]
    if((a.zMm>z)!==(b.zMm>z)){
      const edgeX=(b.xMm-a.xMm)*(z-a.zMm)/(b.zMm-a.zMm)+a.xMm
      if(x<edgeX)inside=!inside
    }
  }
  return inside
}
const area=(r:RoomRectangle)=>(r.maxXmm-r.minXmm)*(r.maxZmm-r.minZmm)
const uniques=(a:number[])=>[...new Set(a)].sort((x,y)=>x-y)
const capped=(number:number,min:number,max:number)=>
  Math.max(min,Math.min(number,max))

/** Deterministic room tessellation for orthogonal 2D plans. */
export function deriveFloorRooms(plan:FloorPlan|undefined):FloorRoom[] {
  if(!plan?.closed||plan.exterior.length<4)return []
  const extent=bounds(plan.exterior)
  if(extent.maxXmm<=extent.minXmm||extent.maxZmm<=extent.minZmm)return []
  const extThickness=plan.exteriorThicknessMm??DEFAULT_EXTERIOR_THICKNESS_MM
  if(!Number.isFinite(extThickness)||extThickness<=0)return []
  const exteriorWallBoxes=exteriorWallStrips(plan).map(bounds)
  const interiorWallBoxes:RoomRectangle[]=[]
  for(const wall of graphView(plan).interiorWalls){
    const t=wall.thicknessMm/2
    if(!Number.isFinite(t)||t<=0)continue
    if(wall.start.xMm===wall.end.xMm)interiorWallBoxes.push({
      minXmm:wall.start.xMm-t,maxXmm:wall.start.xMm+t,
      minZmm:Math.min(wall.start.zMm,wall.end.zMm),
      maxZmm:Math.max(wall.start.zMm,wall.end.zMm),
    })
    else if(wall.start.zMm===wall.end.zMm)interiorWallBoxes.push({
      minZmm:wall.start.zMm-t,maxZmm:wall.start.zMm+t,
      minXmm:Math.min(wall.start.xMm,wall.end.xMm),
      maxXmm:Math.max(wall.start.xMm,wall.end.xMm),
    })
  }
  const boxes=[...exteriorWallBoxes,...interiorWallBoxes]
  const xCuts=uniques([
    ...plan.exterior.map(p=>p.xMm),extent.minXmm,extent.maxXmm,
    ...boxes.flatMap(r=>[capped(r.minXmm,extent.minXmm,extent.maxXmm),
      capped(r.maxXmm,extent.minXmm,extent.maxXmm)]),
  ])
  const zCuts=uniques([
    ...plan.exterior.map(p=>p.zMm),extent.minZmm,extent.maxZmm,
    ...boxes.flatMap(r=>[capped(r.minZmm,extent.minZmm,extent.maxZmm),
      capped(r.maxZmm,extent.minZmm,extent.maxZmm)]),
  ])
  const nx=xCuts.length-1,nz=zCuts.length-1
  if(nx<1||nz<1)return []
  const n=nx*nz
  // The authored plan limit is 100 partition edges. Keep the derived grid
  // bounded even if a damaged external JSON bypasses schema validation.
  if(n>250000)return []
  const free=new Uint8Array(n)
  const component=new Int32Array(n).fill(-1)
  const idx=(x:number,z:number)=>x*nz+z
  for(let x=0;x<nx;x++)for(let z=0;z<nz;z++){
    if(xCuts[x+1]-xCuts[x]<=EPS||zCuts[z+1]-zCuts[z]<=EPS)continue
    const cx=(xCuts[x]+xCuts[x+1])/2,cz=(zCuts[z]+zCuts[z+1])/2
    if(pointInPolygon(cx,cz,plan.exterior)&&
      !boxes.some(box=>insideRect(cx,cz,box)))free[idx(x,z)]=1
  }
  const raw: {
    cells:number[];areaMm2:number;sumX:number;sumZ:number;bounds:RoomRectangle
  }[]=[]
  for(let x=0;x<nx;x++)for(let z=0;z<nz;z++){
    const first=idx(x,z)
    if(!free[first]||component[first]!==-1)continue
    const roomIndex=raw.length
    const record={
      cells:[] as number[],areaMm2:0,sumX:0,sumZ:0,
      bounds:{minXmm:Infinity,maxXmm:-Infinity,minZmm:Infinity,maxZmm:-Infinity},
    }
    const queue=[first]
    component[first]=roomIndex
    for(let k=0;k<queue.length;k++){
      const cell=queue[k],xi=Math.floor(cell/nz),zi=cell%nz
      record.cells.push(cell)
      const rect={
        minXmm:xCuts[xi],maxXmm:xCuts[xi+1],
        minZmm:zCuts[zi],maxZmm:zCuts[zi+1],
      }
      const size=area(rect)
      record.areaMm2+=size
      record.sumX+=(rect.minXmm+rect.maxXmm)*size/2
      record.sumZ+=(rect.minZmm+rect.maxZmm)*size/2
      record.bounds.minXmm=Math.min(record.bounds.minXmm,rect.minXmm)
      record.bounds.maxXmm=Math.max(record.bounds.maxXmm,rect.maxXmm)
      record.bounds.minZmm=Math.min(record.bounds.minZmm,rect.minZmm)
      record.bounds.maxZmm=Math.max(record.bounds.maxZmm,rect.maxZmm)
      for(const [xx,zz] of [[xi-1,zi],[xi+1,zi],[xi,zi-1],[xi,zi+1]]){
        if(xx<0||xx>=nx||zz<0||zz>=nz)continue
        const neighbour=idx(xx,zz)
        if(free[neighbour]&&component[neighbour]===-1){
          component[neighbour]=roomIndex
          queue.push(neighbour)
        }
      }
    }
    if(record.areaMm2>EPS)raw.push(record)
  }
  // Merge side-by-side cells and then merge vertically repeated bands.
  // This keeps the 3D overlay cheap while retaining concave outlines exactly.
  const output=raw.map((r,roomIndex)=>{
    const merged:RoomRectangle[]=[]
    let active=new Map<string,RoomRectangle>()
    for(let zi=0;zi<nz;zi++){
      const next=new Map<string,RoomRectangle>()
      for(let xi=0;xi<nx;){
        if(component[idx(xi,zi)]!==roomIndex){xi++;continue}
        const begin=xi
        while(xi<nx&&component[idx(xi,zi)]===roomIndex)xi++
        const rect={
          minXmm:xCuts[begin],maxXmm:xCuts[xi],
          minZmm:zCuts[zi],maxZmm:zCuts[zi+1],
        }
        const key=rect.minXmm+':'+rect.maxXmm
        const previous=active.get(key)
        if(previous&&Math.abs(previous.maxZmm-rect.minZmm)<EPS){
          previous.maxZmm=rect.maxZmm
          next.set(key,previous)
        }else{
          merged.push(rect)
          next.set(key,rect)
        }
      }
      active=next
    }
    const centre={xMm:r.sumX/r.areaMm2,zMm:r.sumZ/r.areaMm2}
    const labelCentre=merged.some(rect=>insideRect(centre.xMm,centre.zMm,rect))
      ?centre
      :[...merged].sort((a,b)=>{
        const ca={x:(a.minXmm+a.maxXmm)/2,z:(a.minZmm+a.maxZmm)/2}
        const cb={x:(b.minXmm+b.maxXmm)/2,z:(b.minZmm+b.maxZmm)/2}
        return Math.hypot(ca.x-centre.xMm,ca.z-centre.zMm)
          -Math.hypot(cb.x-centre.xMm,cb.z-centre.zMm)
      }).map(rect=>({
        xMm:(rect.minXmm+rect.maxXmm)/2,
        zMm:(rect.minZmm+rect.maxZmm)/2,
      }))[0]
    return {
      id:'',label:'',areaMm2:r.areaMm2,
      areaM2:r.areaMm2/1e6,
      center:labelCentre,
      bounds:r.bounds,rectangles:merged,
    }
  })
  // Left-to-right, then north-to-south: stable ordering regardless of
  // internal segment order, graph node IDs and door/opening positions.
  output.sort((a,b)=>a.bounds.minXmm-b.bounds.minXmm ||
    a.bounds.minZmm-b.bounds.minZmm || b.areaMm2-a.areaMm2)
  output.forEach((room,i)=>{
    room.id='R'+String(i+1).padStart(2,'0')
    room.label='Помещение '+String(i+1).padStart(2,'0')
  })
  return output
}
export const totalRoomAreaM2=(rooms:readonly FloorRoom[])=>
  rooms.reduce((sum,room)=>sum+room.areaM2,0)
