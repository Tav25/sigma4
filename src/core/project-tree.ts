import type { ProjectDocument, Wall, Opening, TimberElement, Marker } from './project'
import { effectiveConnections } from './wall-topology'

/** Read-only projection. Records are REFERENCES to the canonical JSON. */
export interface WallTreeNode {
  wall: Wall
  windows: Opening[]
  doors: Opening[]
  garageDoors: Opening[]
  boards: TimberElement[]
  markers: Marker[]
}
export interface ProjectTreeModel {
  name: string
  walls: WallTreeNode[]
  connections: { from: string; to: string; type: string }[]
}

/** Resolve ownership once by wallId, with no duplicated stored data. */
export function buildProjectTree(doc: ProjectDocument): ProjectTreeModel {
  const walls = doc.building.walls.map(wall => {
    const openings = doc.building.openings.filter(opening => opening.wallId === wall.wallId)
    const openingIds = new Set(openings.map(opening => opening.id))
    return {
      wall,
      windows: openings.filter(opening => opening.type === 'window'),
      doors: openings.filter(opening => opening.type === 'door'),
      garageDoors: openings.filter(opening => opening.type === 'garage-door'),
      boards: doc.assembly.elements.filter(element => element.wallId === wall.wallId),
      markers: doc.building.markers.filter(marker => openingIds.has(marker.openingId)),
    }
  })
  const connections: ProjectTreeModel['connections'] = effectiveConnections(doc)
    .map(link => ({
      from: link.fromWallId,
      to: link.toWallId,
      type: link.type === 'california-right' ? 'Калифорнийский угол' : 'Прямой стык',
    }))
  return { name: doc.project.projectName, walls, connections }
}
