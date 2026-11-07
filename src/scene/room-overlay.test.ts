import {describe,expect,it} from 'vitest'
import {makeRoomLabel,makeRoomOverlayGroup,disposeRoomOverlayGroup,roomFloorPlanes} from './room-overlay'
import {orientDimensionNumbers} from './DimensionOverlay'
import * as THREE from 'three'
import {deriveFloorRooms} from '../core/rooms'
import {emptyFloorPlan,type FloorPlan} from '../core/floor-plan'
import {addGraphSegment} from '../core/plan-graph'
const p=(xMm:number,zMm:number)=>({xMm,zMm})
describe('SIGMA4 0.1.33: 3D floor overlays use the same derived 2D dimensions',()=>{
  it('projects 9×6 T-room areas into exact world metres',()=>{
    let plan:FloorPlan={...emptyFloorPlan(),closed:true,
      exterior:[p(0,0),p(9000,0),p(9000,-6000),p(0,-6000)],
      exteriorThicknessMm:150}
    plan=addGraphSegment(plan,p(3000,0),p(3000,-6000),100)
    plan=addGraphSegment(plan,p(0,-3000),p(3000,-3000),100)
    const rooms=deriveFloorRooms(plan)
    const planes=roomFloorPlanes(rooms)
    expect(rooms.map(r=>r.areaM2)).toEqual([7.84,7.84,33.06])
    expect(planes.map(x=>x.widthM*x.depthM).reduce((a,b)=>a+b,0))
      .toBeCloseTo(48.74,10)
    for(const plane of planes){
      expect(plane.widthM).toBeGreaterThan(0)
      expect(plane.depthM).toBeGreaterThan(0)
      expect(plane.xM).toBeGreaterThanOrEqual(0.15)
      expect(plane.xM).toBeLessThanOrEqual(8.85)
      expect(plane.zM).toBeLessThanOrEqual(-0.15)
      expect(plane.zM).toBeGreaterThanOrEqual(-5.85)
    }
    expect(new Set(planes.map(x=>x.color)).size).toBe(3)
  })
  it('draws room numbers with the EXACT vector font/size and material as wall dimensions, not sprites/cards',()=>{
    const room={
      id:'R01',label:'Помещение 01',areaMm2:7840000,areaM2:7.84,
      center:p(1500,-1600),bounds:{minXmm:150,maxXmm:2900,minZmm:-2850,maxZmm:-150},
      rectangles:[{minXmm:150,maxXmm:2900,minZmm:-2850,maxZmm:-150}],
    }
    const text=makeRoomLabel(room,false)
    expect(text).toBeInstanceOf(THREE.Group)
    expect(text.name).toBe('dimension-number-room-R01')
    expect(text.position.toArray()).toEqual([1.5,0.044,-1.6])
    expect(text.children).toHaveLength(3) // numeric, metre, raised square
    const numeric=text.children[0] as THREE.Mesh
    expect(numeric.geometry).toBeInstanceOf(THREE.ShapeGeometry)
    numeric.geometry.computeBoundingBox()
    const height=numeric.geometry.boundingBox!.max.y-numeric.geometry.boundingBox!.min.y
    expect(height).toBeGreaterThan(0.08)
    expect(height).toBeLessThanOrEqual(0.185)
    const square=text.children[2] as THREE.Mesh
    expect(square.position.y).toBeGreaterThan(0)
    for(const child of text.children){
      expect(child).toBeInstanceOf(THREE.Mesh)
      const material=(child as THREE.Mesh).material as THREE.MeshBasicMaterial
      expect(material.map).toBeNull()
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.side).toBe(THREE.DoubleSide)
    }
    const roomGroup=makeRoomOverlayGroup([room],{showLabels:true,showFill:false,
      selectedRoomId:null})
    expect(roomGroup.getObjectByName('dimension-number-room-R01')).toBeDefined()
    expect(roomGroup.children.some(child=>child instanceof THREE.Sprite)).toBe(false)
    const label=roomGroup.getObjectByName('dimension-number-room-R01') as THREE.Group
    const camera=new THREE.PerspectiveCamera()
    camera.position.set(8,8,8)
    camera.lookAt(0,0,0)
    orientDimensionNumbers(roomGroup,camera)
    const baseline=new THREE.Vector3(1,0,0).applyQuaternion(label.quaternion)
    expect(Math.abs(baseline.x)).toBeCloseTo(1,6)
    expect(Math.abs(baseline.z)).toBeLessThan(1e-6)
    camera.up.set(0,0,-1)
    camera.position.set(2,100,-3)
    camera.lookAt(2,0,-3)
    orientDimensionNumbers(roomGroup,camera)
    expect(new THREE.Vector3(1,0,0).applyQuaternion(label.quaternion).x).toBeGreaterThan(0.99)
    disposeRoomOverlayGroup(roomGroup)
    // Plain fixture is not attached to the scene, its GPU resources can
    // be disposed the same way as other derived dimension annotations.
    const shell=new THREE.Group()
    shell.add(text)
    disposeRoomOverlayGroup(shell)
  })

  it('keeps translucent floor independent of the annotation visibility',()=>{
    const room={
      id:'R02',label:'Помещение 02',areaMm2:3000000,areaM2:3,
      center:p(1150,-1150),bounds:{minXmm:150,maxXmm:2150,minZmm:-1650,maxZmm:-150},
      rectangles:[{minXmm:150,maxXmm:2150,minZmm:-1650,maxZmm:-150}],
    }
    const fill=makeRoomOverlayGroup([room],{
      showLabels:false,showFill:true,selectedRoomId:null,
    })
    expect(fill.getObjectByName('dimension-number-room-R02')).toBeUndefined()
    expect(fill.children).toHaveLength(1)
    expect(fill.children[0]).toBeInstanceOf(THREE.Mesh)
    const material=(fill.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeLessThan(0.35)
    disposeRoomOverlayGroup(fill)
  })

})
