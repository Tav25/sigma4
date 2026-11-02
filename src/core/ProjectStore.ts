import type {
  ProjectDocument,
  ValidationResult,
} from './project'
import { validateProject, validateProjectSnapshot, validateSourceParameters } from './frame-validator'
import { buildProjectSnapshot, serializeProject } from './project-store'

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
}

type Subscriber = (document: ProjectDocument, revision: number) => void

export class ProjectStore {
  private document: ProjectDocument
  private revision: number = 0
  private history: HistoryEntry[] = []
  private historyIndex: number = 0
  private maxHistorySize: number = 100
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
    }
    this.historyIndex = Math.min(this.historyIndex, this.history.length - 1)
  }

  private addToHistory(doc: ProjectDocument, command: ProjectCommand): void {
    this.revision++
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push({ document: this.deepClone(doc), revision: this.revision, command })
    this.trimHistory()
  }

  private notifySubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber(this.document, this.revision)
    }
  }

  getSnapshot(): ProjectDocument {
    return this.deepClone(this.document)
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
    if (!this.canUndo()) {
      return { success: false, revision: this.revision, errorCode: 'UNDO_NOT_AVAILABLE', messageRu: 'Отмена недоступна' }
    }
    this.historyIndex--
    const entry = this.history[this.historyIndex]
    this.document = this.deepFreeze(this.deepClone(entry.document))
    this.revision = entry.revision
    this.notifySubscribers()
    return { success: true, revision: this.revision }
  }

  redo(): CommandResult {
    if (!this.canRedo()) {
      return { success: false, revision: this.revision, errorCode: 'REDO_NOT_AVAILABLE', messageRu: 'Повтор недоступен' }
    }
    this.historyIndex++
    const entry = this.history[this.historyIndex]
    this.document = this.deepFreeze(this.deepClone(entry.document))
    this.revision = entry.revision
    this.notifySubscribers()
    return { success: true, revision: this.revision }
  }

  beginTransaction(): boolean {
    if (this.transaction !== null) return false
    this.transaction = {
      active: true,
      baseDocument: this.deepClone(this.document),
      previewDocument: this.deepClone(this.document),
    }
    return true
  }

  preview(command: ProjectCommand): CommandResult {
    if (!this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'NO_ACTIVE_TRANSACTION', messageRu: 'Нет активной транзакции' }
    }

    const candidate = this.applyCommand(this.transaction.previewDocument, command)
    if (!candidate.success) {
      return { success: false, revision: this.revision, errorCode: candidate.errorCode, messageRu: candidate.messageRu, validation: candidate.validation }
    }

    this.transaction.previewDocument = candidate.document!
    return { success: true, revision: this.revision, changedIds: candidate.changedIds, validation: candidate.validation }
  }

  commitTransaction(): CommandResult {
    if (!this.transaction) {
      return { success: false, revision: this.revision, errorCode: 'NO_ACTIVE_TRANSACTION', messageRu: 'Нет активной транзакции' }
    }

    // Apply the final preview document directly
    this.document = this.deepFreeze(this.deepClone(this.transaction.previewDocument))
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

    this.document = candidate.document!
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
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: `Стена ${wallId} не найдена` }
          if (lengthMm <= 0) return { success: false, errorCode: 'INVALID_LENGTH', messageRu: 'Длина стены должна быть положительной' }
          wall.lengthMm = lengthMm
          changedIds.push(`building.walls[${wallId}].lengthMm`)
          break
        }
        case 'SET_WALL_HEIGHT': {
          const { wallId, heightMm } = command.payload
          const wall = candidate.building.walls.find(w => w.wallId === wallId)
          if (!wall) return { success: false, errorCode: 'WALL_NOT_FOUND', messageRu: `Стена ${wallId} не найдена` }
          if (heightMm <= 0) return { success: false, errorCode: 'INVALID_HEIGHT', messageRu: 'Высота стены должна быть положительной' }
          wall.heightMm = heightMm
          changedIds.push(`building.walls[${wallId}].heightMm`)
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
          opening.heightMm = heightMm
          changedIds.push(`building.openings[${openingId}].heightMm`)
          break
        }
        case 'SET_WINDOW_SILL_HEIGHT': {
          const { openingId, sillHeightMm } = command.payload
          const opening = candidate.building.openings.find(o => o.id === openingId)
          if (!opening) return { success: false, errorCode: 'OPENING_NOT_FOUND', messageRu: `Проём ${openingId} не найден` }
          if (sillHeightMm < 0) return { success: false, errorCode: 'INVALID_SILL_HEIGHT', messageRu: 'Высота подоконника не может быть отрицательной' }
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
        case 'REPLACE_PROJECT': {
          return this.applyCommand(doc, { type: 'REPLACE_PROJECT', payload: { document: command.payload.document } })
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
      const parsed = JSON.parse(json)
      const validation = validateProject(parsed)
      if (!validation.valid) {
        const errors = validation.issues.filter(i => i.severity === 'error')
        return { success: false, revision: this.revision, errorCode: errors[0]?.code || 'VALIDATION_FAILED', messageRu: errors[0]?.messageRu || 'Ошибка валидации', validation }
      }
      let rebuilt: ProjectDocument
      try {
        rebuilt = buildProjectSnapshot(parsed as ProjectDocument)
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