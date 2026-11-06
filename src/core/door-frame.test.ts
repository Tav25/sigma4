import { describe, expect, it } from 'vitest'
import { doorProfile, doorFrameMembers, doorBottomPlates } from './door-frame'
import { generatePartitionWithDoors } from './partition-door'
import { generateWallWithOpenings, type WindowOpening } from './window'
import { generateWallModule } from './wall-module'
import type { Opening, Wall } from './project'
import type { WallPanelParams } from './wall'

const door=(id:string,x:number):WindowOpening=>({
  id, type:'door', positionXmm:x,widthMm:900,heightMm:2100,sillHeightMm:0,
})
const params=(depth:number):WallPanelParams=>({
  length:5000,height:2700,sectionWidth:45,sectionHeight:depth,
  topLayers:2,spacing:depth===100?400:600,requiredFirst:true,
})
const box=(depth:number,id:string):Wall=>({
  wallId:id,origin:{x:0,y:0,z:0},lengthMm:5000,heightMm:2700,
  studSpacingMm:depth===100?400:600,thicknessMm:depth,
  sectionMm:{width:45,height:depth},orientation:'x',openings:[],
})

describe('S20: one doorway algorithm with distinct structural profiles',()=>{
  it('uses the exact same king-post geometry and positioning formula',()=>{
    const d=door('D01',2055)
    const outer=doorFrameMembers(d,{
      widthMm:45,depthMm:145,wallHeightMm:2700,topLayers:2,
    },doorProfile(d,false,145))
    const inner=doorFrameMembers(d,{
      widthMm:45,depthMm:100,wallHeightMm:2700,topLayers:2,
    },doorProfile(d,true,100))
    for(const suffix of ['king-left','king-right']){
      const a=outer.find(e=>e.id==='D01-'+suffix)!
      const b=inner.find(e=>e.id==='D01-'+suffix)!
      expect(a.position.x-(suffix==='king-left'?-45:45)).toBe(b.position.x)
      expect(a.length).toBe(b.length)
      expect(a.length).toBe(2565)
    }
    expect(outer.filter(e=>e.role==='jack-stud')).toHaveLength(2)
    expect(inner.filter(e=>e.role==='jack-stud')).toHaveLength(0)
    expect(outer.filter(e=>e.role==='header')).toHaveLength(2)
    expect(inner.filter(e=>e.role==='header')).toHaveLength(1)
    const flat=inner.find(e=>e.id==='D01-header')!
    expect(flat.orientation).toEqual({mode:'x',angle:0,roll:90})
    expect(flat.length).toBe(900)
    expect(flat.position.y).toBe(2122.5)
  })
  it('cuts the same doorway intervals on both types of wall',()=>{
    const d=[door('D01',950),door('D02',3100)]
    const a=doorBottomPlates(params(100),d,'partition')
    const b=doorBottomPlates(params(145),d,'exterior')
    const intervals=(items:typeof a)=>items.map(e=>[e.position.x,e.position.x+e.length])
    expect(intervals(a)).toEqual([[0,950],[1850,3100],[4000,5000]])
    expect(intervals(b)).toEqual(intervals(a))
    expect(a.map(e=>e.id)).toEqual(['D01-bottom-before','D02-bottom-before','plate-bottom-last'])
    expect(b.map(e=>e.id)).toEqual(['plate-bottom-left','plate-bottom-mid-1','plate-bottom-right'])
  })
  it('retains a one-plank inner door with no supports, and an exterior double header',()=>{
    const inner=generatePartitionWithDoors(params(100),[door('D01',2055)])
    const outer=generateWallWithOpenings(params(145),[door('D02',2000)])
    expect(inner.elements.filter(e=>e.role==='header')).toHaveLength(1)
    expect(inner.elements.filter(e=>e.role==='jack-stud')).toHaveLength(0)
    expect(outer.elements.filter(e=>e.role==='header')).toHaveLength(2)
    expect(outer.elements.filter(e=>e.role==='jack-stud')).toHaveLength(2)
    expect(inner.elements.find(e=>e.id==='D01-header')?.position)
      .toEqual({x:2055,y:2122.5,z:-50})
    expect(outer.elements.find(e=>e.id==='D02-header-1')?.position)
      .toEqual({x:1955,y:2100,z:-50})
    expect(inner.elements.filter(e=>e.role==='bottom-plate').map(e=>e.length))
      .toEqual([2055,2045])
    expect(outer.elements.filter(e=>e.role==='bottom-plate').map(e=>e.length))
      .toEqual([2000,2100])
  })
  it('preserves IDs, coordinates and serializable geometry on both linked module types',()=>{
    const partition:Opening={id:'D01',wallId:'partition-I001',type:'door',
      positionUmm:2055,widthMm:900,heightMm:2100,sillHeightMm:0}
    const exterior:Opening={id:'D02',wallId:'plan-back',type:'door',
      positionUmm:2000,widthMm:900,heightMm:2100,sillHeightMm:0}
    const inner=generateWallModule(box(100,'partition-I001'),[partition],{
      requiredFirst:true,partition:true})
    const outer=generateWallModule(box(145,'plan-back'),[exterior],{
      requiredFirst:true,partition:false})
    expect(inner.some(e=>e.elementId==='partition-I001:D01-header')).toBe(true)
    expect(outer.some(e=>e.elementId==='plan-back:D02-header-1')).toBe(true)
    expect(outer.some(e=>e.elementId==='plan-back:D02-header-2')).toBe(true)
    expect(outer.filter(e=>e.elementId.includes('D02-jack-'))).toHaveLength(2)
    expect(inner.filter(e=>e.elementId.includes('D01-jack-'))).toHaveLength(0)
    expect(inner.every(e=>e.wallId==='partition-I001')).toBe(true)
    expect(outer.every(e=>e.wallId==='plan-back')).toBe(true)
    expect(JSON.stringify(generateWallModule(box(100,'partition-I001'),[partition],{
      requiredFirst:true,partition:true}))).toBe(JSON.stringify(inner))
    expect(JSON.stringify(generateWallModule(box(145,'plan-back'),[exterior],{
      requiredFirst:true,partition:false}))).toBe(JSON.stringify(outer))
  })
  it('rejects nonsensical profiles but does not silently turn interior door into bearing',()=>{
    const d=door('D01',2055)
    expect(()=>doorFrameMembers(d,{
      widthMm:45,depthMm:100,wallHeightMm:2700,topLayers:2,
    },{kind:'bearing-double-preview',jackStudsPerSide:5,depthMm:145})).toThrow()
    expect(()=>doorProfile({...d,type:'garage-door'},true,100)).toThrow()
  })
})
