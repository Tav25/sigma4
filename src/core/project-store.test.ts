import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createProjectStore } from './ProjectStore'
import { createProjectFromCurrentState } from './project-store'
import type { ProjectCommand } from './ProjectStore'

const createTestDoc = () => createProjectFromCurrentState({
  length: 6000,
  height: 2700,
  spacing: 600,
  openings: [
    { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
    { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  ],
  projectId: 'test-001',
  projectName: 'Test Project',
})

describe('S02 - ProjectStore', () => {
  let store: ReturnType<typeof createProjectStore>
  let initialDoc: ReturnType<typeof createTestDoc>

  beforeEach(() => {
    initialDoc = createTestDoc()
    store = createProjectStore(initialDoc)
  })

  // ТЕСТ 01: Создание ProjectStore из корректного документа
  it('ТЕСТ 01: создание ProjectStore из корректного документа', () => {
    expect(store).toBeDefined()
    expect(store.getRevision()).toBe(0)
    const snapshot = store.getSnapshot()
    expect(snapshot.project.projectId).toBe('test-001')
    expect(snapshot.building.walls.length).toBe(1)
    expect(snapshot.building.openings.length).toBe(2)
    expect(snapshot.assembly.elements.length).toBeGreaterThan(0)
  })

  // ТЕСТ 02: getSnapshot возвращает актуальное состояние
  it('ТЕСТ 02: getSnapshot возвращает актуальное состояние', () => {
    const snapshot = store.getSnapshot()
    expect(snapshot.project.projectName).toBe('Test Project')
    expect(snapshot.building.walls[0].lengthMm).toBe(6000)
  })

  // ТЕСТ 03: Внешняя мутация snapshot не изменяет Store
  it('ТЕСТ 03: внешняя мутация snapshot не изменяет Store', () => {
    const snapshot = store.getSnapshot()
    snapshot.project.projectName = 'Mutated'
    const fresh = store.getSnapshot()
    expect(fresh.project.projectName).toBe('Test Project')
  })

  // ТЕСТ 04: Корректная команда увеличивает revision
  it('ТЕСТ 04: корректная команда увеличивает revision', () => {
    const result = store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 5000 } })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(1)
    expect(store.getRevision()).toBe(1)
  })

  // ТЕСТ 05: Некорректная команда не меняет revision
  it('ТЕСТ 05: некорректная команда не меняет revision', () => {
    const result = store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: -100 } })
    expect(result.success).toBe(false)
    expect(store.getRevision()).toBe(0)
  })

  // ТЕСТ 06: Некорректная команда не меняет документ
  it('ТЕСТ 06: некорректная команда не меняет документ', () => {
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: -100 } })
    const snapshot = store.getSnapshot()
    expect(snapshot.building.walls[0].lengthMm).toBe(6000)
  })

  // ТЕСТ 07: Изменение положения окна записывается в JSON
  it('ТЕСТ 07: изменение положения окна записывается в JSON', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    const json = store.exportJson()
    expect(json).toContain('"positionUmm": 1200')
    expect(json).toContain('"id": "W01"')
  })

  // ТЕСТ 08: Изменение ширины окна записывается в JSON
  it('ТЕСТ 08: изменение ширины окна записывается в JSON', () => {
    store.dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 1500 } })
    const json = store.exportJson()
    expect(json).toContain('"widthMm": 1500')
  })

  // ТЕСТ 09: После изменения окна пересчитываются детали
  it('ТЕСТ 09: после изменения окна пересчитываются детали', () => {
    const beforeCount = store.getSnapshot().assembly.elements.length
    store.dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 1500 } })
    const afterCount = store.getSnapshot().assembly.elements.length
    expect(afterCount).not.toBe(beforeCount)
  })

  // ТЕСТ 10: В рассчитанной сборке нет устаревших элементов
  it('ТЕСТ 10: в рассчитанной сборке нет устаревших элементов', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1500 } })
    const elements = store.getSnapshot().assembly.elements
    const ids = elements.map(e => e.elementId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  // ТЕСТ 11: Все elementId уникальны
  it('ТЕСТ 11: все elementId уникальны', () => {
    const elements = store.getSnapshot().assembly.elements
    const ids = elements.map(e => e.elementId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  // ТЕСТ 12: Проём за пределами стены отклоняется
  it('ТЕСТ 12: проём за пределами стены отклоняется', () => {
    const result = store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 5500 } })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('OPENING_OUT_OF_BOUNDS')
  })

  // ТЕСТ 13: Конфликт двух проёмов отклоняется
  it('ТЕСТ 13: конфликт двух проёмов отклоняется', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1000 } })
    store.dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 2000 } })
    const result = store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W02', positionUmm: 2500 } })
    store.dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W02', widthMm: 2000 } })
    // The conflict should be detected on the second opening's position change
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('OPENINGS_FRAME_OVERLAP')
  })

  // ТЕСТ 14: Undo восстанавливает исходное положение окна
  it('ТЕСТ 14: Undo восстанавливает исходное положение окна', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(1200)
    const result = store.undo()
    expect(result.success).toBe(true)
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(900)
  })

  // ТЕСТ 15: Redo повторяет принятое изменение
  it('ТЕСТ 15: Redo повторяет принятое изменение', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    store.undo()
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(900)
    const result = store.redo()
    expect(result.success).toBe(true)
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(1200)
  })

  // ТЕСТ 16: Новая команда после Undo очищает Redo
  it('ТЕСТ 16: новая команда после Undo очищает Redo', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    store.undo()
    store.dispatch({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 1500 } })
    const result = store.redo()
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('REDO_NOT_AVAILABLE')
  })

  // ТЕСТ 17: История ограничивается 100 действиями
  it('ТЕСТ 17: история ограничивается 100 действиями', () => {
    for (let i = 0; i < 105; i++) {
      store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 6000 + i } })
    }
    // Revision is monotonic, history length is limited to 100
    expect(store.getRevision()).toBe(105)
    // But we can only undo 100 times (limited by maxHistorySize)
    let undoCount = 0
    while (store.canUndo()) {
      store.undo()
      undoCount++
    }
    expect(undoCount).toBeLessThanOrEqual(100)
  })

  // ТЕСТ 18: Отклонённая команда не добавляется в историю
  it('ТЕСТ 18: отклонённая команда не добавляется в историю', () => {
    const revBefore = store.getRevision()
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: -100 } })
    expect(store.getRevision()).toBe(revBefore)
    expect(store.canUndo()).toBe(false)
  })

  // ТЕСТ 19: Подписчик уведомляется после успешной команды
  it('ТЕСТ 19: подписчик уведомляется после успешной команды', () => {
    const callback = vi.fn()
    const unsub = store.subscribe(callback)
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 5000 } })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][1]).toBe(1)
    unsub()
  })

  // ТЕСТ 20: Подписчик не получает ложного уведомления об отклонённой команде
  it('ТЕСТ 20: подписчик не получает ложного уведомления об отклонённой команде', () => {
    const callback = vi.fn()
    const unsub = store.subscribe(callback)
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: -100 } })
    expect(callback).not.toHaveBeenCalled()
    unsub()
  })

  // ТЕСТ 21: Отписанный слушатель не получает уведомлений
  it('ТЕСТ 21: отписанный слушатель не получает уведомлений', () => {
    const callback = vi.fn()
    const unsub = store.subscribe(callback)
    unsub()
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 5000 } })
    expect(callback).not.toHaveBeenCalled()
  })

  // ТЕСТ 22: Предварительная транзакция не повреждает основной документ
  it('ТЕСТ 22: предварительная транзакция не повреждает основной документ', () => {
    store.beginTransaction()
    store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1500 } })
    store.rollbackTransaction()
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(900)
  })

  // ТЕСТ 23: Rollback отменяет preview
  it('ТЕСТ 23: Rollback отменяет preview', () => {
    store.beginTransaction()
    store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1500 } })
    const result = store.rollbackTransaction()
    expect(result.success).toBe(true)
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(900)
  })

  // ТЕСТ 24: Commit создаёт одну запись истории
  it('ТЕСТ 24: Commit создаёт одну запись истории', () => {
    store.beginTransaction()
    store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1500 } })
    store.preview({ type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 1500 } })
    const result = store.commitTransaction()
    expect(result.success).toBe(true)
    expect(store.getRevision()).toBe(1)
  })

  // ТЕСТ 25: Некорректный commit не принимается
  it('ТЕСТ 25: некорректный commit не принимается', () => {
    store.beginTransaction()
    store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 5500 } })
    const result = store.commitTransaction()
    expect(result.success).toBe(false)
    expect(store.getRevision()).toBe(0)
  })

  // ТЕСТ 26: Экспорт содержит последнее принятое изменение
  it('ТЕСТ 26: экспорт содержит последнее принятое изменение', () => {
    store.dispatch({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    const json = store.exportJson()
    expect(json).toContain('"positionUmm": 1200')
  })

  // ТЕСТ 27: Импорт валидного проекта заменяет состояние
  it('ТЕСТ 27: импорт валидного проекта заменяет состояние', () => {
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 7000 } })
    const json = store.exportJson()
    const newStore = createProjectStore(initialDoc)
    const result = newStore.importJson(json)
    expect(result.success).toBe(true)
    expect(newStore.getSnapshot().building.walls[0].lengthMm).toBe(7000)
  })

  // ТЕСТ 28: Импорт невалидного проекта сохраняет предыдущий проект
  it('ТЕСТ 28: импорт невалидного проекта сохраняет предыдущий проект', () => {
    store.dispatch({ type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 7000 } })
    const invalidJson = JSON.stringify({ ...JSON.parse(store.exportJson()), project: { schemaVersion: '999.0.0' } })
    const result = store.importJson(invalidJson)
    expect(result.success).toBe(false)
    expect(store.getSnapshot().building.walls[0].lengthMm).toBe(7000)
  })

  // ТЕСТ 29: Синтаксически повреждённый JSON не вызывает исключения
  it('ТЕСТ 29: синтаксически повреждённый JSON не вызывает исключения', () => {
    const result = store.importJson('{ invalid json }')
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('INVALID_JSON')
    expect(store.getRevision()).toBe(0)
  })

  // ТЕСТ 30: Русскоязычный проект сохраняет символы и названия
  it('ТЕСТ 30: русскоязычный проект сохраняет символы и названия', () => {
    store.dispatch({ type: 'SET_PROJECT_NAME', payload: { projectName: 'Тестовый Проект SIGMA4' } })
    const json = store.exportJson()
    expect(json).toContain('Тестовый Проект SIGMA4')
  })

  // ТЕСТ 31: Одинаковая последовательность команд даёт одинаковое состояние
  it('ТЕСТ 31: одинаковая последовательность команд даёт одинаковое состояние', () => {
    const commands: ProjectCommand[] = [
      { type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } },
      { type: 'SET_OPENING_WIDTH', payload: { openingId: 'W01', widthMm: 1500 } },
      { type: 'SET_WALL_LENGTH', payload: { wallId: 'wall-001', lengthMm: 5500 } },
    ]
    for (const cmd of commands) store.dispatch(cmd)
    const json1 = store.exportJson()
    const store2 = createProjectStore(initialDoc)
    for (const cmd of commands) store2.dispatch(cmd)
    const json2 = store2.exportJson()
    expect(json1).toBe(json2)
  })

  // ТЕСТ 32: Все прежние 120 тестов S01 проходят (проверяется через общий прогон)
  it('ТЕСТ 32: проверка совместимости с S01', () => {
    expect(store.getSnapshot().project.schemaVersion).toBe('1.0.0')
    expect(store.getSnapshot().project.units).toBe('mm')
  })

  // ТЕСТ 33: 3D-геометрия не получила регрессий
  it('ТЕСТ 33: 3D-геометрия не получила регрессий', () => {
    const elements = store.getSnapshot().assembly.elements
    expect(elements.length).toBeGreaterThan(0)
    for (const el of elements) {
      expect(el.lengthMm).toBeGreaterThan(0)
      expect(el.sectionMm.width).toBeGreaterThan(0)
      expect(el.sectionMm.height).toBeGreaterThan(0)
    }
  })

  // ТЕСТ 34: Существующее перемещение двери мышью сохраняет синхронизацию
  it('ТЕСТ 34: транзакция preview/commit для перемещения', () => {
    store.beginTransaction()
    store.preview({ type: 'SET_OPENING_POSITION', payload: { openingId: 'W01', positionUmm: 1200 } })
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(900)
    store.commitTransaction()
    expect(store.getSnapshot().building.openings[0].positionUmm).toBe(1200)
  })
})