
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { generateTimberGeometry, boxCenterWorld, mmToMeters, type TimberElement } from '../core/timber'

interface SceneViewProps {
  elements: TimberElement[]
  selectedId: string | null
  showEdges?: boolean
  onSelect?: (id: string) => void
}

interface MeshEntry {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  marker: THREE.Mesh
  edges: THREE.LineSegments
  edgesMat: THREE.LineBasicMaterial
}

export function SceneView({ elements, selectedId, showEdges = true, onSelect }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const entriesRef = useRef<Map<string, MeshEntry>>(new Map())
  const resetRef = useRef<(() => void) | null>(null)
  const elementsRef = useRef<TimberElement[]>(elements)
  const selectedRef = useRef<string | null>(selectedId)
  const showEdgesRef = useRef<boolean>(showEdges)

  useEffect(() => { elementsRef.current = elements }, [elements])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { showEdgesRef.current = showEdges }, [showEdges])

  // mount scene once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

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
    const axes = new THREE.AxesHelper(2)
    scene.add(axes)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.6)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onClick = (event: MouseEvent) => {
      const cam = cameraRef.current
      const ren = rendererRef.current
      if (!cam || !ren) return
      const rect = ren.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, cam)
      const meshes = Array.from(entriesRef.current.values()).map((e) => e.mesh)
      const hits = raycaster.intersectObjects(meshes)
      if (hits.length > 0) {
        const hitMesh = hits[0].object as THREE.Mesh
        for (const [id, e] of entriesRef.current) {
          if (e.mesh === hitMesh) {
            onSelect?.(id)
            break
          }
        }
      }
    }
    renderer.domElement.addEventListener('click', onClick)

    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
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
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    resetRef.current = () => {
      const els = elementsRef.current
      const fb = new THREE.Box3()
      for (const el of els) {
        const spec = generateTimberGeometry(el)
        const c = boxCenterWorld(el)
        const center2 = new THREE.Vector3(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
        const hx = mmToMeters(spec.size.x) / 2
        const hy = mmToMeters(spec.size.y) / 2
        const hz = mmToMeters(spec.size.z) / 2
        fb.expandByPoint(new THREE.Vector3(center2.x - hx, center2.y - hy, center2.z - hz))
        fb.expandByPoint(new THREE.Vector3(center2.x + hx, center2.y + hy, center2.z + hz))
      }
      const ctr = new THREE.Vector3()
      fb.getCenter(ctr)
      const sz = new THREE.Vector3()
      fb.getSize(sz)
      const md = Math.max(sz.x, sz.y, sz.z)
      const cd = md * 1.5 + 2
      camera.position.copy(ctr.clone().add(new THREE.Vector3(cd * 0.6, cd * 0.5, cd * 0.6)))
      controls.target.copy(ctr)
      controls.update()
    }

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      // dispose all entries
      entriesRef.current.forEach((e) => {
        e.mesh.geometry.dispose()
        e.material.dispose()
        e.marker.geometry.dispose()
        ;(e.marker.material as THREE.Material).dispose()
        e.edges.geometry.dispose()
        e.edgesMat.dispose()
      })
      entriesRef.current.clear()
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

  // reconcile meshes with elements
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const entries = entriesRef.current

    // remove stale
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

    // add/update
    for (const el of elements) {
      let entry = entries.get(el.id)
      if (!entry) {
        const spec = generateTimberGeometry(el)
        const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
        const mat = new THREE.MeshStandardMaterial({ color: 0xb8864e })
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
        marker.position.set(mmToMeters(el.position.x), mmToMeters(el.position.y), mmToMeters(el.position.z))
        marker.visible = selectedRef.current === el.id
        scene.add(marker)

        entry = { mesh, material: mat, marker, edges, edgesMat }
        entries.set(el.id, entry)
      }
      // update geometry
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

      entry.marker.position.set(mmToMeters(el.position.x), mmToMeters(el.position.y), mmToMeters(el.position.z))
    }

    // highlight + edges visibility
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

    // camera only on first load (when no entries existed before). We'll center on first reconcile only.
    // To avoid camera jump on param change, only center if not yet centered.
    // We track via a flag on entriesRef? Use a simple module-level-ish ref via containerRef? Use a ref.
  }, [elements])

  // camera centering on first load
  const centeredRef = useRef(false)
  useEffect(() => {
    if (centeredRef.current) return
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const els = elementsRef.current
    const fb = new THREE.Box3()
    for (const el of els) {
      const spec = generateTimberGeometry(el)
      const c = boxCenterWorld(el)
      const center2 = new THREE.Vector3(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
      const hx = mmToMeters(spec.size.x) / 2
      const hy = mmToMeters(spec.size.y) / 2
      const hz = mmToMeters(spec.size.z) / 2
      fb.expandByPoint(new THREE.Vector3(center2.x - hx, center2.y - hy, center2.z - hz))
      fb.expandByPoint(new THREE.Vector3(center2.x + hx, center2.y + hy, center2.z + hz))
    }
    const ctr = new THREE.Vector3()
    fb.getCenter(ctr)
    const sz = new THREE.Vector3()
    fb.getSize(sz)
    const md = Math.max(sz.x, sz.y, sz.z)
    const cd = md * 1.5 + 2
    camera.position.copy(ctr.clone().add(new THREE.Vector3(cd * 0.6, cd * 0.5, cd * 0.6)))
    controls.target.copy(ctr)
    controls.update()
    centeredRef.current = true
  }, [elements])

  // highlight + edges visibility updates
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

  return (
    <div className="viewport" ref={containerRef}>
      <button type="button" className="reset-view" onClick={() => resetRef.current?.()}>
        Сбросить вид
      </button>
    </div>
  )
}
