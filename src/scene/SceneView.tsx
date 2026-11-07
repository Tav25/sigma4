
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { generateTimberGeometry, boxCenterWorld, mmToMeters, type TimberElement } from '../core/timber'
import { getWindowPositionBounds } from '../core/window'
import type { SceneOpening3D } from './project-to-scene'
import type { FloorRoom } from '../core/rooms'
import { makeRoomOverlayGroup,disposeRoomOverlayGroup } from './room-overlay'
import { openingLocalToWorld, openingWorldToLocalU, openingYaw } from './opening-geometry'
import { calculateWorldBounds } from './view-bounds'
import type { DimensionLayout } from './dimension-model'
import { makeDimensionGroup, makeOriginGroup, disposeDimensionGroup, orientDimensionNumbers } from './DimensionOverlay'
import type { OpeningMarker } from './project-to-scene'

interface SceneViewProps {
  elements: TimberElement[]
  selectedId: string | null
  showEdges?: boolean
  rooms:FloorRoom[]
  showRoomLabels:boolean
  showRoomFill:boolean
  selectedRoomId:string|null
  openings: SceneOpening3D[]
  markers: OpeningMarker[]
  wallCount: number
  dimensions: DimensionLayout
  showDimensions: boolean
  selectedWindowId: string | null
  onWindowSelect?: (id: string | null) => void
  onWindowDragStart?: (id: string) => boolean
  onWindowDragPreview?: (id: string, x: number) => boolean
  onWindowDragEnd?: (id: string, save: boolean) => void
  onSelect?: (id: string | null) => void
}

interface MeshEntry {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  marker: THREE.Mesh
  edges: THREE.LineSegments
  edgesMat: THREE.LineBasicMaterial
}

interface WindowEntry {
  hitPlane: THREE.Mesh
  outline: THREE.Line
}

export function SceneView({
  elements, selectedId, showEdges = true,
  rooms,showRoomLabels,showRoomFill,selectedRoomId,
  openings, markers, wallCount, dimensions, showDimensions, selectedWindowId, onWindowSelect,
  onWindowDragStart, onWindowDragPreview, onWindowDragEnd, onSelect,
}: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const entriesRef = useRef<Map<string, MeshEntry>>(new Map())
  const windowEntriesRef = useRef<Map<string, WindowEntry>>(new Map())
  const openingMarkerEntriesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const dimensionGroupRef = useRef<THREE.Group | null>(null)
  const roomGroupRef = useRef<THREE.Group | null>(null)
  const originGroupRef = useRef<THREE.Group | null>(null)
  const dimensionsRef = useRef(dimensions)
  const showDimensionsRef = useRef(showDimensions)
  const resetRef = useRef<(() => void) | null>(null)
  const elementsRef = useRef<TimberElement[]>(elements)
  const selectedRef = useRef<string | null>(selectedId)
  const showEdgesRef = useRef<boolean>(showEdges)
  const openingsRef = useRef<SceneOpening3D[]>(openings)
  const windowSelectedRef = useRef<string | null>(selectedWindowId)
  const hasCenteredRef = useRef<boolean>(false)
  const wallCountRef = useRef(wallCount)
  wallCountRef.current = wallCount

  const draggingRef = useRef<{ id: string; startX: number; startPointer: number; previewedX: number } | null>(null)
  const dragCallbacksRef = useRef({ onWindowDragStart, onWindowDragPreview, onWindowDragEnd })
  dragCallbacksRef.current = { onWindowDragStart, onWindowDragPreview, onWindowDragEnd }
  const rafRef = useRef<number | null>(null)
  const pendingXRef = useRef<{ id: string; x: number } | null>(null)
  const hoveredWindowRef = useRef<string | null>(null)
  const lastDraggedRef = useRef<string | null>(null)
  const [cursor, setCursor] = useState('default')

  useEffect(() => { elementsRef.current = elements }, [elements])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { showEdgesRef.current = showEdges }, [showEdges])
  useEffect(() => { openingsRef.current = openings }, [openings])
  useEffect(() => { windowSelectedRef.current = selectedWindowId }, [selectedWindowId])
  dimensionsRef.current = dimensions
  showDimensionsRef.current = showDimensions

  // mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // React StrictMode remounts the scene in development. Its new camera must be fitted again.
    hasCenteredRef.current = false

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf2f2f2)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000)
    cameraRef.current = camera
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controlsRef.current = controls

    const grid = new THREE.GridHelper(40, 40, 0x888888, 0xcccccc)
    scene.add(grid)
    // Origin marker is at the immutable world (0,0,0), never at the camera
    // target or the visual centre of the first wall.
    const originGroup = makeOriginGroup()
    originGroupRef.current = originGroup
    scene.add(originGroup)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.6)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    /** Intersect the selected opening's OWN wall plane in local U metres. */
    const getWallIntersection = (event: PointerEvent | MouseEvent, id: string): number | null => {
      const opening = openingsRef.current.find(o => o.id === id)
      const cam = cameraRef.current
      const ren = rendererRef.current
      if (!opening || !cam || !ren) return null
      const rect = ren.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, cam)
      const normal = opening.wallOrientation === 'z'
        ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
      const planePoint = opening.wallOrigin
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(
        mmToMeters(planePoint.x), mmToMeters(planePoint.y), mmToMeters(planePoint.z),
      ))
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
      if (!hit) return null
      return openingWorldToLocalU(opening, hit)
    }

    const clampX = (id: string, x: number, width: number) => {
      const win = openingsRef.current.find(o => o.id === id)
      if (!win) return x
      const others = openingsRef.current.filter(o => o.wallId === win.wallId && o.id !== id)
      const result = getWindowPositionBounds(win.wallLengthMm, {
        positionXmm: x, widthMm: width,
      }, others)
      if (win.type === 'garage-door') {
        const margin = ((win.garage?.jackStudsPerSide ?? 2) + 2) * 45
        const minX = Math.max(result.minX, margin)
        const maxX = Math.min(result.maxX, win.wallLengthMm - width - margin)
        return Math.max(minX, Math.min(maxX, x))
      }
      return Math.max(result.minX, Math.min(result.maxX, x))
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const cam = cameraRef.current
      const ren = rendererRef.current
      if (!cam || !ren) return
      const rect = ren.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, cam)

      // check window hit planes
      const windowHits = raycaster.intersectObjects(
        Array.from(windowEntriesRef.current.values()).map((w) => w.hitPlane), false
      )
      if (windowHits.length > 0) {
        const hitPlane = windowHits[0].object as THREE.Mesh
        let hitId: string | null = null
        for (const [id, w] of windowEntriesRef.current) {
          if (w.hitPlane === hitPlane) { hitId = id; break }
        }
        if (hitId) {
          const win = openingsRef.current.find((o) => o.id === hitId)
          if (win) {
            const px = getWallIntersection(event, hitId)
            if (px === null) return
            if (dragCallbacksRef.current.onWindowDragStart?.(hitId) === false) {
              onWindowSelect?.(hitId)
              return
            }
            draggingRef.current = { id: hitId, startX: win.positionXmm, startPointer: px, previewedX: win.positionXmm }
            windowSelectedRef.current = hitId
            lastDraggedRef.current = hitId
            if (onWindowSelect) onWindowSelect(hitId)
            if (controlsRef.current) controlsRef.current.enabled = false
            setCursor('grabbing')
            ren.domElement.setPointerCapture(event.pointerId)
            event.preventDefault()
            return
          }
        }
      }

      // wood selection
      const meshes = Array.from(entriesRef.current.values()).map((e) => e.mesh)
      const woodHits = raycaster.intersectObjects(meshes)
      if (woodHits.length > 0) {
        const hitMesh = woodHits[0].object as THREE.Mesh
        for (const [id, e] of entriesRef.current) {
          if (e.mesh === hitMesh) { onSelect?.(id); break }
        }
      }
    }

    const flushPreview = () => {
      const pending = pendingXRef.current
      pendingXRef.current = null
      const drag = draggingRef.current
      if (!pending || !drag || pending.id !== drag.id || pending.x === drag.previewedX) return
      if (dragCallbacksRef.current.onWindowDragPreview?.(pending.id, pending.x)) {
        drag.previewedX = pending.x
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const cam = cameraRef.current
      const ren = rendererRef.current
      if (!cam || !ren) return
      const rect = ren.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      if (draggingRef.current) {
        const px = getWallIntersection(event, draggingRef.current.id)
        if (px === null) return
        const drag = draggingRef.current
        const win = openingsRef.current.find((o) => o.id === drag.id)
        if (!win) return
        const deltaMm = (px - drag.startPointer) * 1000
        let snapped = deltaMm
        if (!event.shiftKey) snapped = Math.round(deltaMm / 50) * 50
        let newX = drag.startX + snapped
        newX = clampX(drag.id, newX, win.widthMm)
        pendingXRef.current = { id: drag.id, x: newX }
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            flushPreview()
          })
        }
        return
      }

      // hover
      raycaster.setFromCamera(pointer, cam)
      const hits = raycaster.intersectObjects(Array.from(windowEntriesRef.current.values()).map((w) => w.hitPlane), false)
      let newHovered: string | null = null
      if (hits.length > 0) {
        const hp = hits[0].object as THREE.Mesh
        for (const [id, w] of windowEntriesRef.current) {
          if (w.hitPlane === hp) { newHovered = id; break }
        }
      }
      if (newHovered !== hoveredWindowRef.current) {
        hoveredWindowRef.current = newHovered
        setCursor(newHovered ? 'move' : 'default')
        // update outline visibility
        windowEntriesRef.current.forEach((w, id) => {
          const sel = id === windowSelectedRef.current
          const hov = id === newHovered
          w.outline.visible = sel || hov || draggingRef.current?.id === id
        })
      }
    }

    const stopDrag = (save: boolean) => {
      const drag = draggingRef.current
      if (!drag) return
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (save) flushPreview()
      pendingXRef.current = null
      draggingRef.current = null
      // One mouse drag = one undo step, rather than an entry per frame.
      dragCallbacksRef.current.onWindowDragEnd?.(drag.id, save && drag.previewedX !== drag.startX)
      if (controlsRef.current) controlsRef.current.enabled = true
      setCursor(save && hoveredWindowRef.current ? 'move' : 'default')
    }

    const onPointerUp = (event: PointerEvent) => {
      const ren = rendererRef.current
      if (ren) try { ren.domElement.releasePointerCapture(event.pointerId) } catch {}
      stopDrag(true)
    }

    const onPointerCancel = () => stopDrag(false)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopDrag(false)
    }

    const onBlur = () => stopDrag(false)

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)

    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      if (dimensionGroupRef.current) {
        orientDimensionNumbers(dimensionGroupRef.current, camera)
      }
      if (roomGroupRef.current) {
        orientDimensionNumbers(roomGroupRef.current, camera)
      }
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      // Retry initial centering after the viewport has a measured size.
      if (!hasCenteredRef.current && elementsRef.current.length > 0) {
        resetRef.current?.()
      }
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Frame actual 3D rotated geometry from the canonical JSON projection.
    const frameView = () => {
      const els = elementsRef.current
      if (!els.length || !container.clientWidth || !container.clientHeight) return
      const bounds = calculateWorldBounds(els)
      if (bounds.isEmpty()) return
      // Dimension labels and arrows must remain in view when enabled.
      if (showDimensionsRef.current) {
        for (const dim of dimensionsRef.current.lines) {
          for (const p of [dim.dimensionFrom, dim.dimensionTo]) {
            bounds.expandByPoint(new THREE.Vector3(
              mmToMeters(p.x), mmToMeters(p.y), mmToMeters(p.z),
            ))
          }
        }
        bounds.expandByScalar(0.7)
      }
      const ctr = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z) * 1.5 + 2
      camera.fov = 60
      camera.far = 1000
      camera.up.set(0, 1, 0)
      const sign = wallCountRef.current > 1 ? -1 : 1
      camera.position.copy(ctr.clone().add(new THREE.Vector3(
        sign * radius * 0.6, radius * 0.5, sign * radius * 0.6,
      )))
      camera.updateProjectionMatrix()
      camera.lookAt(ctr)
      controls.target.copy(ctr)
      controls.update()
      hasCenteredRef.current = true
    }
    resetRef.current = () => frameView()

    return () => {
      if (draggingRef.current) stopDrag(false)
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      controls.dispose()
      entriesRef.current.forEach((e) => {
        e.mesh.geometry.dispose()
        e.material.dispose()
        e.marker.geometry.dispose()
        ;(e.marker.material as THREE.Material).dispose()
        e.edges.geometry.dispose()
        e.edgesMat.dispose()
      })
      entriesRef.current.clear()
      windowEntriesRef.current.forEach((w) => {
        w.hitPlane.geometry.dispose()
        ;(w.hitPlane.material as THREE.Material).dispose()
        w.outline.geometry.dispose()
        ;(w.outline.material as THREE.Material).dispose()
      })
      windowEntriesRef.current.clear()
      openingMarkerEntriesRef.current.forEach(mesh => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      openingMarkerEntriesRef.current.clear()
      if (roomGroupRef.current) {
        scene.remove(roomGroupRef.current)
        disposeRoomOverlayGroup(roomGroupRef.current)
        roomGroupRef.current=null
      }
      if (dimensionGroupRef.current) {
        scene.remove(dimensionGroupRef.current)
        disposeDimensionGroup(dimensionGroupRef.current)
        dimensionGroupRef.current = null
      }
      if (originGroupRef.current) {
        scene.remove(originGroupRef.current)
        disposeDimensionGroup(originGroupRef.current)
        originGroupRef.current = null
      }
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      resetRef.current = null
    }
  }, [])

  // reconcile wood meshes
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const entries = entriesRef.current
    for (const [id, entry] of Array.from(entries.entries())) {
      if (!elements.find((e) => e.id === id)) {
        scene.remove(entry.mesh)
        scene.remove(entry.marker)
        entry.mesh.geometry.dispose()
        entry.material.dispose()
        entry.marker.geometry.dispose()
        ;(entry.marker.material as THREE.Material).dispose()
        entry.edges.geometry.dispose()
        entry.edgesMat.dispose()
        entries.delete(id)
      }
    }
    for (const el of elements) {
      let entry = entries.get(el.id)
      if (!entry) {
        const spec = generateTimberGeometry(el)
        const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
        const mat = new THREE.MeshStandardMaterial({
          color: el.role === 'garage-lintel-preview' ? 0xe0ac43 : 0xb8864e,
        })
        const mesh = new THREE.Mesh(geo, mat)
        const center = boxCenterWorld(el)
        mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
        mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
        scene.add(mesh)
        const edgesGeo = new THREE.EdgesGeometry(geo)
        const edgesMat = new THREE.LineBasicMaterial({ color: 0x2a1a0a })
        const edges = new THREE.LineSegments(edgesGeo, edgesMat)
        edges.visible = showEdgesRef.current
        mesh.add(edges)
        const markerGeo = new THREE.SphereGeometry(0.03, 16, 16)
        const markerMat = new THREE.MeshStandardMaterial({ color: 0xff3333 })
        const marker = new THREE.Mesh(markerGeo, markerMat)
        marker.position.set(mmToMeters(spec.reference.x), mmToMeters(spec.reference.y), mmToMeters(spec.reference.z))
        marker.visible = selectedRef.current === el.id
        scene.add(marker)
        entry = { mesh, material: mat, marker, edges, edgesMat }
        entries.set(el.id, entry)
      }
      const spec = generateTimberGeometry(el)
      const oldGeo = entry.mesh.geometry
      const newGeo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
      entry.mesh.geometry = newGeo
      oldGeo.dispose()
      const center = boxCenterWorld(el)
      entry.mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
      entry.mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
      const oldEdges = entry.edges.geometry
      entry.edges.geometry = new THREE.EdgesGeometry(newGeo)
      oldEdges.dispose()
      entry.marker.position.set(mmToMeters(spec.reference.x), mmToMeters(spec.reference.y), mmToMeters(spec.reference.z))
    }
    entries.forEach((e, key) => {
      e.edges.visible = showEdgesRef.current
      if (key === selectedRef.current) {
        e.material.emissive = new THREE.Color(0x3366ff)
        e.material.emissiveIntensity = 0.25
        e.marker.visible = true
        e.edgesMat.color = new THREE.Color(0x000000)
      } else {
        e.material.emissive = new THREE.Color(0x000000)
        e.material.emissiveIntensity = 0
        e.marker.visible = false
        e.edgesMat.color = new THREE.Color(0x2a1a0a)
      }
    })
    // Use the same framing as "Сбросить вид" only on initial load.
    // If the viewport has no size yet, ResizeObserver handles it later.
    if (!hasCenteredRef.current && elements.length > 0) {
      resetRef.current?.()
    }

  }, [elements])

  // A newly added/removed wall changes the scene bounds. Refit only when
  // the wall count changes, never during ordinary dragging or manual orbiting.
  useEffect(() => {
    resetRef.current?.()
  }, [wallCount])

  // Dimension lines and the world origin are render-only views of model
  // geometry. They never participate in raycasts against wooden boards.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (dimensionGroupRef.current) {
      scene.remove(dimensionGroupRef.current)
      disposeDimensionGroup(dimensionGroupRef.current)
      dimensionGroupRef.current = null
    }
    if (showDimensions) {
      const group = makeDimensionGroup(dimensions)
      dimensionGroupRef.current = group
      scene.add(group)
    }
  }, [dimensions, showDimensions])

  // Derived floor zones and engineering planar vector area labels. Never raycast these
  // objects or make them an alternative source of room geometry.
  useEffect(()=>{
    const scene=sceneRef.current
    if(!scene)return
    if(roomGroupRef.current){
      scene.remove(roomGroupRef.current)
      disposeRoomOverlayGroup(roomGroupRef.current)
      roomGroupRef.current=null
    }
    if(!rooms.length||(!showRoomLabels&&!showRoomFill))return
    const group=makeRoomOverlayGroup(rooms,{
      showLabels:showRoomLabels,showFill:showRoomFill,selectedRoomId,
    })
    scene.add(group)
    roomGroupRef.current=group
    return ()=>{
      if(roomGroupRef.current===group){
        scene.remove(group)
        disposeRoomOverlayGroup(group)
        roomGroupRef.current=null
      }
    }
  },[rooms,showRoomLabels,showRoomFill,selectedRoomId])

  // reconcile window hit planes/outlines
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const wEntries = windowEntriesRef.current
    // remove stale
    for (const [id, w] of Array.from(wEntries.entries())) {
      if (!openings.find((o) => o.id === id)) {
        scene.remove(w.hitPlane)
        scene.remove(w.outline)
        w.hitPlane.geometry.dispose()
        ;(w.hitPlane.material as THREE.Material).dispose()
        w.outline.geometry.dispose()
        ;(w.outline.material as THREE.Material).dispose()
        wEntries.delete(id)
      }
    }
    // add/update
    for (const o of openings) {
      let w = wEntries.get(o.id)
      if (!w) {
        const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        const hitPlane = new THREE.Mesh(new THREE.PlaneGeometry(o.widthMm / 1000, o.heightMm / 1000), hitMat)
        const outlineGeo = new THREE.BufferGeometry()
        const outlineMat = new THREE.LineBasicMaterial({ color: 0x00bfff })
        const outline = new THREE.Line(outlineGeo, outlineMat)
        outline.visible = o.id === windowSelectedRef.current || hoveredWindowRef.current === o.id
        scene.add(hitPlane)
        scene.add(outline)
        w = { hitPlane, outline }
        wEntries.set(o.id, w)
      }
      // Local U axis rotates into world -Z for a second-wall orientation.
      const yaw = openingYaw(o)
      const x0 = mmToMeters(o.positionXmm)
      const y0 = mmToMeters(o.sillHeightMm)
      const x1 = mmToMeters(o.positionXmm + o.widthMm)
      const y1 = mmToMeters(o.sillHeightMm + o.heightMm)
      w.hitPlane.geometry.dispose()
      w.hitPlane.geometry = new THREE.PlaneGeometry(mmToMeters(o.widthMm), mmToMeters(o.heightMm))
      const centre = openingLocalToWorld(
        o, o.positionXmm + o.widthMm / 2, o.sillHeightMm + o.heightMm / 2,
      )
      w.hitPlane.position.set(mmToMeters(centre.x), mmToMeters(centre.y), mmToMeters(centre.z))
      w.hitPlane.rotation.set(0, yaw, 0)
      const pts = [
        new THREE.Vector3(x0, y0, 0),
        new THREE.Vector3(x1, y0, 0),
        new THREE.Vector3(x1, y1, 0),
        new THREE.Vector3(x0, y1, 0),
        new THREE.Vector3(x0, y0, 0),
      ]
      w.outline.geometry.dispose()
      w.outline.geometry = new THREE.BufferGeometry().setFromPoints(pts)
      w.outline.position.set(
        mmToMeters(o.wallOrigin.x), mmToMeters(o.wallOrigin.y), mmToMeters(o.wallOrigin.z),
      )
      w.outline.rotation.set(0, yaw, 0)
      const sel = o.id === windowSelectedRef.current
      const hov = hoveredWindowRef.current === o.id
      w.outline.visible = sel || hov
    }
  }, [openings])

  // Small, non-interactive opening markers derived from JSON. Do not raycast
  // against them or use them as an alternative source of opening coordinates.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const existing = openingMarkerEntriesRef.current
    const wanted = new Set(markers.map(marker => marker.openingId))
    for (const [id, mesh] of existing) {
      if (!wanted.has(id)) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        existing.delete(id)
      }
    }
    for (const marker of markers) {
      let mesh = existing.get(marker.openingId)
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, 12, 10),
          new THREE.MeshBasicMaterial({ color: marker.color }),
        )
        scene.add(mesh)
        existing.set(marker.openingId, mesh)
      }
      mesh.position.set(
        mmToMeters(marker.position.x),
        mmToMeters(marker.position.y),
        mmToMeters(marker.position.z),
      )
      mesh.visible = marker.visible
      ;(mesh.material as THREE.MeshBasicMaterial).color.set(marker.color)
    }
  }, [markers])

  // highlight wood + edges on selectedId change
  useEffect(() => {
    const entries = entriesRef.current
    entries.forEach((e, key) => {
      e.edges.visible = showEdges
      if (key === selectedId) {
        e.material.emissive = new THREE.Color(0x3366ff)
        e.material.emissiveIntensity = 0.25
        e.marker.visible = true
        e.edgesMat.color = new THREE.Color(0x000000)
      } else {
        e.material.emissive = new THREE.Color(0x000000)
        e.material.emissiveIntensity = 0
        e.marker.visible = false
        e.edgesMat.color = new THREE.Color(0x2a1a0a)
      }
    })
  }, [selectedId, showEdges])

  // update outline visibility on selectedWindow change
  useEffect(() => {
    windowEntriesRef.current.forEach((w, id) => {
      const sel = id === selectedWindowId
      const hov = id === hoveredWindowRef.current
      const dragged = id === lastDraggedRef.current
      w.outline.visible = sel || hov || dragged
    })
  }, [selectedWindowId])

  // Refitting after toggling dimensions ensures all extension lines are visible.
  useEffect(() => {
    resetRef.current?.()
  }, [showDimensions])

  // cursor style
  useEffect(() => {
    const container = containerRef.current
    if (container) container.style.cursor = cursor
  }, [cursor])

  return (
    <div className="viewport" ref={containerRef}
      data-dimension-total-x={Math.round(dimensions.overallXmm)}
      data-dimension-total-z={Math.round(dimensions.overallZmm)}
      data-dimensions-visible={showDimensions ? 'true' : 'false'}
      data-dimensions-plane="XZ"
      data-room-count={rooms.length}
      data-room-total-m2={rooms.reduce((sum,room)=>sum+room.areaM2,0).toFixed(2)}
      data-room-labels-visible={showRoomLabels?'true':'false'}
      data-room-label-style="planar-vector-dimensions"
      data-room-fill-visible={showRoomFill?'true':'false'}
      data-selected-room={selectedRoomId??''}>
      <button type="button" className="reset-view" onClick={() => resetRef.current?.()}>
        Сбросить вид
      </button>
    </div>
  )
}
