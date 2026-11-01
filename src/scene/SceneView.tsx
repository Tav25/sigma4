import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { generateTimberGeometry, mmToMeters, type TimberElement } from '../core/timber'

interface SceneViewProps {
  element: TimberElement
  onSelect?: (element: TimberElement) => void
}

export function SceneView({ element, onSelect }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const elementRef = useRef<TimberElement>(element)
  const resetRef = useRef<(() => void) | null>(null)
  const hasCenteredRef = useRef(false)

  useEffect(() => {
    elementRef.current = element
  }, [element])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf2f2f2)

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const grid = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc)
    scene.add(grid)

    const axes = new THREE.AxesHelper(2)
    scene.add(axes)

    const geometry = new THREE.BoxGeometry(
      mmToMeters(element.length),
      mmToMeters(element.height),
      mmToMeters(element.width),
    )
    const material = new THREE.MeshStandardMaterial({ color: 0xb8864e })
    const mesh = new THREE.Mesh(geometry, material)
    const spec = generateTimberGeometry(element)
    mesh.position.set(
      mmToMeters(spec.center.x),
      mmToMeters(spec.center.y),
      mmToMeters(spec.center.z),
    )
    mesh.rotation.set(spec.rotation.x, spec.rotation.y, spec.rotation.z)
    scene.add(mesh)
    meshRef.current = mesh

    // lights for visibility of solid
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.6)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    // initial centering
    const center = new THREE.Vector3(
      mmToMeters(spec.center.x),
      mmToMeters(spec.center.y),
      mmToMeters(spec.center.z),
    )
    const offset = new THREE.Vector3(3, 2, 3)
    camera.position.copy(center.clone().add(offset))
    controls.target.copy(center)
    controls.update()
    hasCenteredRef.current = true

    resetRef.current = () => {
      const el = elementRef.current
      const s = generateTimberGeometry(el)
      const c = new THREE.Vector3(mmToMeters(s.center.x), mmToMeters(s.center.y), mmToMeters(s.center.z))
      camera.position.copy(c.clone().add(new THREE.Vector3(3, 2, 3)))
      controls.target.copy(c)
      controls.update()
    }

    // click handling
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length > 0) {
        onSelect?.(elementRef.current)
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
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      meshRef.current = null
      resetRef.current = null
    }
  }, [])

  // update mesh when element changes
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    elementRef.current = element
    const oldGeo = mesh.geometry
    const newGeo = new THREE.BoxGeometry(
      mmToMeters(element.length),
      mmToMeters(element.height),
      mmToMeters(element.width),
    )
    mesh.geometry = newGeo
    oldGeo.dispose()
    const spec = generateTimberGeometry(element)
    mesh.position.set(
      mmToMeters(spec.center.x),
      mmToMeters(spec.center.y),
      mmToMeters(spec.center.z),
    )
    mesh.rotation.set(spec.rotation.x, spec.rotation.y, spec.rotation.z)
  }, [element])

  return (
    <div className="viewport" ref={containerRef}>
      <button type="button" className="reset-view" onClick={() => resetRef.current?.()}>
        Сбросить вид
      </button>
    </div>
  )
}