import type { PlanPoint } from './floor-plan'

export type PlanArrow = 'ArrowLeft'|'ArrowRight'|'ArrowUp'|'ArrowDown'
type Segment = {start:PlanPoint;end:PlanPoint}
const valid=(step:number)=>Number.isInteger(step)&&step>0&&step<=1000
/** Moving a wall is always perpendicular to its own axis (world millimetres). */
export function wallNudgeForArrow(segment:Segment,key:string,step:number):number|null {
  if(!valid(step))return null
  const vertical=segment.start.xMm===segment.end.xMm
  const horizontal=segment.start.zMm===segment.end.zMm
  if(vertical===horizontal)return null
  if(vertical)return key==='ArrowLeft'?-step:key==='ArrowRight'?step:null
  return key==='ArrowUp'?-step:key==='ArrowDown'?step:null
}
/** Move an opening in the wall's AUTHORED direction, not screen coordinates. */
export function openingNudgeForArrow(segment:Segment,key:string,step:number):number|null {
  if(!valid(step))return null
  const dx=segment.end.xMm-segment.start.xMm
  const dz=segment.end.zMm-segment.start.zMm
  if(dx!==0&&dz!==0||dx===0&&dz===0)return null
  if(dx!==0){
    if(key!=='ArrowLeft'&&key!=='ArrowRight')return null
    return (key==='ArrowRight'?1:-1)*Math.sign(dx)*step
  }
  if(key!=='ArrowUp'&&key!=='ArrowDown')return null
  return (key==='ArrowDown'?1:-1)*Math.sign(dz)*step
}
