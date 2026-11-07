import {describe,expect,it} from 'vitest'
import {openingNudgeForArrow,wallNudgeForArrow} from './plan-keyboard-nudge'
const h={start:{xMm:0,zMm:-3000},end:{xMm:6000,zMm:-3000}}
const hr={start:h.end,end:h.start}
const v={start:{xMm:4000,zMm:0},end:{xMm:4000,zMm:-7000}}
const vr={start:v.end,end:v.start}
describe('SIGMA4 0.1.31: orthogonal keyboard CAD nudges',()=>{
  it('moves vertical walls only in X, horizontal walls only in Z',()=>{
    expect(wallNudgeForArrow(v,'ArrowLeft',25)).toBe(-25)
    expect(wallNudgeForArrow(v,'ArrowRight',25)).toBe(25)
    expect(wallNudgeForArrow(v,'ArrowUp',25)).toBeNull()
    expect(wallNudgeForArrow(h,'ArrowUp',100)).toBe(-100)
    expect(wallNudgeForArrow(h,'ArrowDown',100)).toBe(100)
    expect(wallNudgeForArrow(h,'ArrowRight',100)).toBeNull()
  })
  it('translates world arrows into the correct LOCAL opening axis even when reversed',()=>{
    expect(openingNudgeForArrow(h,'ArrowRight',25)).toBe(25)
    expect(openingNudgeForArrow(hr,'ArrowRight',25)).toBe(-25)
    expect(openingNudgeForArrow(v,'ArrowUp',25)).toBe(25)
    expect(openingNudgeForArrow(v,'ArrowDown',25)).toBe(-25)
    expect(openingNudgeForArrow(vr,'ArrowUp',25)).toBe(-25)
    expect(openingNudgeForArrow(v,'ArrowRight',25)).toBeNull()
  })
  it('rejects non-orthogonal/zero-length wall and invalid step',()=>{
    const diagonal={start:{xMm:0,zMm:0},end:{xMm:1000,zMm:1000}}
    const zero={start:h.start,end:h.start}
    expect(wallNudgeForArrow(diagonal,'ArrowLeft',25)).toBeNull()
    expect(openingNudgeForArrow(diagonal,'ArrowLeft',25)).toBeNull()
    expect(wallNudgeForArrow(zero,'ArrowLeft',25)).toBeNull()
    expect(openingNudgeForArrow(zero,'ArrowLeft',25)).toBeNull()
    expect(openingNudgeForArrow(h,'ArrowRight',1)).toBe(1)
    expect(openingNudgeForArrow(h,'ArrowRight',1.5)).toBeNull()
  })
})
