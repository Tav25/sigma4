/** Display-only union of orthogonal wall footprints. No model or framing edits. */
import { exteriorWallStrips, type FloorPlan, type PlanPoint } from './floor-plan'
import { graphView } from './plan-graph'
export interface WallRectangle { minX:number;maxX:number;minZ:number;maxZ:number }
export interface WallOutlineEdge { a:PlanPoint;b:PlanPoint }

export function unionWallRectangles(input:readonly WallRectangle[]) {
  const rectangles=input.filter(r=>r.maxX>r.minX&&r.maxZ>r.minZ)
  const xs=[...new Set(rectangles.flatMap(r=>[r.minX,r.maxX]))].sort((a,b)=>a-b)
  const zs=[...new Set(rectangles.flatMap(r=>[r.minZ,r.maxZ]))].sort((a,b)=>a-b)
  const cells=Array.from({length:Math.max(0,zs.length-1)},()=>new Uint8Array(Math.max(0,xs.length-1)))
  const xi=new Map(xs.map((x,i)=>[x,i])),zi=new Map(zs.map((z,i)=>[z,i]))
  for(const r of rectangles) for(let j=zi.get(r.minZ)!;j<zi.get(r.maxZ)!;j++)
    cells[j].fill(1,xi.get(r.minX)!,xi.get(r.maxX)!)
  const edges:WallOutlineEdge[]=[]
  let areaMm2=0
  const edge=(x1:number,z1:number,x2:number,z2:number)=>edges.push({a:{xMm:x1,zMm:z1},b:{xMm:x2,zMm:z2}})
  for(let j=0;j<cells.length;j++)for(let i=0;i<cells[j].length;i++)if(cells[j][i]){
    const x=xs[i],xx=xs[i+1],z=zs[j],zz=zs[j+1]
    areaMm2+=(xx-x)*(zz-z)
    if(!cells[j-1]?.[i])edge(x,z,xx,z)
    if(!cells[j+1]?.[i])edge(x,zz,xx,zz)
    if(!cells[j][i-1])edge(x,z,x,zz)
    if(!cells[j][i+1])edge(xx,z,xx,zz)
  }
  return {rectangles,edges,areaMm2}
}

export function planWallDrawing(plan:FloorPlan) {
  const rectangles:WallRectangle[]=exteriorWallStrips(plan).map(strip=>({
    minX:Math.min(...strip.map(p=>p.xMm)),maxX:Math.max(...strip.map(p=>p.xMm)),
    minZ:Math.min(...strip.map(p=>p.zMm)),maxZ:Math.max(...strip.map(p=>p.zMm)),
  }))
  for(const wall of graphView(plan).interiorWalls){
    const vertical=wall.start.xMm===wall.end.xMm,half=wall.thicknessMm/2
    rectangles.push({minX:Math.min(wall.start.xMm,wall.end.xMm)-(vertical?half:0),
      maxX:Math.max(wall.start.xMm,wall.end.xMm)+(vertical?half:0),
      minZ:Math.min(wall.start.zMm,wall.end.zMm)-(vertical?0:half),
      maxZ:Math.max(wall.start.zMm,wall.end.zMm)+(vertical?0:half)})
  }
  return unionWallRectangles(rectangles)
}
