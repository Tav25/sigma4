import {describe,expect,it} from 'vitest'
import {buildHorizontalCut} from './horizontal-cut'
import {createProjectFromCurrentState} from './project-store'
import {createProjectStore} from './ProjectStore'
import {projectToScene} from '../scene/project-to-scene'
import {structuralPieceColor} from '../components/PlanStructuralOverlay'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
describe('SIGMA4 0.1.36 2D structural overlay uses physical assembly cut',()=>{
  it('projects actual exterior and interior studs, backing and top plates at the correct Y',()=>{
    const store=createProjectStore(createProjectFromCurrentState({
      projectId:'plan-structural-2d',length:6000,height:2700,spacing:600,openings:[],
    }))
    for(const point of [p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)])
      expect(store.dispatch({type:'PLAN_ADD_POINT',payload:{point}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_CLOSE',payload:{}}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:p(3000,0),end:p(3000,-6000),thicknessMm:100,
    }}).success).toBe(true)
    expect(store.dispatch({type:'PLAN_FRAME_BUILD',payload:{}}).success).toBe(true)
    const json=store.exportJson()
    const elements=projectToScene(store.getSnapshot()).elements
    const mid=buildHorizontalCut(elements,1200)
    expect(mid.pieces.some(piece=>piece.role==='stud'&&!piece.wallId.startsWith('partition-'))).toBe(true)
    expect(mid.pieces.some(piece=>piece.wallId.startsWith('partition-'))).toBe(true)
    expect(mid.pieces.every(piece=>piece.areaMm2>0)).toBe(true)
    const low=buildHorizontalCut(elements,10)
    expect(low.pieces.some(piece=>piece.role==='bottom-plate')).toBe(true)
    expect(mid.pieces.some(piece=>piece.role==='bottom-plate')).toBe(false)
    const top=buildHorizontalCut(elements,2650)
    expect(top.pieces.some(piece=>piece.role==='top-plate')).toBe(true)
    expect(store.exportJson()).toBe(json)
  })
  it('uses honest style categories rather than inventing load-bearing status',()=>{
    expect(structuralPieceColor({role:'stud',wallId:'partition-I001',elementId:'p1'})).not.toBe(
      structuralPieceColor({role:'stud',wallId:'plan-front',elementId:'e1'}))
    expect(structuralPieceColor({role:'header',wallId:'plan-front',elementId:'head'})).toBe('#aa885a')
  })
})
