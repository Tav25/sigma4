import * as THREE from 'three'
import {ROOM_COLORS,formatRoomArea,type FloorRoom} from '../core/rooms'

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
function makeRoomLabel(room:FloorRoom,selected:boolean):THREE.Sprite|null {
  const canvas=document.createElement('canvas')
  canvas.width=512
  canvas.height=176
  const ctx=canvas.getContext('2d')
  if(!ctx)return null
  ctx.fillStyle=selected?'rgba(238,250,247,0.99)':'rgba(255,255,255,0.95)'
  ctx.fillRect(6,6,500,164)
  ctx.lineWidth=5
  ctx.strokeStyle=selected?'#168f7b':'#b9cad5'
  ctx.strokeRect(8,8,496,160)
  ctx.textAlign='center'
  ctx.textBaseline='middle'
  ctx.fillStyle='#486373'
  ctx.font='600 32px system-ui, sans-serif'
  ctx.fillText(room.label,256,61)
  ctx.fillStyle='#214457'
  ctx.font='bold 56px system-ui, sans-serif'
  ctx.fillText(formatRoomArea(room.areaM2)+' м²',256,122)
  const texture=new THREE.CanvasTexture(canvas)
  texture.colorSpace=THREE.SRGBColorSpace
  const material=new THREE.SpriteMaterial({
    map:texture,transparent:true,depthWrite:false,depthTest:false,
  })
  const label=new THREE.Sprite(material)
  const side=Math.min(room.bounds.maxXmm-room.bounds.minXmm,
    room.bounds.maxZmm-room.bounds.minZmm)/1000
  const width=Math.max(0.60,Math.min(1.8,side*0.50))
  label.scale.set(width,width*176/512,1)
  label.position.set(room.center.xMm/1000,0.22,room.center.zMm/1000)
  label.renderOrder=90
  label.userData={roomId:room.id,areaM2:room.areaM2,kind:'room-label'}
  return label
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
  if(options.showLabels)for(const room of rooms){
    const label=makeRoomLabel(room,room.id===options.selectedRoomId)
    if(label)group.add(label)
  }
  return group
}
export function disposeRoomOverlayGroup(group:THREE.Group):void {
  group.traverse(node=>{
    if(node instanceof THREE.Mesh)node.geometry.dispose()
    if(node instanceof THREE.Mesh||node instanceof THREE.Sprite){
      const materials=Array.isArray(node.material)?node.material:[node.material]
      for(const material of materials){
        if(material instanceof THREE.SpriteMaterial)material.map?.dispose()
        material.dispose()
      }
    }
  })
}
