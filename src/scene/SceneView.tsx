
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { generateTimberGeometry, boxCenterWorld, mmToMeters, type TimberElement } from '../core/timber'

interface SceneViewProps {
  elements: TimberElement[]
  selectedId: string | null
  onSelect?: (id: string) => void
}

interface MeshEntry {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  marker: THREE.Mesh
}

export function SceneView({ elements, selectedId, onSelect }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const entriesRef = useRef<Map<string, MeshEntry>>(new Map())
  const sceneRef = useRef<THREE.Scene | null>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const elementsRef = useRef<TimberElement[]>(elements)
  const selectedRef = useRef<string | null>(selectedId)

  useEffect(() => { elementsRef.current = elements }, [elements])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf2f2f2)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const grid = new THREE.GridHelper(40, 40, 0x888888, 0xcccccc)
    scene.add(grid)
    const axes = new THREE.AxesHelper(2)
    scene.add(axes)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.6)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    const entries = new Map<string, MeshEntry>()
    for (const el of elements) {
      const spec = generateTimberGeometry(el)
      const geo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
      const mat = new THREE.MeshStandardMaterial({ color: 0xb8864e })
      const mesh = new THREE.Mesh(geo, mat)
      const center = boxCenterWorld(el)
      mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
      mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
      scene.add(mesh)

      const markerGeo = new THREE.SphereGeometry(0.03, 16, 16)
      const markerMat = new THREE.MeshStandardMaterial({ color: 0xff3333 })
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(mmToMeters(el.position.x), mmToMeters(el.position.y), mmToMeters(el.position.z))
      marker.visible = selectedId === el.id
      scene.add(marker)

      entries.set(el.id, { mesh, material: mat, marker })
    }
    entriesRef.current = entries

    // highlight selected
    const applyHighlight = (id: string | null) => {
      entries.forEach((e, key) => {
        if (key === id) {
          e.material.emissive = new THREE.Color(0x3366ff)
          e.material.emissiveIntensity = 0.25
          e.marker.visible = true
        } else {
          e.material.emissive = new THREE.Color(0x000000)
          e.material.emissiveIntensity = 0
          e.marker.visible = false
        }
      })
    }
    applyHighlight(selectedId)

    // camera center on whole assembly
    const allPoints: THREE.Vector3[] = []
    for (const el of elements) {
      const c = boxCenterWorld(el)
      allPoints.push(new THREE.Vector3(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z)))
    }
    const box = new THREE.Box3()
    for (const p of allPoints) box.expandByPoint(p)
    // expand by half-extents approx: use element boxes
    const fullBox = new THREE.Box3()
    for (const el of elements) {
      const spec = generateTimberGeometry(el)
      const c = boxCenterWorld(el)
      const center = new THREE.Vector3(mmToMeters(c.x), mmToMeters(c.y), mmToMeters(c.z))
      const hx = mmToMeters(spec.size.x) / 2
      const hy = mmToMeters(spec.size.y) / 2
      const hz = mmToMeters(spec.size.z) / 2
      fullBox.expandByPoint(new THREE.Vector3(center.x - hx, center.y - hy, center.z - hz))
      fullBox.expandByPoint(new THREE.Vector3(center.x + hx, center.y + hy, center.z + hz))
    }
    const center = new THREE.Vector3()
    fullBox.getCenter(center)
    const size = new THREE.Vector3()
    fullBox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)
    const camDist = maxDim * 1.5 + 2
    camera.position.copy(center.clone().add(new THREE.Vector3(camDist * 0.6, camDist * 0.5, camDist * 0.6)))
    controls.target.copy(center)
    controls.update()

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

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const meshes = Array.from(entries.values()).map((e) => e.mesh)
      const hits = raycaster.intersectObjects(meshes)
      if (hits.length > 0) {
        const hitMesh = hits[0].object as THREE.Mesh
        for (const [id, e] of entries) {
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

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      entries.forEach((e) => {
        e.mesh.geometry.dispose()
        e.material.dispose()
        e.marker.geometry.dispose()
        ;(e.marker.material as THREE.Material).dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      entriesRef.current = new Map()
      sceneRef.current = null
      resetRef.current = null
    }
  }, [])

  // update meshes when elements change
  useEffect(() => {
    const entries = entriesRef.current
    if (entries.size === 0) return
    for (const el of elements) {
      const entry = entries.get(el.id)
      if (!entry) continue
      const spec = generateTimberGeometry(el)
      const oldGeo = entry.mesh.geometry
      const newGeo = new THREE.BoxGeometry(mmToMeters(spec.size.x), mmToMeters(spec.size.y), mmToMeters(spec.size.z))
      entry.mesh.geometry = newGeo
      oldGeo.dispose()
      const center = boxCenterWorld(el)
      entry.mesh.position.set(mmToMeters(center.x), mmToMeters(center.y), mmToMeters(center.z))
      entry.mesh.quaternion.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w)
      entry.marker.position.set(mmToMeters(el.position.x), mmToMeters(el.position.y), mmToMeters(el.position.z))
    }
  }, [elements])

  // update highlight
  useEffect(() => {
    const entries = entriesRef.current
    entries.forEach((e, key) => {
      if (key === selectedId) {
        e.material.emissive = new THREE.Color(0x3366ff)
        e.material.emissiveIntensity = 0.25
        e.marker.visible = true
      } else {
        e.material.emissive = new THREE.Color(0x000000)
        e.material.emissiveIntensity = 0
        e.marker.visible = false
      }
    })
  }, [selectedId])

  return (
    <div className="viewport" ref={containerRef}>
      <button type="button" className="reset-view" onClick={() => resetRef.current?.()}>
        Сбросить вид
      </button>
    </div>
  )
}
