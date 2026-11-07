import { useEffect, useState } from 'react'
import type { ProjectDocument } from '../core/project'
import { buildProjectTree } from '../core/project-tree'

interface ProjectTreeProps {
  document: ProjectDocument
  selectedWallId: string
  selectedOpeningId: string | null
  selectedElementId: string | null
  onSelectWall: (wallId: string) => void
  onSelectOpening: (wallId: string, openingId: string) => void
  onSelectElement: (wallId: string, elementId: string) => void
}

export function ProjectTree({
  document, selectedWallId, selectedOpeningId, selectedElementId,
  onSelectWall, onSelectOpening, onSelectElement,
}: ProjectTreeProps) {
  const tree = buildProjectTree(document)
  const [expandedWalls, setExpandedWalls] = useState<Record<string, boolean>>({})
  useEffect(() => {
    // Every programmatic selection (new opening, tree action, 3D pick) reveals its wall.
    // Previously expanded branches remain independently open.
    setExpandedWalls(previous => previous[selectedWallId] ? previous : {
      ...previous, [selectedWallId]: true,
    })
  }, [selectedWallId])
  return (
    <nav className="project-tree" aria-label="Дерево проекта">
      <div className="project-tree-root" title={document.project.projectId}>⌂ {tree.name}</div>
      {tree.walls.map((node, index) => {
        const wallId = node.wall.wallId
        return (
          <details key={wallId} data-testid={'wall-node-' + wallId}
            className="project-tree-wall" open={expandedWalls[wallId] ?? selectedWallId === wallId}>
            <summary className={selectedWallId === wallId ? 'tree-selected' : ''}
              onClick={(event) => {
                event.preventDefault()
                setExpandedWalls(previous => ({
                  ...previous,
                  [wallId]: !(previous[wallId] ?? selectedWallId === wallId),
                }))
                onSelectWall(wallId)
              }}>
              Стена {index + 1} · {node.wall.lengthMm} мм
            </summary>
            <div className="tree-branches">
              <div className="tree-parameters">Параметры · {node.wall.sectionMm.width}×{node.wall.sectionMm.height} мм</div>
              <details className="tree-group" open={node.windows.length > 0}>
                <summary>Окна ({node.windows.length})</summary>
                <div className="tree-children">
                  {node.windows.length === 0 && <span className="tree-empty">Нет окон</span>}
                  {node.windows.map(opening => (
                    <button type="button" key={opening.id}
                      data-testid={'tree-opening-' + opening.id}
                      className={'tree-item' + (selectedOpeningId === opening.id ? ' tree-selected' : '')}
                      onClick={() => onSelectOpening(wallId, opening.id)}>
                      {opening.id} · {opening.widthMm} мм
                    </button>
                  ))}
                </div>
              </details>
              <details className="tree-group" open={node.doors.length > 0}>
                <summary>Двери ({node.doors.length})</summary>
                <div className="tree-children">
                  {node.doors.length === 0 && <span className="tree-empty">Нет дверей</span>}
                  {node.doors.map(opening => (
                    <button type="button" key={opening.id}
                      data-testid={'tree-opening-' + opening.id}
                      className={'tree-item' + (selectedOpeningId === opening.id ? ' tree-selected' : '')}
                      onClick={() => onSelectOpening(wallId, opening.id)}>
                      {opening.id} · {opening.widthMm} мм
                    </button>
                  ))}
                </div>
              </details>
              <details className="tree-group" open={node.garageDoors.length > 0}>
                <summary>Гаражные ворота ({node.garageDoors.length})</summary>
                <div className="tree-children">
                  {node.garageDoors.length === 0 && <span className="tree-empty">Нет ворот</span>}
                  {node.garageDoors.map(opening => (
                    <button type="button" key={opening.id}
                      data-testid={'tree-opening-' + opening.id}
                      className={'tree-item' + (selectedOpeningId === opening.id ? ' tree-selected' : '')}
                      onClick={() => onSelectOpening(wallId, opening.id)}>
                      {opening.id} · {opening.widthMm} × {opening.heightMm} мм
                    </button>
                  ))}
                </div>
              </details>
              <details className="tree-group" data-testid={'tree-frame-' + wallId}>
                <summary>Каркас ({node.boards.length})</summary>
                <div className="tree-children">
                  {node.boards.map(board => (
                    <button type="button" key={board.elementId}
                      data-testid={'tree-board-' + board.elementId}
                      className={'tree-item' + (selectedElementId === board.elementId ? ' tree-selected' : '')}
                      title={board.role}
                      onClick={() => onSelectElement(wallId, board.elementId)}>
                      {board.elementId}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </details>
        )
      })}
      <details className="tree-group project-tree-connections">
        <summary>Соединения ({tree.connections.length})</summary>
        <div className="tree-children">
          {tree.connections.length === 0 && <span className="tree-empty">Нет соединений</span>}
          {tree.connections.map(connection => (
            <div className="tree-empty" key={connection.from + ':' + connection.to}>
              {connection.type}: {connection.from} ↔ {connection.to}
            </div>
          ))}
        </div>
      </details>
    </nav>
  )
}
