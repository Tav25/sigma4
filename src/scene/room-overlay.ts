import * as THREE from 'three'
import {ROOM_COLORS,formatRoomArea,type FloorRoom} from '../core/rooms'
import {makePlanarVectorText} from './DimensionOverlay'

/** Convert canonical millimetre plan rectangles into Three.js metre positions. */
export function roomFloorPlanes(rooms:readonly FloorRoom[]) {
  return rooms.flatMap((room,i)=>room.rectangles.map(rect=>({
    roomId:room.id,
    color:ROOM_COLORS[i%ROOM_COLORS.length],
    xM:(rect.minXmm+rect.maxXmm)/2000,
    zM:(rect.minZmm+rect.maxZmm)/2000,
    widthM:(rect.maxXmm-rect.minXmm)/1000,
    depthM:(rect.maxZmm-rect.minZmm)/1000,
  })))
}

interface OverlayOptions {
  showLabels:boolean
  showFill:boolean
  selectedRoomId:string|null
}
/** Same font and XZ-plane layout as the dimensional numbers on wall lines.
 * Planar VECTOR glyphs are occluded by timber, unlike Sprite billboards.
 * The '2' is a raised geometric superscript, not a raster glyph.
 */
export function makeRoomLabel(room:FloorRoom,selected:boolean):THREE.Group {
  const group=new THREE.Group()
  const color=selected?0x1562a8:0x274559
  const value=makePlanarVectorText(formatRoomArea(room.areaM2),color)
  value.name='room-area-value-'+room.id
  group.add(value)
  value.geometry.computeBoundingBox()
  const numberWidth=(value.geometry.boundingBox?.max.x??0)-
    (value.geometry.boundingBox?.min.x??0)
  // Keep the trailing unit considerably smaller than the main number;
  // use ASCII vector 'm' because the existing Helvetiker CAD font does not
  // include Cyrillic glyphs. Raised "2" gives the actual square-metre sign.
  const metre=makePlanarVectorText('m',color,0.105)
  const square=makePlanarVectorText('2',color,0.079)
  const unitX=numberWidth/2+0.10
  metre.position.set(unitX,0,0)
  square.position.set(unitX+0.067,0.060,0)
  group.add(metre,square)
  // Exactly the same quaternion and camera-flip handling as wall dimensions.
  group.name='dimension-number-room-'+room.id
  group.userData.dimensionBaseYaw=0
  group.userData.roomId=room.id
  group.userData.areaM2=room.areaM2
  group.userData.kind='room-area-vector'
  group.position.set(room.center.xMm/1000,0.044,room.center.zMm/1000)
  return group
}
/** The visual group never changes any ProjectDocument or participates in raycasts. */
export function makeRoomOverlayGroup(rooms:readonly FloorRoom[],options:OverlayOptions) {
  const group=new THREE.Group()
  group.name='SIGMA4-derived-room-overlay'
  const planes=roomFloorPlanes(rooms)
  if(options.showFill)for(const plane of planes){
    const material=new THREE.MeshBasicMaterial({
      color:plane.color,transparent:true,
      opacity:plane.roomId===options.selectedRoomId?0.53:0.28,
      depthWrite:false,side:THREE.DoubleSide,
      polygonOffset:true,polygonOffsetFactor:-1,
    })
    const geometry=new THREE.PlaneGeometry(plane.widthM,plane.depthM)
    const mesh=new THREE.Mesh(geometry,material)
    mesh.rotation.x=-Math.PI/2
    mesh.position.set(plane.xM,0.018,plane.zM)
    mesh.renderOrder=2
    mesh.userData={roomId:plane.roomId,kind:'room-floor'}
    group.add(mesh)
  }
  if(options.showLabels)for(const room of rooms)
    group.add(makeRoomLabel(room,room.id===options.selectedRoomId))
  return group
}
export function disposeRoomOverlayGroup(group:THREE.Group):void {
  group.traverse(node=>{
    if(node instanceof THREE.Mesh)node.geometry.dispose()
    if(node instanceof THREE.Mesh){
      const materials=Array.isArray(node.material)?node.material:[node.material]
      for(const material of materials)material.dispose()
    }
  })
}
