/**
 * Exact horizontal section of timber's oriented 3D solid at world Y (mm).
 * Every polygon comes from plane/OBB edge intersections, never a bounding-box
 * proxy. No changes to the canonical project JSON or derived scene elements.
 */
import { toWorldPoint, type TimberElement, type Vec3 } from './timber'

export interface SectionPoint { xMm: number; zMm: number }
export interface SectionPiece {
  elementId: string
  wallId: string
  role: string
  polygon: SectionPoint[]
  areaMm2: number
}
export interface HorizontalCut {
  heightMm: number
  pieces: SectionPiece[]
  /** Stable view across all heights, in millimetres. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }
}
const EPS = 1e-6
const CORNER_BITS = [1, 2, 4] as const
const cross = (a:SectionPoint,b:SectionPoint,c:SectionPoint) =>
  (b.xMm-a.xMm)*(c.zMm-a.zMm)-(b.zMm-a.zMm)*(c.xMm-a.xMm)
const equal = (a:SectionPoint,b:SectionPoint) =>
  Math.abs(a.xMm-b.xMm)<EPS && Math.abs(a.zMm-b.zMm)<EPS

export function timberCorners(element: TimberElement): Vec3[] {
  if (![element.length,element.width,element.height].every(
    value=>Number.isFinite(value)&&value>0))
    return []
  const corners:Vec3[]=[]
  for(let bits=0;bits<8;bits++){
    corners.push(toWorldPoint(element,{
      x:bits&1?element.length:0,
      y:bits&2?element.height:0,
      z:bits&4?element.width/2:-element.width/2,
    }))
  }
  return corners
}
/** Monotone-chain hull suppresses collinear points on crossing faces. */
function convexHull(points:SectionPoint[]):SectionPoint[] {
  const sorted=points.slice().sort((a,b)=>a.xMm-b.xMm||a.zMm-b.zMm)
  const unique:SectionPoint[]=[]
  for(const p of sorted)if(!unique.some(v=>equal(v,p)))unique.push(p)
  if(unique.length<3)return []
  const lower:SectionPoint[]=[],upper:SectionPoint[]=[]
  for(const p of unique){
    while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=EPS)lower.pop()
    lower.push(p)
  }
  for(let i=unique.length-1;i>=0;i--){
    const p=unique[i]
    while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=EPS)upper.pop()
    upper.push(p)
  }
  lower.pop();upper.pop()
  return lower.concat(upper)
}
const area=(poly:SectionPoint[]):number=>Math.abs(poly.reduce((sum,p,i)=>{
  const q=poly[(i+1)%poly.length]
  return sum+p.xMm*q.zMm-q.xMm*p.zMm
},0))/2

/** Half-open height convention: lower face included, upper face excluded. */
export function timberSectionAtHeight(element:TimberElement,heightMm:number):SectionPoint[] {
  if(!Number.isFinite(heightMm))return []
  const corners=timberCorners(element)
  if(corners.length!==8)return []
  const minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y))
  if(heightMm<minY-EPS||heightMm>=maxY-EPS)return []
  const hits:SectionPoint[]=[]
  const add=(point:Vec3)=>hits.push({xMm:point.x,zMm:point.z})
  for(let i=0;i<8;i++)for(const bit of CORNER_BITS){
    const j=i^bit
    if(j<=i)continue
    const a=corners[i],b=corners[j],dy=b.y-a.y
    if(Math.abs(dy)<=EPS){
      if(Math.abs(heightMm-a.y)<=EPS){add(a);add(b)}
      continue
    }
    const t=(heightMm-a.y)/dy
    if(t>=-EPS&&t<=1+EPS){
      const clamped=Math.min(1,Math.max(0,t))
      add({x:a.x+(b.x-a.x)*clamped,y:heightMm,z:a.z+(b.z-a.z)*clamped})
    }
  }
  const hull=convexHull(hits)
  return hull.length>=3&&area(hull)>EPS?hull:[]
}
export function buildHorizontalCut(elements:readonly TimberElement[],heightMm:number):HorizontalCut {
  const b={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,minY:Infinity,maxY:-Infinity}
  const pieces:SectionPiece[]=[]
  for(const el of elements){
    const corners=timberCorners(el)
    for(const p of corners){
      b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x)
      b.minZ=Math.min(b.minZ,p.z);b.maxZ=Math.max(b.maxZ,p.z)
      b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y)
    }
    const polygon=timberSectionAtHeight(el,heightMm)
    if(polygon.length>=3){
      pieces.push({
        elementId:el.id, wallId:el.wallId??'',role:el.role,
        polygon,areaMm2:area(polygon),
      })
    }
  }
  if(!Number.isFinite(b.minX)){
    return{heightMm,pieces,bounds:{minX:0,maxX:1000,minZ:-1000,maxZ:0,minY:0,maxY:1000}}
  }
  return {heightMm,pieces,bounds:b}
}
