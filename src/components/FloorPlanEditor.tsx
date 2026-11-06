import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import {
  emptyFloorPlan, meters, planAreaM2, planBounds, planDistanceMm,
  planPerimeterMm, validateFloorPlan, decimalMetersToMm,
  snapPlanAnchor, planInteriorJunctions, planWallClearances,
  moveInteriorWallWithDependents, moveWallToClearance, exteriorWallStrips,
  DEFAULT_EXTERIOR_THICKNESS_MM,
  type FloorPlan, type PlanPoint, type PlanInteriorWall,
} from '../core/floor-plan'
import { graphView, moveGraphEdge, moveGraphEdgeToDimension, moveGraphPoint, ensureWallGraph } from '../core/plan-graph'
import type { ProjectCommand, CommandResult } from '../core/ProjectStore'

const WIDTH = 1200
const HEIGHT = 760
const BASE_PX_PER_METRE = 64
const OFFSET_X = 220
const OFFSET_Y = 565
const directions = [
  { value: '+x', label: 'Вправо (+X)', x: 1, z: 0 },
  { value: '-z', label: 'Вверх (−Z)', x: 0, z: -1 },
  { value: '-x', label: 'Влево (−X)', x: -1, z: 0 },
  { value: '+z', label: 'Вниз (+Z)', x: 0, z: 1 },
] as const

type Direction = typeof directions[number]['value']
type PanDrag = { pointerId: number; initialX: number; initialY: number; panX: number; panY: number }
type WallPointerDrag = { id: string; pointerId: number; startX: number; startY: number;
  offsetMm: number; moved: boolean; candidate: FloorPlan | null }
type NodePointerDrag = {id:string;pointerId:number;startX:number;startY:number;
  moved:boolean;point:PlanPoint|null;candidate:FloorPlan|null}
type DraftTool = 'outline'|'interior'|'turn'|'point'|'split'|'erase'|'select'

export interface FloorPlanEditorProps {
  plan?: FloorPlan
  onCommand: (command: ProjectCommand) => CommandResult
  onExport: () => void
  onImport: () => void
}

export function FloorPlanEditor({ plan = emptyFloorPlan(), onCommand, onExport, onImport }: FloorPlanEditorProps) {
  const [direction, setDirection] = useState<Direction>('+x')
  const [exactLength, setExactLength] = useState('6')
  const [snapMm, setSnapMm] = useState(250)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState<PlanPoint | null>(null)
  const [localError, setLocalError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [tool, setTool] = useState<DraftTool>('outline')
  const [lastSegmentAxis, setLastSegmentAxis] = useState<'x'|'z'|null>(null)
  const [selectedGraphNodeId,setSelectedGraphNodeId] = useState<string|null>(null)
  const [nodeEdit,setNodeEdit] = useState({x:'',z:''})
  const [interiorStart, setInteriorStart] = useState<PlanPoint | null>(null)
  const [interiorHover, setInteriorHover] = useState<PlanPoint | null>(null)
  const [interiorThickness, setInteriorThickness] = useState('100')
  const [selectedInteriorId, setSelectedInteriorId] = useState<string | null>(null)
  const [interiorEdit, setInteriorEdit] = useState({ sx: '', sz: '', ex: '', ez: '', thickness: '100' })
  const [dimensionEdit, setDimensionEdit] = useState<{side:'negative'|'positive';value:string}|null>(null)
  const [outerWidthDraft, setOuterWidthDraft] = useState(String(plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM))
  const [wallPreview, setWallPreview] = useState<FloorPlan | null>(null)
  const wallPointer = useRef<WallPointerDrag | null>(null)
  const nodePointer = useRef<NodePointerDrag|null>(null)
  const [pointX, setPointX] = useState('')
  const [pointZ, setPointZ] = useState('')
  const drag = useRef<PanDrag | null>(null)
  const ignoreClick = useRef(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  useEffect(() => {
    setOuterWidthDraft(String(plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM))
  }, [plan.exteriorThicknessMm])
  const points = plan.exterior
  const viewPlan=graphView(plan)
  const selectedInterior = viewPlan.interiorWalls.find(w => w.id === selectedInteriorId)
  const visiblePlan = graphView(wallPreview ?? plan)
  const visibleWalls = visiblePlan.interiorWalls
  const activeNodes=(wallPreview??plan).graph?.nodes ?? []
  const selectedGraphNode=plan.graph?.nodes.find(n=>n.id===selectedGraphNodeId)
  const innerJunctions = planInteriorJunctions(visiblePlan)
  const clearances = selectedInterior && tool === 'select'
    ? planWallClearances(visiblePlan, selectedInterior.id) : null
  const px = zoom * BASE_PX_PER_METRE
  const originX = OFFSET_X + pan.x
  const originY = OFFSET_Y + pan.y
  const xy = (p: PlanPoint) => ({
    x: originX + p.xMm / 1000 * px,
    y: originY + p.zMm / 1000 * px,
  })
  const svgFromEvent = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
    const svg = event.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const converted = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    return { x: converted.x, y: converted.y }
  }
  const snap = (x: number) => Math.round(x / snapMm) * snapMm
  const endpoint = (screen: { x: number; y: number }): PlanPoint => {
    if (!points.length) return { xMm: 0, zMm: 0 }
    const last = points[points.length - 1]
    const desiredX = snap((screen.x - originX) / px * 1000)
    const desiredZ = snap((screen.y - originY) / px * 1000)
    if (Math.abs(desiredX - last.xMm) >= Math.abs(desiredZ - last.zMm)) {
      return { xMm: desiredX, zMm: last.zMm }
    }
    return { xMm: last.xMm, zMm: desiredZ }
  }
  const apply = (command: ProjectCommand) => {
    const result = onCommand(command)
    setLocalError(result.success ? '' : result.messageRu || 'Операция недоступна')
    return result.success
  }
  const toSignedMm = (value: string): number | null => {
    const normalized = value.trim().replace(',', '.')
    return /^-?\d+(?:\.\d{1,3})?$/.test(normalized)
      ? Math.round(Number(normalized) * 1000) : null
  }
  const canvasWorldPoint = (location: { x: number; y: number }): PlanPoint => ({
    xMm: Math.round((location.x - originX) / px * 1000),
    zMm: Math.round((location.y - originY) / px * 1000),
  })
  /** Freehand CAD point, optionally constrained to the previous axis. */
  const snapDraftPoint=(raw:PlanPoint):PlanPoint=>{
    const round=(n:number)=>Math.round(n/snapMm)*snapMm
    const base={xMm:round(raw.xMm),zMm:round(raw.zMm)}
    const toleranceMm=Math.min(800,16*1000/px)
    const near=viewPlan.graph?.nodes ?? plan.graph?.nodes ?? []
    const nearest=near
      .map(n=>({p:{xMm:n.xMm,zMm:n.zMm},d:planDistanceMm(n,raw)}))
      .sort((a,b)=>a.d-b.d)[0]
    const clampAxis=(p:PlanPoint)=>{
      if(!interiorStart)return p
      const dx=p.xMm-interiorStart.xMm,dz=p.zMm-interiorStart.zMm
      const axis=tool==='turn'&&lastSegmentAxis
        ?(lastSegmentAxis==='x'?'z':'x')
        :Math.abs(dx)>=Math.abs(dz)?'x':'z'
      return axis==='x'
        ?{xMm:p.xMm,zMm:interiorStart.zMm}
        :{xMm:interiorStart.xMm,zMm:p.zMm}
    }
    if(nearest&&nearest.d<=toleranceMm){
      const proposed=clampAxis(nearest.p)
      if(planDistanceMm(proposed,nearest.p)<=1)return proposed
    }
    const alongWall=snapPlanAnchor(viewPlan,raw,toleranceMm,snapMm,interiorStart??undefined)
    if(alongWall){
      const proposed=clampAxis(alongWall)
      if(planDistanceMm(proposed,alongWall)<=1)return proposed
    }
    return clampAxis(base)
  }
  const finishPolyline=()=>{
    setInteriorStart(null);setInteriorHover(null);setLastSegmentAxis(null)
    if(tool==='turn')setTool('interior')
  }
  const graphClick=(raw:PlanPoint)=>{
    const point=snapDraftPoint(raw)
    if(tool==='point'){
      if(apply({type:'PLAN_GRAPH_ADD_POINT',payload:{point}})){
        setSelectedInteriorId(null)
        setLocalError('')
      }
      return
    }
    if(tool!=='interior'&&tool!=='turn')return
    if(!interiorStart){
      // First point may be anywhere inside the house; no attachment requirement.
      if(apply({type:'PLAN_GRAPH_ADD_POINT',payload:{point}})){
        setInteriorStart(point);setSelectedInteriorId(null)
        setLocalError('')
      }
      return
    }
    const thickness=Number(interiorThickness)
    if(!Number.isInteger(thickness)||thickness<50||thickness>500){
      setLocalError('Толщина внутренней стены: 50–500 мм');return
    }
    if(apply({type:'PLAN_GRAPH_ADD_EDGE',payload:{
      start:interiorStart,end:point,thicknessMm:thickness,
    }})){
      setLastSegmentAxis(interiorStart.xMm!==point.xMm?'x':'z')
      setInteriorStart(point) // Continue a polyline until Enter/Esc.
      setInteriorHover(null)
      if(tool==='turn')setTool('interior')
    }
  }
  const splitAtWall=(wall:PlanInteriorWall,raw:PlanPoint)=>{
    const point=wall.start.xMm===wall.end.xMm
      ?{xMm:wall.start.xMm,zMm:snap(raw.zMm)}
      :{xMm:snap(raw.xMm),zMm:wall.start.zMm}
    if(apply({type:'PLAN_GRAPH_SPLIT_EDGE',payload:{id:wall.id,point}})){
      setSelectedInteriorId(null);setDimensionEdit(null)
    }
  }
  const eraseWall=(id:string)=>{
    if(apply({type:'PLAN_GRAPH_DELETE_EDGE',payload:{id}})){
      if(selectedInteriorId===id)setSelectedInteriorId(null)
    }
  }
  const selectGraphNode=(id:string)=>{
    const node=plan.graph?.nodes.find(n=>n.id===id)
    if(!node)return
    setSelectedGraphNodeId(id);setSelectedInteriorId(null)
    setNodeEdit({x:meters(node.xMm),z:meters(node.zMm)})
  }
  const saveGraphNode=()=>{
    if(!selectedGraphNode)return
    const x=toSignedMm(nodeEdit.x),z=toSignedMm(nodeEdit.z)
    if(x===null||z===null){setLocalError('Укажите координаты в метрах с точностью 1 мм');return}
    apply({type:'PLAN_GRAPH_MOVE_POINT',payload:{
      id:selectedGraphNode.id,point:{xMm:x,zMm:z},
    }})
  }
  const beginNodeDrag=(event:PointerEvent<SVGCircleElement>,id:string)=>{
    if(tool!=='select'||event.button!==0||event.shiftKey)return
    const root=svgRef.current,screen=root?.getScreenCTM()
    if(!root||!screen)return
    event.stopPropagation();event.preventDefault()
    const pos=new DOMPoint(event.clientX,event.clientY).matrixTransform(screen.inverse())
    selectGraphNode(id)
    nodePointer.current={id,pointerId:event.pointerId,startX:pos.x,startY:pos.y,
      moved:false,point:null,candidate:null}
    root.setPointerCapture(event.pointerId)
  }
  const selectInteriorWall = (wall: PlanInteriorWall) => {
    setSelectedInteriorId(wall.id)
    setSelectedGraphNodeId(null)
    setDimensionEdit(null)
    setSelectedIndex(null)
    setInteriorEdit({
      sx: meters(wall.start.xMm), sz: meters(wall.start.zMm),
      ex: meters(wall.end.xMm), ez: meters(wall.end.zMm),
      thickness: String(wall.thicknessMm),
    })
  }
  const setExteriorThickness = () => {
    const thicknessMm = Number(outerWidthDraft)
    if (!Number.isInteger(thicknessMm) || thicknessMm < 50 || thicknessMm > 500) {
      setLocalError('Толщина наружной стены: целое число от 50 до 500 мм')
      return
    }
    apply({type:'PLAN_SET_EXTERIOR_THICKNESS',payload:{thicknessMm}})
  }
  const saveDimension = () => {
    if (!dimensionEdit || !selectedInterior) return
    const desiredMm = decimalMetersToMm(dimensionEdit.value)
    if (desiredMm === null) {
      setLocalError('Расстояние должно быть от 0,30 до 100 м с точностью 1 мм')
      return
    }
    let candidate:FloorPlan|null=null
    try{
      candidate=plan.graph
        ?moveGraphEdgeToDimension(plan,selectedInterior.id,dimensionEdit.side,desiredMm)
        :moveWallToClearance(plan,selectedInterior.id,dimensionEdit.side,desiredMm)
    }catch(e){
      setLocalError(e instanceof Error?e.message:'Нельзя переместить стену')
      return
    }
    if (apply({ type:'PLAN_SET_INTERIOR_CLEARANCE',
      payload:{id:selectedInterior.id,side:dimensionEdit.side,distanceMm:desiredMm} })) {
      const wall=candidate?graphView(candidate).interiorWalls.find(w=>w.id===selectedInterior.id):undefined
      if (wall) selectInteriorWall(wall)
      setDimensionEdit(null)
    }
  }
  const beginWallDrag = (event: PointerEvent<SVGLineElement>, wall: PlanInteriorWall) => {
    if (tool !== 'select' || event.button !== 0 || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    const root=svgRef.current
    const screen=root?.getScreenCTM()
    if (!root || !screen) return
    const pos=new DOMPoint(event.clientX,event.clientY).matrixTransform(screen.inverse())
    selectInteriorWall(wall)
    setDimensionEdit(null)
    wallPointer.current={id:wall.id,pointerId:event.pointerId,startX:pos.x,
      startY:pos.y,offsetMm:0,moved:false,candidate:null}
    root.setPointerCapture(event.pointerId)
  }
  const updateInteriorWall = () => {
    if (!selectedInterior) return
    const sx = toSignedMm(interiorEdit.sx), sz = toSignedMm(interiorEdit.sz)
    const ex = toSignedMm(interiorEdit.ex), ez = toSignedMm(interiorEdit.ez)
    const thicknessMm = Number(interiorEdit.thickness)
    if ([sx, sz, ex, ez].some(value => value === null) || !Number.isInteger(thicknessMm)) {
      setLocalError('Неверные координаты или толщина: метры до 1 мм, толщина в мм')
      return
    }
    apply({ type: 'PLAN_UPDATE_INTERIOR_WALL', payload: {
      id: selectedInterior.id,
      start: { xMm: sx!, zMm: sz! }, end: { xMm: ex!, zMm: ez! },
      thicknessMm,
    } })
  }
  const suggestClose = useMemo(() => {
    if (plan.closed || points.length < 4) return { valid: false, error: '' }
    const errors = validateFloorPlan({ ...plan, closed: true })
    return { valid: errors.length === 0, error: errors[0] ?? '' }
  }, [plan, points])
  const current = points[points.length - 1]
  const proposal = hover && current && !plan.closed
    ? endpoint(xy(hover)) : null
  const proposalErrors = proposal && !plan.closed
    ? validateFloorPlan({ ...plan, exterior: [...points, proposal] }) : []
  const bounds = planBounds(points)
  const widthM = (bounds.maxX - bounds.minX) / 1000
  const depthM = (bounds.maxZ - bounds.minZ) / 1000
  const edges = points.slice(1).map((to, index) => ({
    from: points[index], to, index, isClosing: false,
  }))
  if (plan.closed && points.length > 2) {
    edges.push({ from: points[points.length - 1], to: points[0],
      index: points.length - 1, isClosing: true })
  }
  const totalLength = planPerimeterMm(plan)
  const fill = points.map(p => {
    const q = xy(p)
    return q.x + ',' + q.y
  }).join(' ')
  const close = () => {
    if (!suggestClose.valid) {
      setLocalError(suggestClose.error || 'Контур ещё нельзя замкнуть')
      return
    }
    if (apply({ type: 'PLAN_CLOSE', payload: {} })) {
      setTool('interior')
      setHover(null)
      setSelectedIndex(null)
      fitView()
    }
  }
  const addExact = () => {
    if (!points.length) {
      apply({ type: 'PLAN_ADD_POINT', payload: { point: { xMm: 0, zMm: 0 } } })
      return
    }
    const value = decimalMetersToMm(exactLength)
    if (value === null) {
      setLocalError('Введите длину от 0,30 до 100 м, точность — до 1 мм')
      return
    }
    const chosen = directions.find(item => item.value === direction)!
    const next = { xMm: current.xMm + chosen.x * value,
      zMm: current.zMm + chosen.z * value }
    if (apply({ type: 'PLAN_ADD_POINT', payload: { point: next } })) {
      setHover(null)
      setSelectedIndex(null)
      const idx = directions.findIndex(item => item.value === direction)
      setDirection(directions[(idx + 1) % 4].value)
    }
  }
  const fitView = () => {
    if (!points.length) { setPan({ x: 0, y: 0 }); setZoom(1); return }
    const pixelPerMeter = Math.min(
      (WIDTH - 240) / Math.max(widthM, 2),
      (HEIGHT - 210) / Math.max(depthM, 2),
      BASE_PX_PER_METRE * 2.5,
    )
    const nextZoom = Math.min(2.5, Math.max(0.3, pixelPerMeter / BASE_PX_PER_METRE))
    const fittedPx = BASE_PX_PER_METRE * nextZoom
    setZoom(nextZoom)
    setPan({
      x: WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2000) * fittedPx - OFFSET_X,
      y: HEIGHT / 2 - ((bounds.minZ + bounds.maxZ) / 2000) * fittedPx - OFFSET_Y,
    })
  }
  const onCanvasClick = (event: MouseEvent<SVGSVGElement>) => {
    if (ignoreClick.current) { ignoreClick.current = false; return }
    if (event.shiftKey) return
    if (plan.closed) {
      if(tool==='interior'||tool==='turn'||tool==='point'){
        graphClick(canvasWorldPoint(svgFromEvent(event)))
      }
      return
    }
    if (!points.length) {
      addExact()
      return
    }
    const loc = svgFromEvent(event)
    const first = xy(points[0])
    if (points.length >= 4 && Math.hypot(loc.x - first.x, loc.y - first.y) < 24) {
      close()
      return
    }
    const candidate = endpoint(loc)
    apply({ type: 'PLAN_ADD_POINT', payload: { point: candidate } })
  }
  const selectPoint = (index: number) => {
    if (plan.closed && (tool === 'interior'||tool==='turn'||tool==='point')) {
      graphClick(points[index])
      return
    }
    if (!plan.closed && index === 0 && points.length >= 4) { close(); return }
    const point = points[index]
    setSelectedIndex(index)
    setPointX(meters(point.xMm))
    setPointZ(meters(point.zMm))
  }
  const moveSelectedPoint = () => {
    if (selectedIndex === null || selectedIndex === 0) return
    const toMm = (value: string) => {
      const normalized = value.replace(',', '.').trim()
      return /^-?\d+(?:\.\d{1,3})?$/.test(normalized)
        ? Math.round(Number(normalized) * 1000) : null
    }
    const xMm = toMm(pointX), zMm = toMm(pointZ)
    if (xMm === null || zMm === null) {
      setLocalError('Введите координаты в метрах с точностью до 1 мм')
      return
    }
    apply({ type: 'PLAN_MOVE_POINT', payload: { index: selectedIndex, point: { xMm, zMm } } })
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    if (event.ctrlKey) return
    setZoom(previous => Math.min(2.8, Math.max(0.32, previous * (event.deltaY < 0 ? 1.10 : 0.91))))
  }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.shiftKey || event.button === 1) {
      event.preventDefault()
      const loc = svgFromEvent(event)
      drag.current = { pointerId: event.pointerId, initialX: loc.x,
        initialY: loc.y, panX: pan.x, panY: pan.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const loc = svgFromEvent(event)
    const nodeMoving=nodePointer.current
    if(nodeMoving && nodeMoving.pointerId===event.pointerId){
      const dx=loc.x-nodeMoving.startX,dy=loc.y-nodeMoving.startY
      if(Math.hypot(dx,dy)>4)nodeMoving.moved=true
      if(!nodeMoving.moved)return
      ignoreClick.current=true
      const old=plan.graph?.nodes.find(n=>n.id===nodeMoving.id)
      if(!old)return
      const nextPoint={
        xMm:Math.round((old.xMm+dx/px*1000)/snapMm)*snapMm,
        zMm:Math.round((old.zMm+dy/px*1000)/snapMm)*snapMm,
      }
      try{
        const candidate=moveGraphPoint(plan,nodeMoving.id,nextPoint)
        const errors=validateFloorPlan(candidate)
        if(errors.length)throw Error(errors[0])
        nodeMoving.candidate=candidate;nodeMoving.point=nextPoint
        setWallPreview(candidate);setLocalError('')
      }catch(e){
        nodeMoving.candidate=null;nodeMoving.point=null
        setWallPreview(null)
        setLocalError(e instanceof Error?e.message:'Недопустимое положение точки')
      }
      return
    }
    const moving=wallPointer.current
    if (moving && moving.pointerId === event.pointerId) {
      const dx=loc.x-moving.startX, dy=loc.y-moving.startY
      if (Math.hypot(dx,dy) > 4) moving.moved=true
      if (!moving.moved) return
      ignoreClick.current=true
      const source=viewPlan.interiorWalls.find(w=>w.id===moving.id)
      if (!source) return
      const vertical=source.start.xMm===source.end.xMm
      const raw=(vertical ? dx : dy) / px * 1000
      const offsetMm=Math.round(raw / snapMm) * snapMm
      let candidate:FloorPlan|null=null
      try{
        candidate=plan.graph?moveGraphEdge(plan,moving.id,offsetMm)
          :moveInteriorWallWithDependents(plan,moving.id,offsetMm)
      }catch{candidate=null}
      const errors=candidate ? validateFloorPlan(candidate) : ['Неверное перемещение']
      if (!candidate || errors.length) {
        moving.offsetMm=0
        moving.candidate=null
        setWallPreview(null)
        setLocalError(errors[0])
      } else {
        moving.offsetMm=offsetMm
        moving.candidate=candidate
        setWallPreview(candidate)
        setLocalError('')
      }
      return
    }
    if (drag.current && drag.current.pointerId === event.pointerId) {
      const data = drag.current
      setPan({ x: data.panX + loc.x - data.initialX,
        y: data.panY + loc.y - data.initialY })
      ignoreClick.current = true
      return
    }
    if(plan.closed && (tool==='interior'||tool==='turn') && interiorStart){
      setInteriorHover(snapDraftPoint(canvasWorldPoint(loc)))
      return
    }
    if (!points.length || plan.closed) return
    const proposal = endpoint(loc)
    setHover(proposal)
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if(nodePointer.current?.pointerId===event.pointerId){
      const state=nodePointer.current;nodePointer.current=null
      setWallPreview(null)
      if(svgRef.current?.hasPointerCapture(event.pointerId))
        svgRef.current.releasePointerCapture(event.pointerId)
      if(state.moved&&state.point&&event.type!=='pointercancel'){
        if(apply({type:'PLAN_GRAPH_MOVE_POINT',payload:{
          id:state.id,point:state.point,
        }}))setNodeEdit({x:meters(state.point.xMm),z:meters(state.point.zMm)})
      }
      return
    }
    if (wallPointer.current?.pointerId === event.pointerId) {
      const completed=wallPointer.current
      wallPointer.current=null
      setWallPreview(null)
      if (svgRef.current?.hasPointerCapture(event.pointerId))
        svgRef.current.releasePointerCapture(event.pointerId)
      if (completed.moved && completed.offsetMm !== 0 && event.type !== 'pointercancel') {
        if (apply({type:'PLAN_MOVE_INTERIOR_WALL',payload:{
          id:completed.id,offsetMm:completed.offsetMm,
        }})) {
          const selected=completed.candidate?graphView(completed.candidate).interiorWalls.find(w=>w.id===completed.id):undefined
          if (selected) selectInteriorWall(selected)
        }
      }
      return
    }
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(()=>{
    const onKeyboard=(event:KeyboardEvent)=>{
      const element=event.target
      if(element instanceof HTMLElement &&
        (['INPUT','TEXTAREA','SELECT'].includes(element.tagName)||element.isContentEditable))return
      if((event.key==='Enter'||event.key==='Escape')&&interiorStart){
        finishPolyline()
        event.preventDefault()
      }
      if(event.key==='Escape'&&tool==='turn')setTool('interior')
      if(event.key==='Delete'||event.key==='Backspace'){
        if(tool!=='select')return
        if(selectedGraphNodeId&&plan.graph){
          event.preventDefault()
          if(apply({type:'PLAN_GRAPH_DELETE_POINT',payload:{id:selectedGraphNodeId}}))
            setSelectedGraphNodeId(null)
        }else if(selectedInteriorId){
          event.preventDefault()
          if(plan.graph)eraseWall(selectedInteriorId)
          else if(apply({type:'PLAN_REMOVE_INTERIOR_WALL',payload:{id:selectedInteriorId}}))
            setSelectedInteriorId(null)
        }
      }
    }
    window.addEventListener('keydown',onKeyboard)
    return ()=>window.removeEventListener('keydown',onKeyboard)
  })
  return (
    <div className="plan-workspace" data-testid="plan-workspace">
      <aside className="plan-controls">
        <div className="plan-eyebrow">SIGMA4 / ЧЕРТЁЖ 01</div>
        <h1>Периметр дома</h1>
        <p className="plan-muted">Построение наружного контура по точкам. Все размеры — в метрах, точность хранения — 1 мм.</p>
        <div className="plan-step">
          <span className="plan-step-count">01</span>
          <div><strong>{plan.closed ? 'Контур готов' : points.length ? 'Продолжайте контур' : 'Начальная точка'}</strong>
            <small>{plan.closed ? 'Можно редактировать узлы и размеры'
              : points.length ? 'Щёлкните на сетке или введите следующую длину'
                : 'Нажмите на поле или кнопку: точка (0,0)'}</small>
          </div>
        </div>
        {!plan.closed && (
          <div className="plan-tool-section">
            <label htmlFor="plan-length">Длина участка, м</label>
            <input id="plan-length" data-testid="plan-length-input" className="plan-large-input"
              type="text" inputMode="decimal" value={exactLength}
              onChange={event => setExactLength(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') addExact() }} />
            <label htmlFor="plan-direction">Направление</label>
            <select id="plan-direction" data-testid="plan-direction" value={direction}
              onChange={event => setDirection(event.target.value as Direction)}>
              {directions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" className="plan-button plan-primary" data-testid="plan-add-exact"
              onClick={addExact}>
              {points.length ? '+ Добавить по размеру' : 'Начать с 0,00'}
            </button>
            <button type="button" className="plan-button plan-secondary" data-testid="plan-close"
              disabled={!suggestClose.valid} onClick={close}>
              Замкнуть периметр
            </button>
            {points.length >= 3 && !suggestClose.valid && (
              <p className="plan-guidance" data-testid="plan-closure-hint">{suggestClose.error ||
                'Для замыкания нарисуйте последний угол'}</p>
            )}
          </div>
        )}
        {plan.closed && <>
          <div className="plan-complete" data-testid="plan-closed-status">
            <strong>Контур замкнут</strong>
            <span>Теперь можно чертить внутренние стены с привязкой к контуру и существующим перегородкам.</span>
            <button className="plan-button plan-secondary" type="button" data-testid="plan-reopen"
              onClick={() => {
                if (apply({ type: 'PLAN_REOPEN', payload: {} })) {
                  setTool('outline'); setInteriorStart(null); setSelectedInteriorId(null)
                }
              }}>Разомкнуть для продолжения</button>
          </div>
          <div className="plan-tool-section" data-testid="plan-outer-wall-width">
            <strong className="plan-section-title">Толщина наружных стен</strong>
            <label htmlFor="outer-wall-width">Толщина внутрь периметра, мм</label>
            <input id="outer-wall-width" data-testid="plan-outer-thickness"
              type="number" min="50" max="500" step="1"
              value={outerWidthDraft} onChange={e=>setOuterWidthDraft(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')setExteriorThickness()}} />
            <button type="button" className="plan-button plan-secondary"
              data-testid="plan-save-outer-thickness" onClick={setExteriorThickness}>
              Применить толщину
            </button>
          </div>
          <div className="plan-tool-section" data-testid="plan-interior-controls">
            <strong className="plan-section-title">02 · Свободная планировка</strong>
            <p className="plan-muted">Ставьте точки где угодно внутри контура. Ломаная строится по кликам и поворачивает на 90°. Enter — закончить. Можно разделить и удалить только один участок.</p>
            <label htmlFor="plan-interior-thickness">Толщина стены, мм</label>
            <input id="plan-interior-thickness" data-testid="plan-wall-thickness"
              type="number" min="50" max="500" step="1"
              value={interiorThickness} onChange={e => setInteriorThickness(e.target.value)} />
            <div className="plan-mode-buttons plan-tools-grid">
              <button type="button" data-testid="plan-tool-interior"
                className={tool==='interior'?'plan-mode-active':''}
                onClick={()=>{setTool('interior');setSelectedInteriorId(null);setSelectedGraphNodeId(null)}}>
                <span>✎</span> Ломаная
              </button>
              <button type="button" data-testid="plan-tool-point"
                className={tool==='point'?'plan-mode-active':''}
                onClick={()=>{finishPolyline();setTool('point')}}>
                <span>●</span> Точка
              </button>
              <button type="button" data-testid="plan-tool-turn"
                disabled={!interiorStart||!lastSegmentAxis}
                className={tool==='turn'?'plan-mode-active':''}
                onClick={()=>setTool('turn')}>
                <span>↳</span> Поворот
              </button>
              <button type="button" data-testid="plan-tool-split"
                className={tool==='split'?'plan-mode-active':''}
                onClick={()=>{finishPolyline();setTool('split')}}>
                <span>✂</span> Разделить
              </button>
              <button type="button" data-testid="plan-tool-erase"
                className={tool==='erase'?'plan-mode-active':''}
                onClick={()=>{finishPolyline();setTool('erase')}}>
                <span>⌫</span> Удалить
              </button>
              <button type="button" data-testid="plan-tool-select"
                className={tool==='select'?'plan-mode-active':''}
                onClick={()=>{finishPolyline();setTool('select')}}>
                <span>↖</span> Выбрать
              </button>
            </div>
            {interiorStart && <div className="plan-anchor-info" data-testid="plan-anchor-info">
              Начало: X {meters(interiorStart.xMm)} · Z {meters(interiorStart.zMm)} м
              <button type="button" data-testid="plan-finish-polyline" onClick={finishPolyline}>
                Завершить ломаную (Enter)
              </button>
            </div>}
            <p className="plan-guidance">Отрезков: <strong data-testid="plan-wall-count">{viewPlan.interiorWalls.length}</strong>
              {' · '}Свободных точек: <strong data-testid="plan-node-count">{plan.graph?.nodes.length??0}</strong>
            </p>
            {(plan.graph?.nodes.length||plan.interiorWalls.length>0) && <button type="button"
              className="plan-button plan-text" data-testid="plan-clear-interior"
              onClick={()=>{
                if(window.confirm('Удалить все внутренние точки и отрезки?')){
                  if(apply({type:'PLAN_GRAPH_CLEAR',payload:{}})){
                    finishPolyline();setSelectedInteriorId(null);setSelectedGraphNodeId(null)
                  }
                }
              }}>Очистить внутренний план</button>}
          </div>
          {selectedGraphNode && tool==='select' && <div className="plan-tool-section"
              data-testid="plan-selected-graph-node">
              <strong className="plan-section-title">Точка {selectedGraphNode.id}</strong>
              <p className="plan-muted">Связанные отрезки используют один узел. Перемещение разрешено, если остаётся корректная геометрия.</p>
              <label>X, м
                <input data-testid="plan-node-edit-x" value={nodeEdit.x} type="text"
                  onChange={e=>setNodeEdit(p=>({...p,x:e.target.value}))}/>
              </label>
              <label>Z, м
                <input data-testid="plan-node-edit-z" value={nodeEdit.z} type="text"
                  onChange={e=>setNodeEdit(p=>({...p,z:e.target.value}))}/>
              </label>
              <button type="button" className="plan-button plan-primary"
                data-testid="plan-save-graph-node" onClick={saveGraphNode}>
                Применить координаты
              </button>
              <button type="button" className="plan-button plan-text"
                data-testid="plan-delete-graph-node" onClick={()=>{
                  if(apply({type:'PLAN_GRAPH_DELETE_POINT',payload:{id:selectedGraphNode.id}}))
                    setSelectedGraphNodeId(null)
                }}>Удалить свободную точку</button>
            </div>}
          {selectedInterior && tool === 'select' && (
            <div className="plan-tool-section" data-testid="plan-selected-interior">
              <strong className="plan-section-title">Стена {selectedInterior.id}</strong>
              <p className="plan-muted">Перетаскивайте стену мышью или нажмите размер между стенами на плане. Точные координаты оси также доступны ниже.</p>
              {([
                ['sx', 'Начало X, м'], ['sz', 'Начало Z, м'],
                ['ex', 'Конец X, м'], ['ez', 'Конец Z, м'],
                ['thickness', 'Толщина, мм'],
              ] as const).map(([key,label]) =>
                <label key={key}>{label}
                  <input data-testid={'plan-edit-' + key} type="text" value={interiorEdit[key]}
                    onChange={e => setInteriorEdit(prev => ({...prev, [key]: e.target.value}))} />
                </label>
              )}
              <p className="plan-guidance">Длина: {meters(planDistanceMm(selectedInterior.start, selectedInterior.end))} м</p>
              <button className="plan-button plan-primary" data-testid="plan-save-interior"
                type="button" onClick={updateInteriorWall}>Применить координаты</button>
              <button className="plan-button plan-text" data-testid="plan-remove-interior"
                type="button" onClick={() => {
                  if(window.confirm('Удалить выбранный отрезок '+selectedInterior.id+'?')){
                    if(plan.graph)eraseWall(selectedInterior.id)
                    else if(apply({type:'PLAN_REMOVE_INTERIOR_WALL',payload:{id:selectedInterior.id}}))
                      setSelectedInteriorId(null)
                  }
                }}>Удалить стену</button>
            </div>
          )}
        </>}
        <div className="plan-tool-section plan-actions">
          {!plan.closed && <button type="button" className="plan-button plan-secondary"
            data-testid="plan-remove-last" disabled={!points.length}
            onClick={() => { if (apply({ type: 'PLAN_REMOVE_LAST', payload: {} })) setSelectedIndex(null) }}>
            Удалить последнюю точку
          </button>}
          <button type="button" className="plan-button plan-text" data-testid="plan-reset"
            disabled={!points.length} onClick={() => {
              if (window.confirm('Удалить весь наружный контур?')) {
                if (apply({ type: 'PLAN_CLEAR', payload: {} })) {
                  setSelectedIndex(null); setHover(null); fitView()
                }
              }
            }}>Очистить чертёж</button>
        </div>
        {selectedIndex !== null && points[selectedIndex] && (
          <div className="plan-tool-section" data-testid="plan-selected-point">
            <strong>Точка {selectedIndex + 1}</strong>
            {selectedIndex === 0 ? <p className="plan-muted">Начало координат зафиксировано: X=0, Z=0.</p> :
              <>
                <label htmlFor="plan-point-x">X, м</label>
                <input id="plan-point-x" type="text" value={pointX}
                  onChange={e => setPointX(e.target.value)} />
                <label htmlFor="plan-point-z">Z, м</label>
                <input id="plan-point-z" type="text" value={pointZ}
                  onChange={e => setPointZ(e.target.value)} />
                <button type="button" className="plan-button plan-secondary"
                  data-testid="plan-save-point" onClick={moveSelectedPoint}>
                  Применить координаты
                </button>
              </>}
          </div>
        )}
        {localError && <div className="plan-error" role="alert" data-testid="plan-error">{localError}</div>}
        <div className="plan-divider" />
        {!plan.closed && <div className="plan-step plan-step-secondary">
          <span className="plan-step-count">02</span>
          <div><strong>Внутренние стены</strong><small>Доступны после замыкания наружного периметра.</small></div>
        </div>}
        <button type="button" className="plan-button plan-export" onClick={onExport}
          data-testid="plan-export">Экспортировать план в JSON</button>
        <button type="button" className="plan-button plan-text" onClick={onImport}>Импортировать JSON</button>
      </aside>
      <main className="plan-drawing">
        <div className="plan-toolbar">
          <div className="plan-mode-mark"><span className="plan-dot" /> ПЛАН / {plan.closed
              ?({interior:'ЛОМАНАЯ СТЕНА',turn:'ПОВОРОТ 90°',point:'СВОБОДНАЯ ТОЧКА',
                split:'РАЗДЕЛЕНИЕ',erase:'УДАЛЕНИЕ ОТРЕЗКА',select:'РЕДАКТИРОВАНИЕ',
                outline:'НАРУЖНЫЙ КОНТУР'}[tool])
              :'НАРУЖНЫЙ КОНТУР'}</div>
          <label className="plan-grid-select">Шаг привязки
            <select data-testid="plan-grid-step" value={snapMm}
              onChange={event => setSnapMm(Number(event.target.value))}>
              <option value={100}>0,10 м</option><option value={250}>0,25 м</option>
              <option value={500}>0,50 м</option><option value={1000}>1,00 м</option>
            </select>
          </label>
          <div className="plan-zoom-tools">
            <button type="button" title="Уменьшить масштаб" onClick={() => setZoom(s => Math.max(0.32,s/1.15))}>−</button>
            <span data-testid="plan-zoom">{Math.round(zoom*100)}%</span>
            <button type="button" title="Увеличить масштаб" onClick={() => setZoom(s => Math.min(2.8,s*1.15))}>+</button>
            <button type="button" data-testid="plan-fit" title="Показать весь план" onClick={fitView}>Весь план</button>
          </div>
        </div>
        <div className="plan-canvas-wrap">
          <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="plan-canvas"
            data-testid="plan-canvas" role="img" aria-label="Чертёж периметра здания, метры"
            onClick={onCanvasClick} onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => setHover(null)}
            onWheel={wheel}>
            <defs>
              <pattern id="plan-small-grid" x={originX} y={originY}
                width={px/4} height={px/4} patternUnits="userSpaceOnUse">
                <path d={`M ${px/4} 0 L 0 0 0 ${px/4}`} fill="none" stroke="#e4eaf1" strokeWidth="0.8"/>
              </pattern>
              <pattern id="plan-big-grid" x={originX} y={originY}
                width={px} height={px} patternUnits="userSpaceOnUse">
                <path d={`M ${px} 0 L 0 0 0 ${px}`} fill="none" stroke="#ccd7e3" strokeWidth="1.1"/>
              </pattern>
            </defs>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fcfdff" />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-small-grid)" pointerEvents="none" />
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-big-grid)" pointerEvents="none" />
            <line x1={originX} y1={0} x2={originX} y2={HEIGHT}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <line x1={0} y1={originY} x2={WIDTH} y2={originY}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <text x={WIDTH-32} y={originY-14} className="plan-axis-label" textAnchor="end">+X →</text>
            <text x={originX+14} y={22} className="plan-axis-label">−Z ↑</text>
            {plan.closed && <polygon points={fill} fill="#d9eafa" fillOpacity=".42" stroke="none" pointerEvents="none"/>}
            {exteriorWallStrips(plan).map((strip,i)=>
              <polygon key={'outer-strip-'+i} data-testid={'plan-exterior-strip-'+i}
                points={strip.map(p=>{const q=xy(p);return q.x+','+q.y}).join(' ')}
                fill="#567a91" fillOpacity=".56" stroke="none" pointerEvents="none"/>
            )}
            {edges.map(edge => {
              const a=xy(edge.from),b=xy(edge.to)
              const dx=b.x-a.x,dy=b.y-a.y
              const length=Math.hypot(dx,dy)
              const norm={x:-dy/length,y:dx/length}
              const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
              const boundingCenter={x:(bounds.minX+bounds.maxX)/2,
                z:(bounds.minZ+bounds.maxZ)/2}
              const centerScreen=xy({xMm:boundingCenter.x,zMm:boundingCenter.z})
              const dot=(center.x-centerScreen.x)*norm.x+(center.y-centerScreen.y)*norm.y
              const side=dot>=0?1:-1
              const offset=norm.x*26*side, offsetY=norm.y*26*side
              const labelX=center.x+offset, labelY=center.y+offsetY
              const rotation=Math.abs(dx)<Math.abs(dy)?-90:0
              const label=meters(planDistanceMm(edge.from,edge.to))+' м'
              return <g key={edge.index} pointerEvents="none">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plan-wall-line" style={{strokeWidth:plan.closed?2.5:8}} />
                <line x1={a.x+norm.x*17*side} y1={a.y+norm.y*17*side}
                  x2={b.x+norm.x*17*side} y2={b.y+norm.y*17*side} className="plan-dimension-line"/>
                <g transform={`translate(${labelX} ${labelY}) rotate(${rotation})`}>
                  <rect x={-40} y={-11} width={80} height={22} rx={5} fill="white" stroke="#dbe6ef" />
                  <text y={5} textAnchor="middle" className="plan-dimension-text">{label}</text>
                </g>
              </g>
            })}
            {current && proposal && !plan.closed && !(
              current.xMm===proposal.xMm&&current.zMm===proposal.zMm) && (
              <g pointerEvents="none">
                <line x1={xy(current).x} y1={xy(current).y}
                  x2={xy(proposal).x} y2={xy(proposal).y}
                  stroke={proposalErrors.length ? '#da574c':'#27a59b'}
                  strokeWidth={4} strokeDasharray="9 8" />
                <circle cx={xy(proposal).x} cy={xy(proposal).y} r={6}
                  fill={proposalErrors.length ? '#da574c':'#27a59b'}/>
                <text x={xy(proposal).x+13} y={xy(proposal).y-12}
                  fill="#0f6d65" fontSize={15}>{meters(planDistanceMm(current,proposal))} м</text>
              </g>
            )}
            {visibleWalls.map(w => {
              const a = xy(w.start), b = xy(w.end)
              const active = selectedInteriorId === w.id && tool === 'select'
              const label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
              return <g key={w.id} data-testid={'plan-internal-wall-' + w.id}
                onClick={e=>{
                  if(ignoreClick.current){ignoreClick.current=false;e.stopPropagation();return}
                  if(tool==='select'){e.stopPropagation();selectInteriorWall(w)}
                  if(tool==='erase'){e.stopPropagation();eraseWall(w.id)}
                  if(tool==='split'){
                    e.stopPropagation()
                    const root=svgRef.current,transform=root?.getScreenCTM()
                    if(!transform)return
                    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(transform.inverse())
                    splitAtWall(w,canvasWorldPoint(p))
                  }
                }}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? '#d99138' : '#c27a2f'}
                  strokeWidth={Math.max(2,w.thicknessMm * px / 1000)}
                  strokeLinecap="butt" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent" strokeWidth={Math.max(18,w.thicknessMm * px / 1000)}
                  pointerEvents="stroke" onPointerDown={e=>beginWallDrag(e,w)}
                  className="plan-interior-hit"/>
                <text x={label.x + (a.x === b.x ? 18 : 0)}
                  y={label.y + (a.y === b.y ? -15 : 0)}
                  textAnchor="middle" className="plan-inner-label" pointerEvents="none">
                  {meters(planDistanceMm(w.start,w.end))} м
                </text>
              </g>
            })}
            {clearances && (['negative','positive'] as const).map(side => {
              const entry=clearances[side]
              if (!entry) return null
              const vertical=clearances.axis==='x'
              const row=clearances.scanMm
              const start=vertical
                ? xy({xMm:entry.referenceMm,zMm:row})
                : xy({xMm:row,zMm:entry.referenceMm})
              const end=vertical
                ? xy({xMm:clearances.coordinateMm,zMm:row})
                : xy({xMm:row,zMm:clearances.coordinateMm})
              const centerX=(start.x+end.x)/2
              const centerY=(start.y+end.y)/2
              const labelX=vertical?centerX:centerX+25
              const labelY=vertical?centerY-22:centerY
              const currentlyEditing=dimensionEdit?.side===side
              return <g key={side} data-testid={'plan-clearance-'+side}>
                <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                  stroke="#1b97a6" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none"/>
                <circle cx={start.x} cy={start.y} r={3} fill="#1b97a6" pointerEvents="none"/>
                <circle cx={end.x} cy={end.y} r={3} fill="#1b97a6" pointerEvents="none"/>
                {!currentlyEditing && <g className="plan-click-dimension" role="button" tabIndex={0}
                  onClick={event=>{
                    event.stopPropagation()
                    setDimensionEdit({side,value:meters(entry.distanceMm)})
                  }}
                  onKeyDown={event=>{
                    if(event.key==='Enter' || event.key===' ') {
                      event.preventDefault()
                      setDimensionEdit({side,value:meters(entry.distanceMm)})
                    }
                  }}>
                  <rect x={labelX-47} y={labelY-17} rx={6} width={94} height={30}
                    fill="#fff" stroke="#72abb6" strokeWidth={1.5}/>
                  <text x={labelX} y={labelY+3} textAnchor="middle"
                    fill="#176f81" fontWeight={750} fontSize={13} pointerEvents="none">
                    {meters(entry.distanceMm)} м
                  </text>
                </g>}
                {currentlyEditing && dimensionEdit && <foreignObject x={labelX-60} y={labelY-18}
                    width={120} height={40}>
                    <div className="plan-inline-dimension">
                      <input data-testid="plan-dimension-input" autoFocus
                        aria-label="Новый размер, метры"
                        type="text" inputMode="decimal" value={dimensionEdit.value}
                        onClick={event=>event.stopPropagation()}
                        onChange={event=>setDimensionEdit({...dimensionEdit,value:event.target.value})}
                        onKeyDown={event=>{
                          if(event.key==='Enter'){event.stopPropagation();saveDimension()}
                          if(event.key==='Escape'){event.stopPropagation();setDimensionEdit(null)}
                        }}/>
                    </div>
                  </foreignObject>}
              </g>
            })}
            {innerJunctions.map((p,i) => {
              const pos=xy(p)
              return <circle key={i} cx={pos.x} cy={pos.y} r={6}
                fill="#ffe0ae" stroke="#a86622" strokeWidth={2} pointerEvents="none"/>
            })}
            {plan.closed && (tool==='interior'||tool==='turn') && interiorStart && (
              <g pointerEvents="none">
                {interiorHover && <line x1={xy(interiorStart).x} y1={xy(interiorStart).y}
                  x2={xy(interiorHover).x} y2={xy(interiorHover).y}
                  stroke="#2e9d7d" strokeWidth={4} strokeDasharray="9 6"
                  vectorEffect="non-scaling-stroke" />}
                <circle cx={xy(interiorStart).x} cy={xy(interiorStart).y}
                  r={8} fill="#1ebd9c" stroke="#fff" strokeWidth={3}/>
                {interiorHover && <circle cx={xy(interiorHover).x} cy={xy(interiorHover).y}
                  r={7} fill="#1ebd9c" stroke="#fff" strokeWidth={2}/>}
              </g>
            )}
            {activeNodes.map(node=>{
              const loc=xy(node)
              return <g key={'graph-'+node.id} data-testid={'plan-graph-node-'+node.id}
                className="plan-graph-node"
                onClick={e=>{
                  if(ignoreClick.current){ignoreClick.current=false;e.stopPropagation();return}
                  if(tool==='select'){e.stopPropagation();selectGraphNode(node.id)}
                  else if(tool==='erase'){
                    e.stopPropagation()
                    if(apply({type:'PLAN_GRAPH_DELETE_POINT',payload:{id:node.id}}))
                      setSelectedGraphNodeId(null)
                  }else if(tool==='interior'||tool==='turn'||tool==='point'){
                    e.stopPropagation();graphClick({xMm:node.xMm,zMm:node.zMm})
                  }
                }}>
                <circle cx={loc.x} cy={loc.y}
                  r={selectedGraphNodeId===node.id?7:5}
                  fill={selectedGraphNodeId===node.id?'#138da5':'#ffe6b9'}
                  stroke="#955b2c" strokeWidth={2}
                  onPointerDown={e=>beginNodeDrag(e,node.id)}/>
                <circle cx={loc.x} cy={loc.y} r={12} fill="transparent"
                  onPointerDown={e=>beginNodeDrag(e,node.id)}/>
              </g>
            })}
            {points.map((point,i) => {
              const loc=xy(point)
              return <g key={i} data-testid={`plan-point-${i}`}
                className="plan-vertex" onClick={event => {event.stopPropagation();selectPoint(i)}}>
                <circle cx={loc.x} cy={loc.y} r={i===0?12:9}
                  fill={i===0?'#18a98b':selectedIndex===i?'#ffab40':'#ffffff'}
                  stroke={i===0?'#0f6f60':'#234765'} strokeWidth={3}/>
                <text x={loc.x} y={loc.y-19} textAnchor="middle"
                  className="plan-node-label">{i===0?'0,0':String(i+1)}</text>
                <circle cx={loc.x} cy={loc.y} r={19} fill="transparent"/>
              </g>
            })}
            {!points.length &&
              <g pointerEvents="none">
                <circle cx={originX} cy={originY} r={16} fill="#d9f6ec"
                  stroke="#169a78" strokeWidth={2} strokeDasharray="3 4"/>
                <text x={originX+22} y={originY-18} className="plan-start-caption">НАЧАЛО 0,0</text>
                <text x={originX+22} y={originY+2} className="plan-start-subcaption">
                  Щёлкните, чтобы поставить первую точку
                </text>
              </g>}
          </svg>
          <div className="plan-measure-panel" data-testid="plan-stats">
            <div><span>Габариты</span><strong data-testid="plan-dimensions">{meters(bounds.maxX-bounds.minX)} × {meters(bounds.maxZ-bounds.minZ)} м</strong></div>
            <div><span>{plan.closed?'Периметр':'Начерчено'}</span><strong data-testid="plan-perimeter">{meters(totalLength)} м</strong></div>
            <div><span>Площадь</span><strong data-testid="plan-area">{plan.closed?planAreaM2(plan).toLocaleString('ru-RU',{maximumFractionDigits:2}):'—'} м²</strong></div>
          </div>
          <div className="plan-canvas-hint">{plan.closed
            ?(tool==='interior'||tool==='turn'
              ?'ЛКМ — следующая точка · 90° · Enter — закончить ломаную · Shift+drag — панорама'
              :tool==='point'?'ЛКМ — свободная точка или узел на стене'
              :tool==='split'?'Нажмите отрезок в месте разделения'
              :tool==='erase'?'Нажмите отрезок для удаления · Undo доступен'
              :'Перетащите стену или точку · кликните размер · Delete — удалить')
            :'ЛКМ — следующая точка · Shift+drag — сдвиг · колесо — масштаб'}</div>
        </div>
        <div className="plan-bottom">
          <span><strong>Узлов:</strong> {points.length}</span>
          <span><strong>Участков:</strong> {edges.length}</span>
          <span><strong>Отрезков:</strong> {viewPlan.interiorWalls.length}</span>
          <span><strong>Статус:</strong> {plan.closed?'Замкнут':'Черновик'}</span>
          <span className="plan-bottom-right">План в мм · отображение в м · сохранение в JSON</span>
        </div>
      </main>
    </div>
  )
}
