import { describe, it, expect } from 'vitest'
import { createProjectFromCurrentState } from './project-store'
import { rotatedDirection, planUnit, chainJointOrigin, previewChainClosure } from './wall-chain'
import type { Wall } from './project'

describe('S07 orthogonal chained-wall topology', () => {
  it('rotates through every cardinal direction and preserves millimetres', () => {
    expect(['x','z','-x','+z'].map(s =>
      rotatedDirection(s as 'x'|'z'|'-x'|'+z', 'right'))).toEqual(['z','-x','+z','x'])
    expect(rotatedDirection('x','left')).toBe('+z')
    expect(planUnit('-x')).toEqual({x:-1,z:0})
  })
  it('makes right butt and left butt junctions using physical outside corners', () => {
    const w=createProjectFromCurrentState({length:6000,height:2700,spacing:600,openings:[]}).building.walls[0]
    const south:Wall={...w,wallId:'wall-002',orientation:'z',lengthMm:3000,openings:[],origin:{x:0,y:0,z:0}}
    expect(chainJointOrigin(w,south,'right')).toEqual({x:6000,y:0,z:0})
    const north:Wall={...w,wallId:'wall-003',orientation:'+z',lengthMm:3000,openings:[],origin:{x:0,y:0,z:0}}
    expect(chainJointOrigin(w,north,'left')).toEqual({x:6000,y:0,z:-145})
  })
  it('finds the exact fourth rectangular wall length and rejects nonclosing chains', () => {
    const doc=createProjectFromCurrentState({length:6000,height:2700,spacing:600,openings:[]})
    const first=doc.building.walls[0]
    doc.building.walls.push({...first,wallId:'wall-002',orientation:'z',
      lengthMm:3000,origin:{x:6000,y:0,z:-145},openings:[]})
    doc.building.walls.push({...first,wallId:'wall-003',orientation:'-x',
      lengthMm:6000,origin:{x:6000,y:0,z:-3145},openings:[]})
    doc.building.connections=[
      {fromWallId:'wall-001',toWallId:'wall-002',type:'california-right'},
      {fromWallId:'wall-002',toWallId:'wall-003',type:'chain-turn-right'},
    ]
    expect(previewChainClosure(doc)).toEqual({
      valid:true,direction:'+z',lengthMm:3145,reason:'',
    })
    doc.building.walls[2].lengthMm=5500
    expect(previewChainClosure(doc).valid).toBe(false)
  })
})
