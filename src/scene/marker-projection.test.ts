import { describe, expect, it } from 'vitest'
import { createProjectFromCurrentState } from '../core/project-store'
import { createProjectStore } from '../core/ProjectStore'
import { projectToScene } from './project-to-scene'

function createStore() {
  return createProjectStore(createProjectFromCurrentState({
    length: 6000, height: 2700, spacing: 600,
    projectId: 's04-marker-test',
    openings: [
      { id: 'W01', type: 'window', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
      { id: 'W02', type: 'window', positionXmm: 4380, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 },
    ],
  }))
}

describe('S04.1: opening markers follow their real openings', () => {
  it('places each default marker 50 mm beyond the physical wall face', () => {
    const store = createStore()
    const scene = projectToScene(store.getSnapshot())
    expect(scene.markers).toHaveLength(2)
    expect(scene.markers.find(m => m.openingId === 'W01')).toEqual({
      openingId: 'W01',
      position: { x: 1500, y: 1500, z: 122.5 },
      visible: true,
      color: '#0066ff',
    })
  })

  it('moves a marker when its window moves, and undo restores both', () => {
    const store = createStore()
    expect(store.dispatch({
      type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1100 },
    }).success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')?.position.x).toBe(1700)
    expect(store.undo().success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')?.position.x).toBe(1500)
  })

  it('keeps marker centred vertically if window sill and height change', () => {
    const store = createStore()
    expect(store.dispatch({
      type: 'SET_WINDOW_SILL_HEIGHT', payload: { openingId: 'W01', sillHeightMm: 800 },
    }).success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')?.position.y).toBe(1400)
    expect(store.dispatch({
      type: 'SET_OPENING_HEIGHT', payload: { openingId: 'W01', heightMm: 1000 },
    }).success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')?.position.y).toBe(1300)
  })

  it('follows the marker anchor and supports hide/show through the store', () => {
    const store = createStore()
    expect(store.dispatch({
      type: 'SET_MARKER_SETTINGS', payload: { openingId: 'W01', anchor: 'left', visible: false, color: '#ff0000' },
    }).success).toBe(true)
    let marker = projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')
    expect(marker?.position.x).toBe(900)
    expect(marker?.visible).toBe(false)
    expect(marker?.color).toBe('#ff0000')
    expect(store.dispatch({
      type: 'SET_MARKER_SETTINGS', payload: { openingId: 'W01', anchor: 'right', visible: true },
    }).success).toBe(true)
    marker = projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')
    expect(marker?.position.x).toBe(2100)
    expect(marker?.visible).toBe(true)
  })

  it('adds and removes a door marker with no floating orphan objects', () => {
    const store = createStore()
    expect(store.dispatch({
      type: 'ADD_OPENING',
      payload: { wallId: 'wall-001', opening: { id: 'D01', type: 'door', positionXmm: 2700, widthMm: 900, heightMm: 2100, sillHeightMm: 0 } },
    }).success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'D01')?.position).toEqual({
      x: 3150, y: 1050, z: 122.5,
    })
    expect(store.dispatch({ type: 'REMOVE_OPENING', payload: { openingId: 'D01' } }).success).toBe(true)
    expect(projectToScene(store.getSnapshot()).markers.some(m => m.openingId === 'D01')).toBe(false)
  })

  it('renders a detached projection and exports marker settings via JSON', () => {
    const store = createStore()
    expect(store.dispatch({ type: 'SET_MARKER_SETTINGS', payload: { openingId: 'W01', visible: false } }).success).toBe(true)
    const scene = projectToScene(store.getSnapshot())
    const first = scene.markers.find(m => m.openingId === 'W01')!
    first.position.x = 100000
    expect(projectToScene(store.getSnapshot()).markers.find(m => m.openingId === 'W01')?.position.x).toBe(1500)
    const exported = JSON.parse(store.exportJson())
    expect(exported.building.markers.find((m: { openingId: string }) => m.openingId === 'W01').visible).toBe(false)
  })
})
