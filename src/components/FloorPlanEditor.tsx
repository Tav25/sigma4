import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import {
  emptyFloorPlan, meters, planAreaM2, planBounds, planDistanceMm,
  planPerimeterMm, validateFloorPlan, decimalMetersToMm,
  snapPlanAnchor, planInteriorJunctions, planWallClearances,
  moveInteriorWallWithDependents, moveWallToClearance, exteriorWallStrips,
  DEFAULT_EXTERIOR_THICKNESS_MM,
  type FloorPlan, type PlanPoint, type PlanInteriorWall,
} from '../core/floor-plan'
import { addGraphPoint, addGraphSegment, graphView, moveGraphEdge, moveGraphEdgeToDimension, moveGraphPoint, resizePlanWallLength } from '../core/plan-graph'
import { preservePlanOpeningAttachments } from '../core/plan-attachment-constraints'
import { openingNudgeForArrow, wallNudgeForArrow } from '../core/plan-keyboard-nudge'
import type { ProjectCommand, CommandResult } from '../core/ProjectStore'
import { planSidePoint, planFrameOpeningSides, planSideLength, validatePlanFrame, type PlanFrameSide } from '../core/plan-frame'
import { sideOffset } from '../core/partition-layout'
import { deriveFloorRooms,formatRoomArea,ROOM_COLORS,totalRoomAreaM2,type FloorRoom } from '../core/rooms'
import type { Opening } from '../core/project'
import { usePlanOpenings } from './usePlanOpenings'
import { OpeningCut, PlanOpeningDimensions, PlanOpeningSymbol, closestPointOnSide } from './PlanOpeningGraphics'
import { exteriorDimensionNormal, planGridMetrics, roomLabelKind, zoomPlanAround } from '../core/plan-visualization'
import { PlanOpeningInspector, PlanWallActions, PlanWallSelection } from './PlanSelection'
import { PlanFrameControls, type PlanFramePick } from './PlanFrameControls'

const preciseMetres = (mm:number) => (mm/1000).toFixed(3).replace('.', ',')
const EMPTY_PLAN = emptyFloorPlan()
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
type DraftTool = 'outline'|'interior'|'turn'|'point'|'split'|'erase'|'select'|'frame'

export interface FloorPlanEditorProps {
  plan?: FloorPlan
  rooms: FloorRoom[]
  showRoomLabels:boolean
  showRoomFill:boolean
  selectedRoomId:string|null
  onSelectRoom:(id:string|null)=>void
  onShowRoomLabelsChange:(value:boolean)=>void
  onShowRoomFillChange:(value:boolean)=>void
  onCommand: (command: ProjectCommand) => CommandResult
  onExport: () => void
  onImport: () => void
  onFrameBuilt: () => void
  onUndo: () => void
  onRedo: () => void
}

export function FloorPlanEditor({
  plan = EMPTY_PLAN, rooms, showRoomLabels, showRoomFill, selectedRoomId,
  onSelectRoom, onShowRoomLabelsChange, onShowRoomFillChange,
  onCommand, onExport, onImport, onFrameBuilt, onUndo, onRedo,
}: FloorPlanEditorProps) {
  const [direction, setDirection] = useState<Direction>('+x')
  const [exactLength, setExactLength] = useState('6')
  const [snapMm, setSnapMm] = useState(250)
  const [gridVisible, setGridVisible] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState<PlanPoint | null>(null)
  const [localError, setLocalError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [currentTool, setTool] = useState<DraftTool>('outline')
  const tool = plan.closed && currentTool === 'outline' ? 'select' : currentTool
  const [lastSegmentAxis, setLastSegmentAxis] = useState<'x'|'z'|null>(null)
  const [selectedGraphNodeId,setSelectedGraphNodeId] = useState<string|null>(null)
  const [nodeEdit,setNodeEdit] = useState({x:'',z:''})
  const [interiorStart, setInteriorStart] = useState<PlanPoint | null>(null)
  const [interiorHover, setInteriorHover] = useState<PlanPoint | null>(null)
  const [interiorThickness, setInteriorThickness] = useState('100')
  const [selectedInteriorId, setSelectedInteriorId] = useState<string | null>(null)
  const [interiorEdit, setInteriorEdit] = useState({ sx: '', sz: '', ex: '', ez: '', thickness: '100' })
  const [wallLengthDraft, setWallLengthDraft] = useState('')
  const [lengthFixedEnd, setLengthFixedEnd] = useState<'start'|'end'>('start')
  const [dimensionEdit, setDimensionEdit] = useState<{side:'negative'|'positive';value:string}|null>(null)
  const [outerWidthDraft, setOuterWidthDraft] = useState(String(plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM))
  const [wallPreview, setWallPreview] = useState<FloorPlan | null>(null)
  const wallPointer = useRef<WallPointerDrag | null>(null)
  const nodePointer = useRef<NodePointerDrag|null>(null)
  const [pointX, setPointX] = useState('')
  const [pointZ, setPointZ] = useState('')
  const drag = useRef<PanDrag | null>(null)
  const ignoreClick = useRef(false)
  const cancelledOpeningPointer = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    setOuterWidthDraft(String(plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM))
  }, [plan.exteriorThicknessMm])
  const [framePick, setFramePick] = useState<PlanFramePick | null>(null)
  const [frameIssueIds, setFrameIssueIds] = useState<string[]>([])
  useEffect(() => setFrameIssueIds([]), [plan])
  const openingTools = usePlanOpenings(plan, onCommand)
  const frameSides = openingTools.sides
  const drawingSides = useMemo(() => wallPreview ? planFrameOpeningSides(wallPreview, true) : frameSides,
    [wallPreview, frameSides])
  const { selectedWall, selectedOpening, placement, placementWall, preview, wallPick } = openingTools
  const openingInputActive = tool === 'select' || tool === 'frame'
  const shownOpenings = (wallPreview?.frame?.openings ?? openingTools.openings).map(opening => opening.id === preview?.opening.id
    ? { ...opening, positionUmm: preview.error ? openingTools.lastValidPosition ?? opening.positionUmm : preview.opening.positionUmm }
    : opening)
  const openingCuts = preview && !preview.error && placement ? [...shownOpenings, preview.opening] : shownOpenings
  const annotatedOpening = preview?.opening ?? (openingInputActive ? selectedOpening : undefined)
  const annotatedSide = drawingSides.find(side => side.wallId === annotatedOpening?.wallId)
  const showWallActions = tool === 'select' && selectedWall && wallPick && !selectedOpening &&
    !placement && !wallPreview && !dimensionEdit
  const placementLabel = placement && { window: 'Окно', door: 'Дверь', 'garage-door': 'Ворота' }[placement.type]
  const hasFrameWork = plan.frame?.built || !!plan.frame?.openings.length
  const points = plan.exterior
  const viewPlan=graphView(plan)
  const selectedInterior = viewPlan.interiorWalls.find(w => w.id === selectedInteriorId)
  const visiblePlan = graphView(wallPreview ?? plan)
  const visibleWalls = visiblePlan.interiorWalls
  const visibleRooms=useMemo(()=>wallPreview?deriveFloorRooms(wallPreview):rooms,
    [wallPreview,rooms])
  const activeNodes=(wallPreview??plan).graph?.nodes ?? []
  const selectedGraphNode=plan.graph?.nodes.find(n=>n.id===selectedGraphNodeId)
  const innerJunctions = planInteriorJunctions(visiblePlan)
  const clearances = selectedInterior && tool === 'select'
    ? planWallClearances(visiblePlan, selectedInterior.id) : null
  const px = zoom * BASE_PX_PER_METRE
  const gridMetrics = planGridMetrics(px, snapMm)
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
  const hostHit = (side: PlanFrameSide, location: { x: number; y: number }, point: PlanPoint) => {
    const offsetMm = sideOffset(side, point)
    const nearest = xy(closestPointOnSide(side, offsetMm))
    const matrix = svgRef.current?.getScreenCTM()
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1
    const distance = Math.hypot(nearest.x - location.x, nearest.y - location.y) * scale
    const depthMm = 'thicknessMm' in side ? side.thicknessMm / 2 : plan.exteriorThicknessMm ?? DEFAULT_EXTERIOR_THICKNESS_MM
    return { side, offsetMm, distance, hit: distance <= Math.max(16, depthMm * px / 1000 * scale + 6) }
  }
  const pickHost = (location: { x: number; y: number }, point: PlanPoint) => frameSides
    .map(side => hostHit(side, location, point)).filter(hit => hit.hit).sort((a, b) => a.distance - b.distance)[0]
  const openingStep = (event: { altKey: boolean }) => event.altKey ? 1 : 100
  const revealInspector = () => sidebarRef.current?.scrollTo({ top: 0 })

  const clearPlanSelection = () => {
    setSelectedInteriorId(null)
    setSelectedGraphNodeId(null)
    setSelectedIndex(null)
    setDimensionEdit(null)
  }
  const clearSelection = () => {
    openingTools.clearSelection()
    clearPlanSelection()
  }
  const cancelOpeningEdit = () => {
    const pointerId = openingTools.cancel()
    if (pointerId !== undefined && svgRef.current?.hasPointerCapture(pointerId)) {
      // Keep capture until release so the cancelled gesture cannot click the plan.
      cancelledOpeningPointer.current = pointerId
    }
  }
  const selectHost = (side: PlanFrameSide, offsetMm: number) => {
    clearPlanSelection()
    openingTools.selectWall(side, Math.max(0, Math.min(planSideLength(side), offsetMm)))
    setLocalError('')
    revealInspector()
  }
  const selectOpening = (opening: Opening) => {
    clearPlanSelection()
    openingTools.selectOpening(opening)
    setLocalError('')
    revealInspector()
  }
  const beginOpeningDrag = (event: PointerEvent<SVGGElement>, opening: Opening) => {
    if (tool !== 'select' || placement || !event.isPrimary || event.button !== 0 || event.shiftKey) return
    const svg = svgRef.current, transform = svg?.getScreenCTM()
    if (!svg || !transform) return
    event.stopPropagation()
    event.preventDefault()
    const loc = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse())
    selectOpening(opening)
    if (openingTools.beginDrag(opening, canvasWorldPoint(loc), event)) svg.setPointerCapture(event.pointerId)
  }
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
  const activateTool = (next: DraftTool) => {
    if (tool !== next) finishPolyline()
    cancelOpeningEdit()
    clearSelection()
    setLocalError('')
    setTool(next)
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
    if (!interiorStart) {
      // The first click is a draft anchor. The edge creates its nodes on commit.
      try {
        const errors = validateFloorPlan(addGraphPoint(plan, point))
        if (errors.length) { setLocalError(errors[0]); return }
        setInteriorStart(point)
        setSelectedInteriorId(null)
        setLocalError('')
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : 'Недопустимая начальная точка')
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
    openingTools.clearSelection()
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
    if(tool!=='select'||placement||event.button!==0||event.shiftKey)return
    const root=svgRef.current,screen=root?.getScreenCTM()
    if(!root||!screen)return
    event.stopPropagation();event.preventDefault()
    const pos=new DOMPoint(event.clientX,event.clientY).matrixTransform(screen.inverse())
    selectGraphNode(id)
    nodePointer.current={id,pointerId:event.pointerId,startX:pos.x,startY:pos.y,
      moved:false,point:null,candidate:null}
    root.setPointerCapture(event.pointerId)
  }
  const selectInteriorWall = (wall: PlanInteriorWall, point?: PlanPoint) => {
    const side = frameSides.find(item => item.wallId === 'partition-' + wall.id)
    if (point) {
      if (side) selectHost(side, sideOffset(side, point))
      else { openingTools.clearSelection(); revealInspector() }
    }
    setSelectedInteriorId(wall.id)
    setSelectedGraphNodeId(null)
    setDimensionEdit(null)
    setSelectedIndex(null)
    setLengthFixedEnd('start')
    setWallLengthDraft(preciseMetres(planDistanceMm(wall.start,wall.end)))
    setInteriorEdit({
      sx: preciseMetres(wall.start.xMm), sz: preciseMetres(wall.start.zMm),
      ex: preciseMetres(wall.end.xMm), ez: preciseMetres(wall.end.zMm),
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
    if (tool !== 'select' || placement || event.button !== 0 || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    const root=svgRef.current
    const screen=root?.getScreenCTM()
    if (!root || !screen) return
    const pos=new DOMPoint(event.clientX,event.clientY).matrixTransform(screen.inverse())
    selectInteriorWall(wall, canvasWorldPoint(pos))
    setDimensionEdit(null)
    wallPointer.current={id:wall.id,pointerId:event.pointerId,startX:pos.x,
      startY:pos.y,offsetMm:0,moved:false,candidate:null}
    root.setPointerCapture(event.pointerId)
  }
  /** One validated ProjectStore command per nudge; shared junctions and
   * attached openings are moved by the canonical geometry engine.
   */
  const nudgeSelectedWall = (offsetMm:number) => {
    if(!selectedInterior || !Number.isInteger(offsetMm) || !offsetMm)return
    let candidate:FloorPlan|null
    try {
      candidate=plan.graph
        ?moveGraphEdge(plan,selectedInterior.id,offsetMm)
        :moveInteriorWallWithDependents(plan,selectedInterior.id,offsetMm)
    } catch(error) {
      setLocalError(error instanceof Error?error.message:'Недопустимое перемещение стены')
      return
    }
    if(!candidate){
      setLocalError('Эту стену нельзя переместить, сохранив соединения')
      return
    }
    if(apply({type:'PLAN_MOVE_INTERIOR_WALL',payload:{
      id:selectedInterior.id,offsetMm,
    }})){
      const moved=graphView(candidate).interiorWalls.find(w=>w.id===selectedInterior.id)
      if(moved) selectInteriorWall(moved)
    }
  }
  const saveWallLength = () => {
    if (!selectedInterior) return
    const lengthMm = decimalMetersToMm(wallLengthDraft)
    if (lengthMm === null) {
      setLocalError('Введите длину от 0,30 до 100 м с точностью 1 мм')
      return
    }
    if (lengthMm === planDistanceMm(selectedInterior.start,selectedInterior.end)) {
      setLocalError('')
      return
    }
    let changed: PlanInteriorWall | undefined
    try {
      const candidate=resizePlanWallLength(plan,selectedInterior.id,lengthMm,lengthFixedEnd)
      changed=graphView(candidate).interiorWalls.find(w=>w.id===selectedInterior.id)
    } catch (error) {
      setLocalError(error instanceof Error?error.message:'Неверная длина стены')
      return
    }
    if (apply({type:'PLAN_SET_INTERIOR_LENGTH',payload:{
      id:selectedInterior.id,lengthMm,fixedEnd:lengthFixedEnd,
    }})) {
      setWallLengthDraft(preciseMetres(lengthMm))
      if(changed)setInteriorEdit({
        sx:preciseMetres(changed.start.xMm),sz:preciseMetres(changed.start.zMm),
        ex:preciseMetres(changed.end.xMm),ez:preciseMetres(changed.end.zMm),
        thickness:String(changed.thicknessMm),
      })
    }
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
      setTool('select')
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
      const loc = svgFromEvent(event)
      const raw = canvasWorldPoint(loc)
      if (placement && placementWall) {
        if (hostHit(placementWall, loc, raw).hit) openingTools.place(raw, openingStep(event))
        return
      }
      if (tool === 'interior' || tool === 'turn' || tool === 'point') {
        graphClick(raw)
      } else if (openingInputActive) {
        const closest = pickHost(loc, raw)
        if (tool === 'frame') {
          if (closest) setFramePick({ wallId: closest.side.wallId, offsetMm: Math.max(0, snap(closest.offsetMm)) })
        } else if (closest) {
          const interior = viewPlan.interiorWalls.find(wall => 'partition-' + wall.id === closest.side.wallId)
          if (interior) selectInteriorWall(interior, raw)
          else selectHost(closest.side, closest.offsetMm)
        } else clearSelection()
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
    openingTools.clearSelection()
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
  // Zoom around the cursor: its world coordinate remains stationary.
  const zoomAt = (anchor: { x: number; y: number }, factor: number) => {
    const next = zoomPlanAround(zoom, pan, anchor, factor, BASE_PX_PER_METRE,
      { x: OFFSET_X, y: OFFSET_Y })
    setZoom(next.zoom)
    setPan(next.pan)
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    if (event.ctrlKey) return
    event.preventDefault()
    zoomAt(svgFromEvent(event), event.deltaY < 0 ? 1.10 : 1 / 1.10)
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
    if (cancelledOpeningPointer.current === event.pointerId ||
      openingTools.updateDrag(event, canvasWorldPoint(loc), openingStep(event))) return
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
        const candidate=preservePlanOpeningAttachments(plan,
          moveGraphPoint(plan,nodeMoving.id,nextPoint),'geometry')
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
        const moved=plan.graph?moveGraphEdge(plan,moving.id,offsetMm)
          :moveInteriorWallWithDependents(plan,moving.id,offsetMm)
        candidate=moved?preservePlanOpeningAttachments(plan,moved,'geometry'):null
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
    if (placementWall) {
      const point = canvasWorldPoint(loc)
      if (hostHit(placementWall, loc, point).hit) openingTools.positionPlacement(point, openingStep(event))
      else openingTools.hidePlacementPreview()
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
    const suppressCapturedClick = () => {
      // Selection happened on pointerdown. The synthetic click can target
      // the canvas after capture, where it would clear that selection.
      ignoreClick.current = event.type !== 'pointercancel'
      requestAnimationFrame(() => { ignoreClick.current = false })
    }
    const cancelledOpening = cancelledOpeningPointer.current === event.pointerId
    if (cancelledOpening || openingTools.finishDrag(event.pointerId, event.type === 'pointercancel')) {
      cancelledOpeningPointer.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      suppressCapturedClick()
      return
    }
    if(nodePointer.current?.pointerId===event.pointerId){
      const state=nodePointer.current;nodePointer.current=null
      suppressCapturedClick()
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
      suppressCapturedClick()
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
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
        event.preventDefault()
        cancelOpeningEdit()
        if (event.shiftKey || event.code === 'KeyY') onRedo()
        else onUndo()
        return
      }
      if (event.key === 'Escape') {
        if (placement || openingTools.isDragging()) cancelOpeningEdit()
        else if (interiorStart) { finishPolyline(); setTool('select') }
        else clearSelection()
        setLocalError('')
        event.preventDefault()
        return
      }
      if (placement && (event.key === 'Enter' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (event.key === 'Enter' && element instanceof HTMLButtonElement) return
        event.preventDefault()
        if (event.key === 'Enter') openingTools.confirmPlacement()
        else openingTools.nudgePlacement(event.key === 'ArrowLeft' ? -openingStep(event) : openingStep(event))
        return
      }
      if (event.key === 'Enter' && interiorStart) {
        finishPolyline()
        event.preventDefault()
        return
      }
      // Orthogonal CAD nudging: 25 mm, Shift=100 mm, Alt=1 mm.
      // Text/number inputs and active opening placement are excluded above.
      if(plan.closed&&tool==='select'&&!placement&&!event.ctrlKey&&!event.metaKey &&
        ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)){
        const step=event.altKey?1:event.shiftKey?100:25
        if(selectedOpening&&selectedWall){
          const offset=openingNudgeForArrow(selectedWall,event.code,step)
          if(offset!==null){
            event.preventDefault()
            openingTools.move(selectedOpening,selectedOpening.positionUmm+offset)
            return
          }
        }else if(selectedInterior){
          const offset=wallNudgeForArrow(selectedInterior,event.code,step)
          if(offset!==null){
            event.preventDefault()
            nudgeSelectedWall(offset)
            return
          }
        }else if(selectedGraphNode){
          const dx=event.code==='ArrowLeft'?-step:event.code==='ArrowRight'?step:0
          const dz=event.code==='ArrowUp'?-step:event.code==='ArrowDown'?step:0
          const next={xMm:selectedGraphNode.xMm+dx,zMm:selectedGraphNode.zMm+dz}
          event.preventDefault()
          if(apply({type:'PLAN_GRAPH_MOVE_POINT',payload:{
            id:selectedGraphNode.id,point:next,
          }}))setNodeEdit({x:preciseMetres(next.xMm),z:preciseMetres(next.zMm)})
          return
        }
      }
      if (plan.closed && !event.ctrlKey && !event.metaKey && !event.altKey &&
        (event.code === 'KeyV' || event.code === 'KeyW')) {
        event.preventDefault()
        activateTool(event.code === 'KeyV' ? 'select' : 'interior')
        return
      }
      if(event.key==='Delete'||event.key==='Backspace'){
        if(tool!=='select')return
        if (selectedOpening && !placement) {
          event.preventDefault()
          openingTools.remove(selectedOpening)
          return
        }
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
  const interiorDraft = useMemo(() => {
    if (!interiorStart || !interiorHover || !planDistanceMm(interiorStart, interiorHover)) return null
    const thickness = Number(interiorThickness)
    let error = ''
    try {
      const candidate = addGraphSegment(plan, interiorStart, interiorHover, thickness)
      error = validateFloorPlan(candidate)[0] ?? validatePlanFrame(candidate)[0]?.messageRu ?? ''
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Недопустимый участок стены'
    }
    return { start: interiorStart, end: interiorHover, thickness: Number.isFinite(thickness) ? thickness : 0, error }
  }, [plan, interiorStart, interiorHover, interiorThickness])

  return (
    <div className="plan-workspace" data-testid="plan-workspace">
      <aside className="plan-controls" ref={sidebarRef}>
        <div className="plan-eyebrow">SIGMA4 / ЧЕРТЁЖ 01</div>
        <h1>План этажа</h1>
        {!plan.closed && <p className="plan-muted">Задайте наружный контур на сетке или по точным размерам.</p>}
        {tool === 'select' && selectedOpening && selectedWall
          ? <PlanOpeningInspector opening={selectedOpening} side={selectedWall} onSave={openingTools.save}
              onRemove={() => openingTools.remove(selectedOpening)} />
          : tool === 'select' && selectedWall && <PlanWallSelection side={selectedWall} />}
        {!plan.closed && <div className="plan-step">
          <span className="plan-step-count">01</span>
          <div><strong>{plan.closed ? 'Контур готов' : points.length ? 'Продолжайте контур' : 'Начальная точка'}</strong>
            <small>{plan.closed ? 'Можно редактировать узлы и размеры'
              : points.length ? 'Щёлкните на сетке или введите следующую длину'
                : 'Нажмите на поле или кнопку: точка (0,0)'}</small>
          </div>
        </div>}
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
            <button className="plan-button plan-secondary" type="button" data-testid="plan-reopen" disabled={hasFrameWork}
              onClick={() => {
                if (apply({ type: 'PLAN_REOPEN', payload: {} })) {
                  setTool('outline'); setInteriorStart(null); setSelectedInteriorId(null)
                }
              }}>Разомкнуть для продолжения</button>
          </div>
          <PlanFrameControls plan={plan} pick={framePick} picking={tool === 'frame'}
            onPick={() => {
              activateTool(tool === 'frame' ? 'select' : 'frame')
            }}
            onCommand={onCommand} onIssues={setFrameIssueIds} onBuilt={onFrameBuilt} />
          <div className="plan-tool-section" data-testid="plan-outer-wall-width">
            <strong className="plan-section-title">Толщина наружных стен</strong>
            <label htmlFor="outer-wall-width">Толщина внутрь периметра, мм</label>
            <input id="outer-wall-width" data-testid="plan-outer-thickness"
              type="number" min="50" max="500" step="1"
              disabled={hasFrameWork} value={outerWidthDraft} onChange={e=>setOuterWidthDraft(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')setExteriorThickness()}} />
            <button type="button" className="plan-button plan-secondary"
              data-testid="plan-save-outer-thickness" disabled={hasFrameWork} onClick={setExteriorThickness}>
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
                onClick={() => activateTool('interior')}>
                <span aria-hidden="true">✎</span> Стена
              </button>
              <button type="button" data-testid="plan-tool-point"
                className={tool==='point'?'plan-mode-active':''}
                onClick={() => activateTool('point')}>
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
                onClick={() => activateTool('split')}>
                <span>✂</span> Разделить
              </button>
              <button type="button" data-testid="plan-tool-erase"
                className={tool==='erase'?'plan-mode-active':''}
                onClick={() => activateTool('erase')}>
                <span>⌫</span> Удалить
              </button>
              <button type="button" data-testid="plan-tool-select"
                className={tool==='select'?'plan-mode-active':''}
                onClick={() => activateTool('select')}>
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
              <p className="plan-muted">Перемещайте стену мышью, стрелками клавиатуры или вводите точные размеры. Сдвиг перемещает связанные узлы; некорректное соединение блокируется.</p>
              <div className="plan-nudge-actions" role="group" aria-label="Сдвинуть выбранную стену">
                <button type="button" className="plan-button plan-secondary"
                  data-testid="plan-wall-nudge-negative" onClick={()=>nudgeSelectedWall(-25)}>
                  {selectedInterior.start.xMm===selectedInterior.end.xMm?'← X':'↑ Z'} −25 мм
                </button>
                <button type="button" className="plan-button plan-secondary"
                  data-testid="plan-wall-nudge-positive" onClick={()=>nudgeSelectedWall(25)}>
                  {selectedInterior.start.xMm===selectedInterior.end.xMm?'→ X':'↓ Z'} +25 мм
                </button>
              </div>
              <p className="plan-muted">Стрелки: 25 мм · Shift + стрелка: 100 мм · Alt + стрелка: 1 мм.</p>
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
              <div className="plan-length-editor" data-testid="plan-length-editor">
                <strong>Изменить длину стены</strong>
                <label>Длина, м
                  <input type="text" data-testid="plan-length-value" value={wallLengthDraft}
                    onChange={event => setWallLengthDraft(event.target.value)} />
                </label>
                <label>Неподвижный конец
                  <select data-testid="plan-length-anchor" value={lengthFixedEnd}
                    onChange={event => setLengthFixedEnd(event.target.value as 'start'|'end')}>
                    <option value="start">Начало</option>
                    <option value="end">Конец</option>
                  </select>
                </label>
                <button className="plan-button plan-secondary" type="button"
                  data-testid="plan-save-length" onClick={saveWallLength}>Применить длину</button>
                <p className="plan-muted">Общие узлы сохраняются. Разрывы соединений и конфликты с проёмами блокируются.</p>
              </div>
              <p className="plan-guidance">Текущая длина: {preciseMetres(planDistanceMm(selectedInterior.start, selectedInterior.end))} м</p>
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
            disabled={!points.length || hasFrameWork} onClick={() => {
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
        {!plan.closed && localError && <div className="plan-error" role="alert" data-testid="plan-error">{localError}</div>}
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
          {plan.closed && <div className="plan-main-tools" role="group" aria-label="Инструменты плана">
            <button type="button" data-testid="plan-toolbar-select" aria-keyshortcuts="V" aria-pressed={tool === 'select' && !placement}
              onClick={() => activateTool('select')}>
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none"
                stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M3 2l10 7-5 1-2 4z" /></svg>
              Выбрать <kbd>V</kbd>
            </button>
            <button type="button" data-testid="plan-toolbar-wall" aria-keyshortcuts="W" aria-pressed={tool === 'interior' || tool === 'turn'}
              onClick={() => activateTool('interior')}>
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none"
                stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M2 4h12v4H6v5H2z" /></svg>
              Стена <kbd>W</kbd>
            </button>
          </div>}
          <div className="plan-mode-mark"><span className="plan-dot" /> ПЛАН / {plan.closed
              ?placementLabel ?? ({interior:'ЛОМАНАЯ СТЕНА',turn:'ПОВОРОТ 90°',point:'СВОБОДНАЯ ТОЧКА',
                split:'РАЗДЕЛЕНИЕ',erase:'УДАЛЕНИЕ ОТРЕЗКА',select:'РЕДАКТИРОВАНИЕ',
                outline:'НАРУЖНЫЙ КОНТУР',frame:'ПРОЁМЫ'}[tool])
              :'НАРУЖНЫЙ КОНТУР'}</div>
          <div className="plan-room-display-tools" role="group" aria-label="Отображение площадей">
            <button type="button" data-testid="plan-room-label-toggle"
              aria-pressed={showRoomLabels} title="Показать или скрыть площади помещений"
              onClick={()=>onShowRoomLabelsChange(!showRoomLabels)}>Площади</button>
            <button type="button" data-testid="plan-room-fill-toggle"
              aria-pressed={showRoomFill} title="Показать или скрыть цветные зоны помещений"
              onClick={()=>onShowRoomFillChange(!showRoomFill)}>Заливка</button>
          </div>
          <button type="button" className="plan-grid-toggle"
            data-testid="plan-grid-toggle" aria-pressed={gridVisible}
            title={gridVisible?'Скрыть сетку':'Показать сетку'}
            onClick={()=>setGridVisible(v=>!v)}>Сетка</button>
          <label className="plan-grid-select">Шаг стен
            <select data-testid="plan-grid-step" value={snapMm}
              onChange={event => setSnapMm(Number(event.target.value))}>
              <option value={100}>0,10 м</option><option value={250}>0,25 м</option>
              <option value={500}>0,50 м</option><option value={1000}>1,00 м</option>
            </select>
          </label>
          <div className="plan-zoom-tools">
            <button type="button" title="Уменьшить масштаб" onClick={() => zoomAt({ x: WIDTH / 2, y: HEIGHT / 2 }, 1 / 1.15)}>−</button>
            <span data-testid="plan-zoom">{Math.round(zoom*100)}%</span>
            <button type="button" title="Увеличить масштаб" onClick={() => zoomAt({ x: WIDTH / 2, y: HEIGHT / 2 }, 1.15)}>+</button>
            <button type="button" data-testid="plan-fit" title="Показать весь план" onClick={fitView}>Весь план</button>
          </div>
        </div>
        <div className="plan-canvas-wrap">
          <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="plan-canvas"
            data-testid="plan-canvas" data-grid-step-mm={snapMm} role="group" aria-label="Чертёж здания в метрах"
            data-mode={placement ? 'placement' : preview ? 'opening-drag' : tool}
            onClick={onCanvasClick} onPointerDown={pointerDown} onPointerMove={pointerMove}
            onPointerUp={pointerUp} onPointerCancel={pointerUp}
            onLostPointerCapture={event => {
              if (cancelledOpeningPointer.current === event.pointerId) cancelledOpeningPointer.current = null
              openingTools.finishDrag(event.pointerId, true)
            }}
            onPointerLeave={() => {
              setHover(null)
              setInteriorHover(null)
              openingTools.hidePlacementPreview()
            }} onWheel={wheel}>
            <defs>
              <mask id="plan-opening-cuts" maskUnits="userSpaceOnUse" x={-4} y={-4} width={WIDTH + 8} height={HEIGHT + 8}>
                <rect x={-4} y={-4} width={WIDTH + 8} height={HEIGHT + 8} fill="white" />
                {openingCuts.map(opening => {
                  const side = drawingSides.find(item => item.wallId === opening.wallId)
                  return side && <OpeningCut key={opening.id} opening={opening} side={side} xy={xy} pxPerMm={px / 1000} />
                })}
              </mask>
              <marker id="plan-frame-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#14777b" />
              </marker>
              <pattern id="plan-small-grid" x={originX} y={originY}
                width={gridMetrics.minorPx} height={gridMetrics.minorPx} patternUnits="userSpaceOnUse">
                <path d={`M ${gridMetrics.minorPx} 0 L 0 0 0 ${gridMetrics.minorPx}`}
                  fill="none" stroke="#e4ebef" strokeWidth=".75"/>
              </pattern>
              <pattern id="plan-big-grid" x={originX} y={originY}
                width={px} height={px} patternUnits="userSpaceOnUse">
                <path d={`M ${px} 0 L 0 0 0 ${px}`} fill="none" stroke="#ccd7e3" strokeWidth="1.1"/>
              </pattern>
            </defs>
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#fcfdff" />
            {gridVisible && <>
              {gridMetrics.showMinor && <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-small-grid)" pointerEvents="none" data-testid="plan-grid-small"/>}
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#plan-big-grid)" pointerEvents="none" data-testid="plan-grid-big"/>
            </>}
            <line x1={originX} y1={0} x2={originX} y2={HEIGHT}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <line x1={0} y1={originY} x2={WIDTH} y2={originY}
              stroke="#b8cadd" strokeWidth="1.8" pointerEvents="none"/>
            <text x={WIDTH-32} y={originY-14} className="plan-axis-label" textAnchor="end">+X →</text>
            <text x={originX+14} y={22} className="plan-axis-label">−Z ↑</text>
            {plan.closed && <polygon points={fill} fill="#dce7ed" fillOpacity=".32" stroke="none" pointerEvents="none"/>}
            {showRoomFill && visibleRooms.map((room,i)=>
              <g key={'room-floor-'+room.id} data-room-id={room.id}
                data-testid={'plan-room-fill-'+room.id}
                data-area-m2={formatRoomArea(room.areaM2)}>
                {room.rectangles.map((rect,j)=>{
                  const a=xy({xMm:rect.minXmm,zMm:rect.minZmm})
                  return <rect key={j} x={a.x} y={a.y}
                    width={(rect.maxXmm-rect.minXmm)*px/1000}
                    height={(rect.maxZmm-rect.minZmm)*px/1000}
                    fill={ROOM_COLORS[i%ROOM_COLORS.length]}
                    fillOpacity={selectedRoomId===room.id ? 0.30 : 0.16}
                    stroke="none"
                    pointerEvents={tool==='select'&&!placement?'all':'none'}
                    onClick={event=>{
                      if(tool!=='select'||placement)return
                      event.stopPropagation()
                      clearSelection()
                      onSelectRoom(room.id)
                    }}/>
                })}
              </g>
            )}
            {exteriorWallStrips(plan).map((strip,i)=>
              <polygon key={'outer-strip-'+i} data-testid={'plan-exterior-strip-'+i}
                points={strip.map(p=>{const q=xy(p);return q.x+','+q.y}).join(' ')}
                fill="#526978" stroke="#304858" strokeWidth=".7" fillOpacity=".88" pointerEvents="none" mask="url(#plan-opening-cuts)"/>
            )}
            {edges.map(edge => {
              const a=xy(edge.from),b=xy(edge.to)
              const dx=b.x-a.x,dy=b.y-a.y
              const length=Math.hypot(dx,dy)
              const norm={x:-dy/length,y:dx/length}
              const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
              // Winding, not the bounding-box centre, determines the outside of concave walls.
              const outside=plan.closed
                ? exteriorDimensionNormal(points,edge.index)
                : { x: norm.x, y: norm.y }
              const labelX=center.x+outside.x*49, labelY=center.y+outside.y*49
              const dimensionVisible=!plan.closed || length>=90
              const rotation=Math.abs(dx)<Math.abs(dy)?-90:0
              const label=meters(planDistanceMm(edge.from,edge.to))+' м'
              const hasOpeningDimensions = annotatedSide && !('thicknessMm' in annotatedSide) &&
                ((edge.from.xMm === edge.to.xMm && annotatedSide.start.xMm === annotatedSide.end.xMm &&
                  edge.from.xMm === annotatedSide.start.xMm) ||
                 (edge.from.zMm === edge.to.zMm && annotatedSide.start.zMm === annotatedSide.end.zMm &&
                  edge.from.zMm === annotatedSide.start.zMm))
              return <g key={edge.index} pointerEvents="none">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plan-wall-line" style={{strokeWidth:plan.closed?2.5:8}} mask="url(#plan-opening-cuts)" />
                {!hasOpeningDimensions && dimensionVisible && <>
                <line x1={a.x+outside.x*32} y1={a.y+outside.y*32}
                  x2={b.x+outside.x*32} y2={b.y+outside.y*32} className="plan-dimension-line"/>
                {plan.closed && <>
                  <line x1={a.x+outside.x*8} y1={a.y+outside.y*8}
                    x2={a.x+outside.x*39} y2={a.y+outside.y*39} className="plan-dimension-witness"/>
                  <line x1={b.x+outside.x*8} y1={b.y+outside.y*8}
                    x2={b.x+outside.x*39} y2={b.y+outside.y*39} className="plan-dimension-witness"/>
                </>}
                <g data-testid={'plan-outer-dimension-'+edge.index}
                  transform={`translate(${labelX} ${labelY}) rotate(${rotation})`}>
                  <rect x={-40} y={-11} width={80} height={22} rx={3} className="plan-dimension-box"/>
                  <text y={5} textAnchor="middle" className="plan-dimension-text">{label}</text>
                </g>
                </>}
              </g>
            })}
            {openingInputActive && frameSides.filter(side => !('thicknessMm' in side)).map(side => {
              const start = xy(side.start), end = xy(side.end)
              return <line key={side.wallId} className="plan-host-target"
                data-testid={'plan-host-' + side.wallId} data-selected={selectedWall?.wallId === side.wallId}
                role={placement ? undefined : 'button'} tabIndex={placement ? undefined : 0}
                aria-label={'Выбрать стену ' + side.label}
                x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (tool === 'select') selectHost(side, planSideLength(side) / 2)
                  else setFramePick({ wallId: side.wallId, offsetMm: snap(planSideLength(side) / 2) })
                }} />
            })}
            {openingInputActive && selectedWall && !('thicknessMm' in selectedWall) && (() => {
              const a = xy(selectedWall.start), b = xy(selectedWall.end)
              return <line className="plan-host-selection" mask="url(#plan-opening-cuts)"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y} pointerEvents="none" />
            })()}
            {tool === 'frame' && frameSides.map(side => {
              const length = planDistanceMm(side.start, side.end)
              const start = xy(planSidePoint(side, length * 0.06))
              const end = xy(planSidePoint(side, length * 0.2))
              return <line key={side.wallId} x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                stroke="#14777b" strokeWidth={2} markerEnd="url(#plan-frame-arrow)" pointerEvents="none" />
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
              const active = (selectedInteriorId === w.id || selectedWall?.wallId === 'partition-' + w.id) && tool === 'select'
              const label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
              return <g key={w.id} data-testid={'plan-internal-wall-' + w.id}
                onClick={e=>{
                  if(ignoreClick.current){ignoreClick.current=false;e.stopPropagation();return}
                  if (tool === 'select' && !placement) {
                    e.stopPropagation()
                    const transform = svgRef.current?.getScreenCTM()
                    if (transform) {
                      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(transform.inverse())
                      selectInteriorWall(w, canvasWorldPoint(point))
                    }
                  }
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
                  stroke={active ? '#087b95' : '#677e8f'}
                  strokeWidth={w.thicknessMm * px / 1000}
                  strokeLinecap="butt" pointerEvents="none" mask="url(#plan-opening-cuts)"/>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent" strokeWidth={Math.max(18,w.thicknessMm * px / 1000)}
                  pointerEvents="stroke" onPointerDown={e=>beginWallDrag(e,w)}
                  role={tool === 'select' && !placement ? 'button' : undefined}
                  tabIndex={tool === 'select' && !placement ? 0 : undefined}
                  aria-label={'Выбрать перегородку ' + w.id}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    selectInteriorWall(w, { xMm: (w.start.xMm + w.end.xMm) / 2, zMm: (w.start.zMm + w.end.zMm) / 2 })
                  }} className="plan-interior-hit"/>
                {annotatedSide?.wallId !== 'partition-' + w.id &&
                  <text x={label.x + (a.x === b.x ? 18 : 0)}
                  y={label.y + (a.y === b.y ? -15 : 0)}
                  textAnchor="middle" className="plan-inner-label" pointerEvents="none">
                  {meters(planDistanceMm(w.start,w.end))} м
                </text>}
              </g>
            })}
            {showRoomLabels && visibleRooms.map(room=>{
              const pos=xy(room.center)
              const selected=room.id===selectedRoomId
              const density=roomLabelKind(room,px)
              return <g key={'room-label-'+room.id}
                data-label-density={density}
                data-testid={'plan-room-label-'+room.id}
                data-area-m2={formatRoomArea(room.areaM2)}
                className={'plan-room-label'+(selected?' plan-room-selected':'')}
                role={tool==='select'&&!placement?'button':undefined}
                tabIndex={tool==='select'&&!placement?0:undefined}
                pointerEvents={tool==='select'&&!placement?'visiblePainted':'none'}
                onClick={event=>{
                  if(tool!=='select'||placement)return
                  event.stopPropagation();clearSelection();onSelectRoom(room.id)
                }}
                onKeyDown={event=>{
                  if(tool!=='select'||(event.key!=='Enter'&&event.key!==' '))return
                  event.preventDefault();event.stopPropagation()
                  clearSelection();onSelectRoom(room.id)
                }}>
                <title>{room.label}: {formatRoomArea(room.areaM2)} м²</title>
                {density==='marker'
                  ? <circle cx={pos.x} cy={pos.y} r={selected?10:7}
                      className="plan-room-mini-marker"/>
                  : <>
                    <rect x={pos.x-(density==='full'?58:41)}
                      y={pos.y-(density==='full'?22:14)}
                      width={density==='full'?116:82} height={density==='full'?44:28}
                      rx={5} className="plan-room-label-background"/>
                    {density==='full' && <text x={pos.x} y={pos.y-6} textAnchor="middle"
                      className="plan-room-name">{room.label}</text>}
                    <text x={pos.x} y={pos.y+(density==='full'?12:5)} textAnchor="middle"
                      className="plan-room-area">{formatRoomArea(room.areaM2)} м²</text>
                  </>}
              </g>
            })}
            {shownOpenings.map(opening => {
              const side = drawingSides.find(item => item.wallId === opening.wallId)
              if (!side) return null
              const moving = !placement && preview?.opening.id === opening.id
              if (moving && !preview.error) return null
              return <PlanOpeningSymbol key={opening.id} opening={opening} side={side} xy={xy} pxPerMm={px / 1000}
                selected={openingInputActive && selectedOpening?.id === opening.id && !moving}
                muted={moving}
                conflict={frameIssueIds.includes(opening.id)}
                onSelect={openingInputActive && !placement && !moving ? event => {
                  if (event?.shiftKey) return
                  event?.stopPropagation()
                  if (tool === 'frame') setFramePick({ opening })
                  else selectOpening(opening)
                } : undefined}
                onDrag={openingInputActive && !placement && !moving ? event => beginOpeningDrag(event, opening) : undefined} />
            })}
            {preview && annotatedSide && <PlanOpeningSymbol opening={preview.opening} side={annotatedSide}
              xy={xy} pxPerMm={px / 1000} preview invalid={!!preview.error} />}
            {annotatedOpening && annotatedSide && <PlanOpeningDimensions key={annotatedOpening.id}
              opening={annotatedOpening} side={annotatedSide} xy={xy} pxPerMm={px / 1000}
              interactive={!preview && !placement && tool === 'select'}
              onChange={(field, valueMm) => field === 'width'
                ? (annotatedOpening.widthMm === valueMm || openingTools.save({ ...annotatedOpening, widthMm: valueMm }))
                : openingTools.move(annotatedOpening, field === 'start' ? valueMm :
                  planSideLength(annotatedSide) - annotatedOpening.widthMm - valueMm)} />}
            {clearances && (['negative','positive'] as const).map(side => {
              const entry=clearances[side]
              if (!entry) return null
              const vertical=clearances.axis==='x'
              const row=clearances.scanMm
              const start=vertical
                ? xy({xMm:entry.referenceFaceMm ?? entry.referenceMm,zMm:row})
                : xy({xMm:row,zMm:entry.referenceFaceMm ?? entry.referenceMm})
              const end=vertical
                ? xy({xMm:entry.wallFaceMm ?? clearances.coordinateMm,zMm:row})
                : xy({xMm:row,zMm:entry.wallFaceMm ?? clearances.coordinateMm})
              const centerX=(start.x+end.x)/2
              const centerY=(start.y+end.y)/2
              const labelX=vertical?centerX:centerX+25
              const labelY=vertical?centerY-22:centerY
              const dimensionLabel = plan.frame?.partitions
                ? (entry.distanceMm / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
                : meters(entry.distanceMm)
              const currentlyEditing=dimensionEdit?.side===side
              return <g key={side} data-testid={'plan-clearance-'+side}>
                <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                  stroke="#1b97a6" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none"/>
                <circle cx={start.x} cy={start.y} r={3} fill="#1b97a6" pointerEvents="none"/>
                <circle cx={end.x} cy={end.y} r={3} fill="#1b97a6" pointerEvents="none"/>
                {!currentlyEditing && <g className="plan-click-dimension" role="button" tabIndex={0}
                  onClick={event=>{
                    event.stopPropagation()
                    setDimensionEdit({side,value:dimensionLabel})
                  }}
                  onKeyDown={event=>{
                    if(event.key==='Enter' || event.key===' ') {
                      event.preventDefault()
                      setDimensionEdit({side,value:dimensionLabel})
                    }
                  }}>
                  <rect x={labelX-47} y={labelY-17} rx={6} width={94} height={30}
                    fill="#fff" stroke="#72abb6" strokeWidth={1.5}/>
                  <text x={labelX} y={labelY+3} textAnchor="middle"
                    fill="#176f81" fontWeight={750} fontSize={13} pointerEvents="none">
                    {dimensionLabel} м
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
            {plan.closed && (tool === 'interior' || tool === 'turn') && interiorStart && (
              <g pointerEvents="none" className="plan-wall-draft" data-testid="plan-wall-draft"
                data-invalid={!!interiorDraft?.error}>
                {interiorDraft && <>
                  <line className="plan-wall-draft-fill" x1={xy(interiorDraft.start).x} y1={xy(interiorDraft.start).y}
                    x2={xy(interiorDraft.end).x} y2={xy(interiorDraft.end).y}
                    strokeWidth={Math.max(2, interiorDraft.thickness * px / 1000)} />
                  <line className="plan-wall-draft-axis" x1={xy(interiorDraft.start).x} y1={xy(interiorDraft.start).y}
                    x2={xy(interiorDraft.end).x} y2={xy(interiorDraft.end).y} />
                  <rect x={xy(interiorDraft.end).x - 5} y={xy(interiorDraft.end).y - 5} width={10} height={10} rx={1} />
                  <text x={(xy(interiorDraft.start).x + xy(interiorDraft.end).x) / 2 + 12}
                    y={(xy(interiorDraft.start).y + xy(interiorDraft.end).y) / 2 - 15} textAnchor="middle">
                    {meters(planDistanceMm(interiorDraft.start, interiorDraft.end))} м
                  </text>
                </>}
                <circle cx={xy(interiorStart).x} cy={xy(interiorStart).y} r={7}/>
              </g>
            )}
            {activeNodes.map(node=>{
              const loc=xy(node)
              return <g key={'graph-'+node.id} data-testid={'plan-graph-node-'+node.id}
                className="plan-graph-node" data-idle={tool==='select' && selectedGraphNodeId!==node.id && !placement}
                onClick={e=>{
                  if(ignoreClick.current){ignoreClick.current=false;e.stopPropagation();return}
                  if (placement) return
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
                className={'plan-vertex'+(plan.closed && selectedIndex!==i ? ' plan-vertex-idle' : '')} onClick={event => {if (!placement) { event.stopPropagation(); selectPoint(i) }}}>
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
          {showWallActions && <PlanWallActions side={selectedWall}
            anchor={xy(planSidePoint(selectedWall, wallPick.offsetMm))}
            svgRef={svgRef} onAdd={openingTools.startPlacement} />}
          {(placementLabel || preview?.error || openingTools.message || interiorDraft?.error || (plan.closed && localError)) &&
            <div className="plan-canvas-feedback" data-testid="plan-canvas-feedback"
              data-error={!!(preview?.error || interiorDraft?.error || (plan.closed && localError))} role="status">
              {preview?.error || openingTools.message || interiorDraft?.error || (plan.closed && localError) ||
                placementLabel + ' · Клик или Enter — поставить · Esc — отменить'}
              {placement && <button type="button" onClick={cancelOpeningEdit} aria-label="Отменить размещение">×</button>}
            </div>}
          <div className="plan-canvas-hint">{gridVisible && !gridMetrics.showMinor
            ? 'Привязка '+snapMm+' мм · мелкая сетка скрыта на этом масштабе · '
            : ''}{plan.closed
            ?(tool==='interior'||tool==='turn'
              ?(interiorStart ? 'Клик — следующий участок · Enter — закончить · Esc — выйти'
                : 'Укажите начало стены на сетке или существующей стене')
              :tool==='point'?'ЛКМ — свободная точка или узел на стене'
              :tool==='split'?'Нажмите отрезок в месте разделения'
              :tool==='erase'?'Нажмите отрезок для удаления · Undo доступен'
              :tool==='frame'?'Нажмите на стену или существующий проём'
              :placement?'Клик по выбранной стене · Alt — точная привязка'
              :selectedOpening?'Тяните проём вдоль стены · кликните размер для точного ввода'
              :'Выберите стену, чтобы добавить проём · Shift + перетаскивание — панорама')
            :'ЛКМ — следующая точка · Shift+drag — сдвиг · колесо — масштаб'}</div>
        </div>
        <div className="plan-bottom">
          <span className="plan-bottom-state"><span className="plan-dot" />{plan.closed ? 'Контур замкнут' : 'Черновик контура'}</span>
          <div className="plan-measure-panel" data-testid="plan-stats">
            <div><span>Габариты</span><strong data-testid="plan-dimensions">{meters(bounds.maxX-bounds.minX)} × {meters(bounds.maxZ-bounds.minZ)} м</strong></div>
            <div><span>{plan.closed?'Периметр':'Начерчено'}</span><strong data-testid="plan-perimeter">{meters(totalLength)} м</strong></div>
            <div><span>Площадь контура</span><strong data-testid="plan-area">{plan.closed?planAreaM2(plan).toLocaleString('ru-RU',{maximumFractionDigits:2}):'—'} м²</strong></div>
            <div><span>Чистая площадь / помещения</span>
              <strong data-testid="plan-room-total" data-area-m2={formatRoomArea(totalRoomAreaM2(visibleRooms))}>
                {plan.closed?formatRoomArea(totalRoomAreaM2(visibleRooms))+' м² · '+visibleRooms.length:'—'}
              </strong>
            </div>
          </div>
          <span className="plan-bottom-right">Размеры в метрах · точность 1 мм</span>
        </div>
      </main>
    </div>
  )
}
