import type {
  ProjectDocument,
  Wall,
  WallConnection,
  Vector3,
  ValidationResult,
} from './project'
import { validateProjectSnapshot, validateSourceParameters } from './frame-validator'
import { buildProjectSnapshot, serializeProject } from './project-store'
import { rightCornerOrigin } from './corner'
import { translateWallsToExteriorZero, migrateLegacyWallOrigins } from './world-origin'
import { effectiveConnections, reflowConnections } from './wall-topology'
import { previewChainClosure, wallEndPosition } from './wall-chain'

export type ProjectCommand =
  | { type: 'SET_PROJECT_NAME'; payload: { projectName: string } }
  | { type: 'SET_WALL_LENGTH'; payload: { wallId: string; lengthMm: number } }
  | { type: 'SET_WALL_HEIGHT'; payload: { wallId: string; heightMm: number } }
  | { type: 'SET_STUD_SPACING'; payload: { wallId: string; studSpacingMm: number } }
  | { type: 'SET_OPENING_POSITION'; payload: { openingId: string; positionUmm: number } }
  | { type: 'SET_OPENING_WIDTH'; payload: { openingId: string; widthMm: number } }
  | { type: 'SET_OPENING_HEIGHT'; payload: { openingId: string; heightMm: number } }
  | { type: 'SET_WINDOW_SILL_HEIGHT'; payload: { openingId: string; sillHeightMm: number } }
  | { type: 'SET_MARKER_SETTINGS'; payload: { openingId: string; anchor?: 'center' | 'left' | 'right'; outsideOffsetMm?: number; elevationMm?: number; visible?: boolean; color?: string } }
  | { type: 'ADD_OPENING'; payload: { wallId: string; opening: { id: string; type: 'window' | 'door' | 'garage-door'; positionXmm: number; widthMm: number; heightMm: number; sillHeightMm: number; garage?: import('./project').GarageDoorSpec } } }
  | { type: 'REMOVE_OPENING'; payload: { openingId: string } }
  | { type: 'ADD_WALL'; payload: { wall: Wall; connection?: WallConnection } }
  | { type: 'CLOSE_CHAIN'; payload: Record<string, never> }
  | { type: 'REOPEN_CHAIN'; payload: Record<string, never> }
  | { type: 'SET_WALL_ORIGIN'; payload: { wallId: string; origin: Vector3 } }
  | { type: 'ANCHOR_FIRST_WALL_AT_ZERO'; payload: Record<string, never> }
  | { type: 'SET_WALL_AXIS'; payload: { wallId: string; orientation: 'x' | 'z' } }
  | { type: 'REMOVE_WALL'; payload: { wallId: string } }
  | { type: 'REPLACE_PROJECT'; payload: { document: ProjectDocument } }

export interface CommandResult {
  success: boolean
  revision: number
  errorCode?: string
  changedIds?: string[]
  messageRu?: string
  validation?: ValidationResult
}

interface HistoryEntry {
  document: ProjectDocument
  revision: number
  command: ProjectCommand
}

interface TransactionState {
  active: boolean
  baseDocument: ProjectDocument
  previewDocument: ProjectDocument
  lastPreviewSuccess: boolean
}

type Subscriber = (document: ProjectDocument, revision: number) => void

export class ProjectStore {
  private document: ProjectDocument
  private revision: number = 0
  private history: HistoryEntry[] = []
  private historyIndex: number = 0
  private maxHistorySize: number = 101
  private subscribers: Set<Subscriber> = new Set()
  private transaction: TransactionState | null = null

  constructor(initialDocument: ProjectDocument) {
    const validation = validateProjectSnapshot(initialDocument)
    if (!validation.valid) {
      throw new Error(`Invalid initial document: ${validation.issues.filter(i => i.severity === 'error').map(e => e.messageRu).join('; ')}`)
    }
    this.document = this.deepFreeze(this.deepClone(initialDocument))
    this.history = [{ document: this.document, revision: 0, command: { type: 'REPLACE_PROJECT', payload: { document: this.document } } }]
    this.historyIndex = 0
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
  }

  private deepFreeze<T>(obj: T): T {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj)
      for (const key of Object.keys(obj)) {
        const value = (obj as Record<string, unknown>)[key]
        if (value && typeof value === 'object') {
          this.deepFreeze(value)
        }
      }
    }
    return obj
  }

  private trimHistory(): void {
    while (this.history.length > this.maxHistorySize) {
      this.history.shift()
      this.historyIndex--
    }
    this.historyIndex = Math.min(this.historyIndex, this.history.length - 1)
  }

  private addToHistory(doc: ProjectDocument, command: ProjectCommand): void {
    this.revision++
    // Truncate any redo branch
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push({ document: this.deepClone(doc), revision: this.revision, command })
    this.historyIndex = this.history.length - 1
    this.trimHistory()
  }

  private notifySubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber(this.deepClone(this.document), this.revision)
    }
  }

  getSnapshot(): ProjectDocument {
    return this.deepClone(this.document)
  }

  // Uncommitted visual state for dragging. It does not enter undo history.
  getPreviewSnapshot(): ProjectDocument | null {
    return this.transaction ? this.deepClone(this.transaction.previewDocument) : null
  }

  getRevision(): number {
    return this.revision
  }

  getValidation(): ValidationResult {
    return validateProjectSnapshot(this.document)
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  canUndo(): boolean {
    return this.historyIndex > 0
  }

  canRedo(): boolean {
    return this.historyIndex < this.history.length - 1
  }

  undo(): CommandResult {
    if (this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'TRANSACTION_IN_PROGRESS', messageRu: 'Завершите текущую транзакцию' }
    }
    if (!this.canUndo()) {
      return { success: false, revision: this.revision, errorCode: 'UNDO_NOT_AVAILABLE', messageRu: 'Отмена недоступна' }
    }
    this.historyIndex--
    const entry = this.history[this.historyIndex]
    this.document = this.deepFreeze(this.deepClone(entry.document))
    this.revision++
    this.notifySubscribers()
    return { success: true, revision: this.revision }
  }

  redo(): CommandResult {
    if (this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'TRANSACTION_IN_PROGRESS', messageRu: 'Завершите текущую транзакцию' }
    }
    if (!this.canRedo()) {
      return { success: false, revision: this.revision, errorCode: 'REDO_NOT_AVAILABLE', messageRu: 'Повтор недоступен' }
    }
    this.historyIndex++
    const entry = this.history[this.historyIndex]
    this.document = this.deepFreeze(this.deepClone(entry.document))
    this.revision++
    this.notifySubscribers()
    return { success: true, revision: this.revision }
  }

  beginTransaction(): boolean {
    if (this.transaction !== null) return false
    this.transaction = {
      active: true,
      baseDocument: this.deepClone(this.document),
      previewDocument: this.deepClone(this.document),
      lastPreviewSuccess: false,
    }
    return true
  }

  preview(command: ProjectCommand): CommandResult {
    if (!this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'NO_ACTIVE_TRANSACTION', messageRu: 'Нет активной транзакции' }
    }

    const candidate = this.applyCommand(this.transaction.previewDocument, command)
    if (!candidate.success) {
      this.transaction.lastPreviewSuccess = false
      return { success: false, revision: this.revision, errorCode: candidate.errorCode, messageRu: candidate.messageRu, validation: candidate.validation }
    }

    this.transaction.previewDocument = candidate.document!
    this.transaction.lastPreviewSuccess = true
    return { success: true, revision: this.revision, changedIds: candidate.changedIds, validation: candidate.validation }
  }

  commitTransaction(): CommandResult {
    if (!this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'NO_ACTIVE_TRANSACTION', messageRu: 'Нет активной транзакции' }
    }

    if (!this.transaction.lastPreviewSuccess) {
      return { success: false, revision: this.revision, errorCode: 'INVALID_TRANSACTION_STATE', messageRu: 'Последний preview завершился ошибкой, commit невозможен' }
    }

    // Re-validate the preview document before committing
    const candidate = this.applyCommand(this.transaction.previewDocument, { type: 'REPLACE_PROJECT', payload: { document: this.transaction.previewDocument } })
    if (!candidate.success) {
      return { success: false, revision: this.revision, errorCode: candidate.errorCode, messageRu: candidate.messageRu, validation: candidate.validation }
    }

    this.document = this.deepFreeze(this.deepClone(candidate.document!))
    this.addToHistory(this.document, { type: 'REPLACE_PROJECT', payload: { document: this.deepClone(this.document) } })
    this.transaction = null
    this.notifySubscribers()
    return { success: true, revision: this.revision }
  }

  rollbackTransaction(): CommandResult {
    if (!this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'NO_ACTIVE_TRANSACTION', messageRu: 'Нет активной транзакции' }
    }
    this.transaction = null
    return { success: true, revision: this.revision }
  }

  dispatch(command: ProjectCommand): CommandResult {
    if (this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'TRANSACTION_IN_PROGRESS', messageRu: 'Активна транзакция, используйте commitTransaction или rollbackTransaction' }
    }

    const candidate = this.applyCommand(this.document, command)
    if (!candidate.success) {
      return { success: false, revision: this.revision, errorCode: candidate.errorCode, messageRu: candidate.messageRu, validation: candidate.validation }
    }

    this.document = this.deepFreeze(this.deepClone(candidate.document!))
    this.addToHistory(this.document, command)
    this.notifySubscribers()
    return { success: true, revision: this.revision, changedIds: candidate.changedIds, validation: candidate.validation }
  }

  private applyCommand(doc: ProjectDocument, command: ProjectCommand): { success: boolean; document?: ProjectDocument; errorCode?: string; messageRu?: string; changedIds?: string[]; validation?: ValidationResult } {
    const candidate = this.deepClone(doc)
    const changedIds: string[] = []

    try {
      switch (command.type) {
        case 'SET_PROJECT_NAME': {
          candidate.project.projectName = command.payload.projectName
          changedIds.push('project.projectName')
          break
        }
        case 'SET_WALL_LENGTH': {
          const { wallId, lengthMm } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: 'Стена не найдена' }
          if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
            return { success: false, errorCode: 'INVALID_LENGTH', messageRu: 'Длина должна быть положительным числом' }
          }
          const links = effectiveConnections(candidate)
          wall.lengthMm = lengthMm
          reflowConnections(candidate.building.walls, links)
          changedIds.push('building.walls[' + wallId + '].lengthMm')
          for (const link of links) changedIds.push('building.walls[' + link.toWallId + '].origin')
          break
        }
        case 'SET_WALL_AXIS': {
          const { wallId, orientation } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: 'Стена не найдена' }
          if (orientation !== 'x' && orientation !== 'z') {
            return { success: false, errorCode: 'UNSUPPORTED_WALL_AXIS', messageRu: 'Поддерживаются направления X и -Z' }
          }
          const links = effectiveConnections(candidate)
          if (links.some(link => link.fromWallId === wallId || link.toWallId === wallId)) {
            return { success: false, errorCode: 'WALL_CONNECTED_AXIS_LOCKED',
              messageRu: 'Поворот соединённой стены требует отдельного расчёта узла' }
          }
          wall.orientation = orientation
          changedIds.push('building.walls[' + wallId + '].orientation')
          break
        }
        case 'ANCHOR_FIRST_WALL_AT_ZERO': {
          if (!candidate.building.walls.length || candidate.building.walls[0].orientation !== 'x') {
            return { success: false, errorCode: 'FIRST_WALL_AXIS_UNSUPPORTED',
              messageRu: 'Для привязки начала координат первая стена должна идти по +X' }
          }
          const wallIds = translateWallsToExteriorZero(candidate.building.walls)
          changedIds.push(...wallIds.map(id => 'building.walls[' + id + '].origin'))
          // Every wall uses the same rigid translation; the existing wall
          // connections and door/window positions remain unchanged.
          break
        }
        case 'SET_WALL_ORIGIN': {
          const { wallId, origin } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: 'Стена не найдена' }
          const links = effectiveConnections(candidate)
          if (links.some(link => link.toWallId === wallId)) {
            return { success: false, errorCode: 'WALL_CONNECTED_POSITION_LOCKED',
              messageRu: 'Координаты присоединённой стены определяются её соединением' }
          }
          if (!origin || ![origin.x, origin.y, origin.z].every(Number.isFinite)) {
            return { success: false, errorCode: 'INVALID_WALL_ORIGIN', messageRu: 'Некорректные координаты стены' }
          }
          wall.origin = { ...origin }
          reflowConnections(candidate.building.walls, links)
          changedIds.push('building.walls[' + wallId + '].origin')
          for (const link of links) changedIds.push('building.walls[' + link.toWallId + '].origin')
          break
        }
        case 'SET_WALL_HEIGHT': {
          const { wallId, heightMm } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: `Стена ${wallId} не найдена` }
          if (heightMm <= 0) return { success: false, errorCode: 'INVALID_HEIGHT', messageRu: 'Высота стены должна быть положительной' }
          // A connected component shares panel height. Independent walls do
          // not inherit unrelated changes.
          const links = effectiveConnections(candidate)
          const affected = new Set([wallId])
          let changed = true
          while (changed) {
            changed = false
            for (const link of links) {
              if (affected.has(link.fromWallId) || affected.has(link.toWallId)) {
                const prior = affected.size
                affected.add(link.fromWallId)
                affected.add(link.toWallId)
                if (affected.size !== prior) changed = true
              }
            }
          }
          for (const connected of candidate.building.walls) {
            if (!affected.has(connected.wallId)) continue
            connected.heightMm = heightMm
            changedIds.push(`building.walls[${connected.wallId}].heightMm`)
          }
          break
        }
        case 'SET_STUD_SPACING': {
          const { wallId, studSpacingMm } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: `Стена ${wallId} не найдена` }
          if (studSpacingMm <= 0) return { success: false, errorCode: 'INVALID_SPACING', messageRu: 'Шаг стоек должен быть положительным' }
          wall.studSpacingMm = studSpacingMm
          changedIds.push(`building.walls[${wallId}].studSpacingMm`)
          break
        }
        case 'SET_OPENING_POSITION': {
          const { openingId, positionUmm } = command.payload
          const opening = candidate.building.openings.find(o => o.id === openingId)
          if (!opening) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          if (positionUmm < 0) return { success: false, errorCode: 'INVALID_POSITION', messageRu: 'Положение проёма не может быть отрицательным' }
          opening.positionUmm = positionUmm
          changedIds.push(`building.openings[${openingId}].positionUmm`)
          break
        }
        case 'SET_OPENING_WIDTH': {
          const { openingId, widthMm } = command.payload
          const opening = candidate.building.openings.find(o => o.id === openingId)
          if (!opening) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          if (widthMm <= 0) return { success: false, errorCode: 'INVALID_WIDTH', messageRu: 'Ширина проёма должна быть положительной' }
          opening.widthMm = widthMm
          changedIds.push(`building.openings[${openingId}].widthMm`)
          break
        }
        case 'SET_OPENING_HEIGHT': {
          const { openingId, heightMm } = command.payload
          const opening = candidate.building.openings.find(o => o.id === openingId)
          if (!opening) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          if (heightMm <= 0) return { success: false, errorCode: 'INVALID_HEIGHT', messageRu: 'Высота проёма должна быть положительной' }
          // Keep a manually adjusted marker at the same relative height in its opening.
          const marker = candidate.building.markers.find(m => m.openingId === openingId)
          if (marker) marker.elevationMm += (heightMm - opening.heightMm) / 2
          opening.heightMm = heightMm
          changedIds.push(`building.openings[${openingId}].heightMm`)
          break
        }
        case 'SET_WINDOW_SILL_HEIGHT': {
          const { openingId, sillHeightMm } = command.payload
          const opening = candidate.building.openings.find(o => o.id === openingId)
          if (!opening) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          if (sillHeightMm < 0) return { success: false, errorCode: 'INVALID_SILL_HEIGHT', messageRu: 'Высота подоконника не может быть отрицательной' }
          // Move the marker vertically when the window sill moves.
          const marker = candidate.building.markers.find(m => m.openingId === openingId)
          if (marker) marker.elevationMm += sillHeightMm - opening.sillHeightMm
          opening.sillHeightMm = sillHeightMm
          changedIds.push(`building.openings[${openingId}].sillHeightMm`)
          break
        }
        case 'SET_MARKER_SETTINGS': {
          const { openingId, anchor, outsideOffsetMm, elevationMm, visible, color } = command.payload
          const marker = candidate.building.markers.find(m => m.openingId === openingId)
          if (!marker) return { success: false, errorCode: 'MARKER_NOT_FOUND', messageRu: `Маркер для проёма ${openingId} не найден` }
          if (anchor !== undefined) { marker.anchor = anchor; changedIds.push(`building.markers[${openingId}].anchor`) }
          if (outsideOffsetMm !== undefined) { marker.outsideOffsetMm = outsideOffsetMm; changedIds.push(`building.markers[${openingId}].outsideOffsetMm`) }
          if (elevationMm !== undefined) { marker.elevationMm = elevationMm; changedIds.push(`building.markers[${openingId}].elevationMm`) }
          if (visible !== undefined) { marker.visible = visible; changedIds.push(`building.markers[${openingId}].visible`) }
          if (color !== undefined) { marker.color = color; changedIds.push(`building.markers[${openingId}].color`) }
          break
        }
        case 'ADD_WALL': {
          if (candidate.building.closure) return { success: false,
            errorCode: 'CHAIN_ALREADY_CLOSED', messageRu: 'Сначала разомкните контур' }
          const wall = command.payload.wall
          if (candidate.building.walls.some(w => w.wallId === wall.wallId)) {
            return { success: false, errorCode: 'DUPLICATE_WALL_ID', messageRu: 'Такой ID стены уже существует' }
          }
          if (wall.openings.length !== 0) {
            return { success: false, errorCode: 'NEW_WALL_HAS_OPENINGS',
              messageRu: 'Проёмы добавляются отдельной командой' }
          }
          // Materialize the legacy implicit two-wall corner before the third
          // wall arrives; old saved JSON remains supported without rewriting.
          const oldLinks = effectiveConnections(candidate)
          if (!candidate.building.connections) candidate.building.connections = [...oldLinks]
          const chosen = command.payload.connection
          let connection = chosen
          if (!connection && candidate.building.walls.length === 1 &&
              candidate.building.walls[0].orientation === 'x' && wall.orientation === 'z') {
            const first = candidate.building.walls[0]
            const expected = rightCornerOrigin(first, wall)
            if ((['x', 'y', 'z'] as const).every(k => Math.abs(wall.origin[k] - expected[k]) < 0.01)) {
              connection = { fromWallId: first.wallId, toWallId: wall.wallId, type: 'california-right' }
            }
          }
          candidate.building.walls.push(this.deepClone(wall))
          if (connection) candidate.building.connections.push(this.deepClone(connection))
          changedIds.push('building.walls[' + wall.wallId + ']')
          if (connection) changedIds.push('building.connections')
          break
        }
        case 'CLOSE_CHAIN': {
          const preview = previewChainClosure(candidate)
          if (!preview.valid || !preview.direction) return { success: false,
            errorCode: 'CHAIN_CANNOT_CLOSE', messageRu: preview.reason }
          const walls = candidate.building.walls
          const last = walls[walls.length - 1]
          const first = walls[0]
          const next = Math.max(0, ...walls.map(w =>
            Number(w.wallId.split('-')[1] ?? 0))) + 1
          const wallId = 'wall-' + String(next).padStart(3, '0')
          const newWall: Wall = {
            ...last, wallId, orientation: preview.direction,
            lengthMm: preview.lengthMm, origin: wallEndPosition(last),
            sectionMm: { ...last.sectionMm }, openings: [],
          }
          const oldLinks = effectiveConnections(candidate)
          candidate.building.walls.push(newWall)
          candidate.building.connections = [...oldLinks, {
            fromWallId: last.wallId, toWallId: wallId, type: 'chain-turn-right',
          }]
          candidate.building.closure = {
            fromWallId: wallId, toWallId: first.wallId, type: 'butt-right',
          }
          changedIds.push('building.walls[' + wallId + ']', 'building.connections',
            'building.closure')
          break
        }
        case 'REOPEN_CHAIN': {
          if (!candidate.building.closure) return { success: false,
            errorCode: 'CHAIN_NOT_CLOSED', messageRu: 'Контур ещё не замкнут' }
          delete candidate.building.closure
          changedIds.push('building.closure')
          break
        }
        case 'REMOVE_WALL': {
          if (candidate.building.closure) return { success: false,
            errorCode: 'CHAIN_ALREADY_CLOSED', messageRu: 'Сначала разомкните контур' }
          const wallId = command.payload.wallId
          const index = candidate.building.walls.findIndex(w => w.wallId === wallId)
          if (index <= 0) {
            return { success: false, errorCode: 'WALL_NOT_REMOVABLE', messageRu: 'Первую стену удалить нельзя' }
          }
          const links = effectiveConnections(candidate)
          if (links.some(link => link.fromWallId === wallId)) {
            return { success: false, errorCode: 'WALL_HAS_CHILDREN',
              messageRu: 'Сначала удалите присоединённые к этой стене стены' }
          }
          if (candidate.building.openings.some(o => o.wallId === wallId)) {
            return { success: false, errorCode: 'WALL_HAS_OPENINGS',
              messageRu: 'Сначала удалите проёмы из стены' }
          }
          candidate.building.walls.splice(index, 1)
          candidate.building.connections = links.filter(link => link.toWallId !== wallId)
          changedIds.push('building.walls[' + wallId + ']', 'building.connections')
          break
        }
        case 'ADD_OPENING': {
          const { wallId, opening } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: `Стена ${wallId} не найдена` }
          // Check for duplicate ID
          if (candidate.building.openings.some(o => o.id === opening.id)) {
            return { success: false, errorCode: 'DUPLICATE_OPENING_ID', messageRu: `Проём с ID ${opening.id} уже существует` }
          }
          // Validate position
          if (opening.positionXmm < 0) return { success: false, errorCode: 'INVALID_POSITION', messageRu: 'Положение проёма не может быть отрицательным' }
          if (opening.positionXmm + opening.widthMm > wall.lengthMm) return { success: false, errorCode: 'OPENING_OUT_OF_BOUNDS', messageRu: 'Проём выходит за границы стены' }
          if (opening.widthMm <= 0) return { success: false, errorCode: 'INVALID_WIDTH', messageRu: 'Ширина проёма должна быть положительной' }
          if (opening.heightMm <= 0) return { success: false, errorCode: 'INVALID_HEIGHT', messageRu: 'Высота проёма должна быть положительной' }
          if (opening.sillHeightMm < 0) return { success: false, errorCode: 'INVALID_SILL_HEIGHT', messageRu: 'Высота подоконника не может быть отрицательной' }
          if (opening.sillHeightMm + opening.heightMm > wall.heightMm) return { success: false, errorCode: 'OPENING_TOO_TALL', messageRu: 'Проём слишком высокий для стены' }
          // Check framing overlap with existing openings
          const wallOpenings = candidate.building.openings.filter(o => o.wallId === wallId)
          const newFrameMin = opening.positionXmm - 90
          const newFrameMax = opening.positionXmm + opening.widthMm + 90
          for (const existing of wallOpenings) {
            const existingFrameMin = existing.positionUmm - 90
            const existingFrameMax = existing.positionUmm + existing.widthMm + 90
            if (newFrameMin < existingFrameMax && existingFrameMin < newFrameMax) {
              return { success: false, errorCode: 'OPENINGS_FRAME_OVERLAP', messageRu: 'Недостаточно места между проёмами для рамы' }
            }
          }
          // Store the canonical Opening shape: do not leak editor-only
          // 'positionXmm' into the JSON source model.
          candidate.building.openings.push({
            id: opening.id, wallId, type: opening.type,
            positionUmm: opening.positionXmm, widthMm: opening.widthMm,
            heightMm: opening.heightMm, sillHeightMm: opening.sillHeightMm,
            ...(opening.garage ? { garage: this.deepClone(opening.garage) } : {}),
          })
          wall.openings.push(opening.id)
          // Add marker for new opening
          candidate.building.markers.push({
            openingId: opening.id,
            anchor: 'center',
            outsideOffsetMm: 50,
            elevationMm: opening.sillHeightMm + opening.heightMm / 2,
            visible: true,
            color: '#0066ff',
          })
          changedIds.push(`building.openings[${opening.id}]`)
          changedIds.push(`building.walls[${wallId}].openings`)
          changedIds.push(`building.markers[${opening.id}]`)
          break
        }
        case 'REMOVE_OPENING': {
          const { openingId } = command.payload
          const openingIndex = candidate.building.openings.findIndex(o => o.id === openingId)
          if (openingIndex === -1) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          const opening = candidate.building.openings[openingIndex]
          const wall = candidate.building.walls.find(w => w.wallId === opening.wallId)
          if (wall) {
            wall.openings = wall.openings.filter(id => id !== openingId)
          }
          candidate.building.openings.splice(openingIndex, 1)
          // Remove marker
          const markerIndex = candidate.building.markers.findIndex(m => m.openingId === openingId)
          if (markerIndex !== -1) {
            candidate.building.markers.splice(markerIndex, 1)
          }
          changedIds.push(`building.openings[${openingId}]`)
          if (wall) changedIds.push(`building.walls[${wall.wallId}].openings`)
          changedIds.push(`building.markers[${openingId}]`)
          break
        }
        case 'REPLACE_PROJECT': {
          // Directly apply the document without going through command system again
          const candidate = this.deepClone(command.payload.document)
          const changedIds = ['building.openings']
          
          // Validate source parameters including geometry
          const structValidation = validateSourceParameters(candidate)
          if (structValidation.some(i => i.severity === 'error')) {
            const errors = structValidation.filter(i => i.severity === 'error')
            return { success: false, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation: { valid: false, issues: structValidation, engineeringStatus: 'not_evaluated' } }
          }

          let rebuilt: ProjectDocument
          try {
            rebuilt = buildProjectSnapshot(candidate)
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            return { success: false, errorCode: 'VALIDATION_FAILED', messageRu: `Ошибка генерации: ${error}`, validation: { valid: false, issues: [{ code: 'GENERATION_ERROR', severity: 'error', path: '', messageRu: error, affectedIds: [] }], engineeringStatus: 'not_evaluated' } }
          }
          const validation = validateProjectSnapshot(rebuilt)

          if (!validation.valid) {
            const errors = validation.issues.filter(i => i.severity === 'error')
            return { success: false, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation }
          }

          return { success: true, document: rebuilt, changedIds, validation }
        }
        default:
          return { success: false, errorCode: 'UNKNOWN_COMMAND', messageRu: 'Неизвестная команда' }
      }

      // First validate the candidate source parameters before building
      const structValidation = validateSourceParameters(candidate)
      if (structValidation.some(i => i.severity === 'error')) {
        const errors = structValidation.filter(i => i.severity === 'error')
        return { success: false, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation: { valid: false, issues: structValidation, engineeringStatus: 'not_evaluated' } }
      }

      let rebuilt: ProjectDocument
      try {
        rebuilt = buildProjectSnapshot(candidate)
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return { success: false, errorCode: 'VALIDATION_FAILED', messageRu: `Ошибка генерации: ${error}`, validation: { valid: false, issues: [{ code: 'GENERATION_ERROR', severity: 'error', path: '', messageRu: error, affectedIds: [] }], engineeringStatus: 'not_evaluated' } }
      }
      const validation = validateProjectSnapshot(rebuilt)

      if (!validation.valid) {
        const errors = validation.issues.filter(i => i.severity === 'error')
        return { success: false, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation }
      }

      return { success: true, document: rebuilt, changedIds, validation }
    } catch (e) {
      return { success: false, errorCode: 'INTERNAL_ERROR', messageRu: e instanceof Error ? e.message : 'Внутренняя ошибка' }
    }
  }

  exportJson(): string {
    return serializeProject(this.document)
  }

  importJson(json: string): CommandResult {
    try {
      const parsed = migrateLegacyWallOrigins(JSON.parse(json) as ProjectDocument)
      // A saved generated assembly may be stale (including old California
      // corner coordinates). Validate author-controlled source first; then
      // regenerate and validate the actual resulting assembly.
      const sourceIssues = validateSourceParameters(parsed)
      if (sourceIssues.some(i => i.severity === 'error')) {
        const errors = sourceIssues.filter(i => i.severity === 'error')
        return { success: false, revision: this.revision, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation: { valid: false, issues: sourceIssues, engineeringStatus: 'not_evaluated' } }
      }
      let rebuilt: ProjectDocument
      try {
        rebuilt = buildProjectSnapshot(migrateLegacyWallOrigins(parsed as ProjectDocument))
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return { success: false, revision: this.revision, errorCode: 'VALIDATION_FAILED', messageRu: `Ошибка генерации при импорте: ${error}`, validation: { valid: false, issues: [{ code: 'GENERATION_ERROR', severity: 'error', path: '', messageRu: error, affectedIds: [] }], engineeringStatus: 'not_evaluated' } }
      }
      const rebuildValidation = validateProjectSnapshot(rebuilt)
      if (!rebuildValidation.valid) {
        const errors = rebuildValidation.issues.filter(i => i.severity === 'error')
        return { success: false, revision: this.revision, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации после пересчёта', validation: rebuildValidation }
      }
      this.document = this.deepFreeze(this.deepClone(rebuilt))
      this.addToHistory(this.document, { type: 'REPLACE_PROJECT', payload: { document: this.deepClone(this.document) } })
      this.notifySubscribers()
      return { success: true, revision: this.revision, validation: rebuildValidation }
    } catch (e) {
      return { success: false, revision: this.revision, errorCode: 'INVALID_JSON', messageRu: e instanceof SyntaxError ? 'Синтаксическая ошибка JSON' : 'Ошибка импорта', validation: undefined }
    }
  }
}

export function createProjectStore(initialDocument: ProjectDocument): ProjectStore {
  return new ProjectStore(initialDocument)
}