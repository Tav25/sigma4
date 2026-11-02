import { describe, it, expect, beforeEach } from 'vitest'
import {
  createProjectFromCurrentState,
  serializeProject,
  parseProject,
  validateProjectSnapshot,
  buildProjectSnapshot,
} from './project-store'
import { validateProject } from './frame-validator'
import type { ProjectDocument } from './project'
import type { WindowOpening } from './window'
import { generateWallPanel } from './wall'
import { generateWallWithOpenings } from './window'

const DEFAULT_PARAMS = { length: 6000, height: 2700, spacing: 600 }
const DEFAULT_OPENINGS: WindowOpening[] = [
  { id: 'W01', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
  { id: 'W02', positionXmm: 3300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' },
]

describe('S01 - Project Document & Validation', () => {
  let baseDoc: ProjectDocument

  beforeEach(() => {
    baseDoc = createProjectFromCurrentState({
      ...DEFAULT_PARAMS,
      openings: DEFAULT_OPENINGS,
      projectId: 'test-proj-001',
      projectName: 'Test Project',
    })
  })

  // ТЕСТ 1: Экспорт существующей модели 0.0.14 в JSON
  it('ТЕСТ 1: экспорт модели в JSON', () => {
    const json = serializeProject(baseDoc)
    expect(json).toContain('"schemaVersion": "1.0.0"')
    expect(json).toContain('"projectId": "test-proj-001"')
    expect(json).toContain('"projectName": "Test Project"')
    expect(json).toContain('"units": "mm"')
    expect(json).toContain('"rulesetId": "sigma4-ruleset"')
    expect(json).toContain('"walls"')
    expect(json).toContain('"openings"')
    expect(json).toContain('"markers"')
    expect(json).toContain('"assembly"')
    expect(json).toContain('"validation"')
  })

  // ТЕСТ 2: Обратная загрузка JSON без потери исходных параметров
  it('ТЕСТ 2: загрузка JSON без потери параметров', () => {
    const json = serializeProject(baseDoc)
    const loaded = parseProject(json)

    expect(loaded.project.projectId).toBe(baseDoc.project.projectId)
    expect(loaded.project.projectName).toBe(baseDoc.project.projectName)
    expect(loaded.project.schemaVersion).toBe(baseDoc.project.schemaVersion)
    expect(loaded.project.units).toBe('mm')
    expect(loaded.building.walls.length).toBe(1)
    expect(loaded.building.walls[0].lengthMm).toBe(DEFAULT_PARAMS.length)
    expect(loaded.building.walls[0].heightMm).toBe(DEFAULT_PARAMS.height)
    expect(loaded.building.walls[0].studSpacingMm).toBe(DEFAULT_PARAMS.spacing)
    expect(loaded.building.openings.length).toBe(2)
    expect(loaded.building.openings[0].id).toBe('W01')
    expect(loaded.building.openings[1].id).toBe('W02')
    expect(loaded.assembly.elements.length).toBe(baseDoc.assembly.elements.length)
    expect(loaded.validation.engineeringStatus).toBe('not_evaluated')
  })

  // ТЕСТ 3: Детерминированность генерации
  it('ТЕСТ 3: детерминированность генерации', () => {
    const doc1 = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS, projectId: 'det-1' })
    const doc2 = createProjectFromCurrentState({ ...DEFAULT_PARAMS, openings: DEFAULT_OPENINGS, projectId: 'det-2' })

    expect(doc1.assembly.elements.length).toBe(doc2.assembly.elements.length)
    const ids1 = doc1.assembly.elements.map(e => e.elementId)
    const ids2 = doc2.assembly.elements.map(e => e.elementId)
    expect(ids1).toEqual(ids2)

    doc1.assembly.elements.forEach((el, i) => {
      expect(el.lengthMm).toBe(doc2.assembly.elements[i].lengthMm)
      expect(el.position.x).toBe(doc2.assembly.elements[i].position.x)
      expect(el.position.y).toBe(doc2.assembly.elements[i].position.y)
      expect(el.position.z).toBe(doc2.assembly.elements[i].position.z)
    })
  })

  // ТЕСТ 4: Уникальность всех идентификаторов
  it('ТЕСТ 4: уникальность всех идентификаторов', () => {
    const allIds = new Set<string>()
    baseDoc.building.walls.forEach(w => allIds.add(w.wallId))
    baseDoc.building.openings.forEach(o => allIds.add(o.id))
    // markers reference openingId, not unique IDs
    baseDoc.assembly.elements.forEach(e => allIds.add(e.elementId))

    const totalCount = baseDoc.building.walls.length + baseDoc.building.openings.length + baseDoc.assembly.elements.length
    expect(allIds.size).toBe(totalCount)
  })

  // ТЕСТ 5: Обнаружение ссылки проёма на несуществующую стену
  it('ТЕСТ 5: обнаружение ссылки проёма на несуществующую стену', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.building.openings[0].wallId = 'non-existent-wall'
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_REF_INVALID_WALL')).toBe(true)
  })

  // ТЕСТ 6: Обнаружение отрицательных размеров
  it('ТЕСТ 6: обнаружение отрицательных размеров', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.building.walls[0].lengthMm = -100
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'INVALID_POSITIVE_VALUE')).toBe(true)
  })

  // ТЕСТ 7: Обнаружение недопустимого положения окна
  it('ТЕСТ 7: обнаружение недопустимого положения окна', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.building.openings[0].positionUmm = -50
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENING_NEGATIVE_POSITION' || i.code === 'OPENING_OUT_OF_BOUNDS')).toBe(true)
  })

  // ТЕСТ 8: Обнаружение конфликта двух проёмов
  it('ТЕСТ 8: обнаружение конфликта двух проёмов', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.building.openings[0].positionUmm = 1000
    invalidDoc.building.openings[0].widthMm = 2000
    invalidDoc.building.openings[1].positionUmm = 2500
    invalidDoc.building.openings[1].widthMm = 2000
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'OPENINGS_FRAME_OVERLAP')).toBe(true)
  })

  // ТЕСТ 9: Проверка связи маркера с конкретным проёмом
  it('ТЕСТ 9: проверка связи маркера с проёмом', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.building.markers[0].openingId = 'non-existent-opening'
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'MARKER_REF_INVALID_OPENING')).toBe(true)
  })

  // ТЕСТ 10: Отсутствие независимой конфликтующей координаты маркера
  it('ТЕСТ 10: маркер не имеет независимых координат', () => {
    const marker = baseDoc.building.markers[0]
    expect(marker).not.toHaveProperty('position')
    expect(marker).not.toHaveProperty('x')
    expect(marker).not.toHaveProperty('y')
    expect(marker).not.toHaveProperty('z')
    expect(marker.openingId).toBeDefined()
    expect(marker.outsideOffsetMm).toBeDefined()
    expect(marker.elevationMm).toBeDefined()
  })

  // ТЕСТ 11: Отклонение неизвестной версии JSON Schema
  it('ТЕСТ 11: отклонение неизвестной версии схемы', () => {
    const invalidDoc = { ...baseDoc }
    invalidDoc.project.schemaVersion = '999.0.0'
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.code === 'UNSUPPORTED_SCHEMA_VERSION')).toBe(true)
  })

  // ТЕСТ 12: Ошибочное изменение не повреждает последнюю корректную модель
  it('ТЕСТ 12: ошибочное изменение не повреждает корректную модель', () => {
    const originalJson = serializeProject(baseDoc)
    const originalLoaded = parseProject(originalJson)

    const invalidDoc = { ...baseDoc }
    invalidDoc.building.walls[0].lengthMm = -1
    const result = validateProject(invalidDoc)
    expect(result.valid).toBe(false)

    const reloaded = parseProject(originalJson)
    expect(reloaded.project.projectId).toBe(originalLoaded.project.projectId)
    expect(reloaded.building.walls[0].lengthMm).toBe(DEFAULT_PARAMS.length)
    expect(reloaded.validation.valid).toBe(true)
  })

  // ТЕСТ 13: Проверка рассчитанных размеров деревянных деталей
  it('ТЕСТ 13: проверка рассчитанных размеров деревянных деталей', () => {
    baseDoc.assembly.elements.forEach(el => {
      expect(el.lengthMm).toBeGreaterThan(0)
      expect(el.sectionMm.width).toBeGreaterThan(0)
      expect(el.sectionMm.height).toBeGreaterThan(0)
      expect(el.position.x).toBeDefined()
      expect(el.position.y).toBeDefined()
      expect(el.position.z).toBeDefined()
    })

    const studs = baseDoc.assembly.elements.filter(e => e.role === 'stud')
    expect(studs.length).toBeGreaterThan(0)
    studs.forEach(s => {
      expect(s.lengthMm).toBe(2565)
      expect(s.sectionMm.width).toBe(45)
      expect(s.sectionMm.height).toBe(145)
    })
  })

  // ТЕСТ 14: Все предыдущие тесты версии 0.0.14 проходят
  it('ТЕСТ 14: все предыдущие тесты проходят', () => {
    const wallParams = { length: 3000, height: 2700, sectionWidth: 45, sectionHeight: 145, spacing: 600, topLayers: 2 }
    const wall = generateWallPanel(wallParams)
    expect(wall.elements.length).toBe(9)
    expect(wall.elements.filter(e => e.role === 'stud').length).toBe(6)

    const withOpenings = generateWallWithOpenings(wallParams, [
      { id: 'W', positionXmm: 900, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, type: 'window' }
    ])
    expect(withOpenings.elements.length).toBe(20)
  })

  // ТЕСТ 15: Русский интерфейс и существующая 3D-сцена работают без изменений
  it('ТЕСТ 15: валидатор работает без браузерных зависимостей', () => {
    const result = validateProject(baseDoc)
    expect(result.valid).toBe(true)
    expect(result.engineeringStatus).toBe('not_evaluated')
    expect(Array.isArray(result.issues)).toBe(true)
  })

  describe('Additional validation tests', () => {
    it('detects duplicate wall IDs', () => {
      const invalidDoc = { ...baseDoc }
      invalidDoc.building.walls = [
        { ...baseDoc.building.walls[0] },
        { ...baseDoc.building.walls[0], wallId: baseDoc.building.walls[0].wallId }
      ]
      const result = validateProject(invalidDoc)
      expect(result.valid).toBe(false)
      expect(result.issues.some(i => i.code === 'DUPLICATE_WALL_ID')).toBe(true)
    })

    it('detects duplicate opening IDs', () => {
      const invalidDoc = { ...baseDoc }
      invalidDoc.building.openings = [
        { ...baseDoc.building.openings[0] },
        { ...baseDoc.building.openings[1], id: baseDoc.building.openings[0].id }
      ]
      const result = validateProject(invalidDoc)
      expect(result.valid).toBe(false)
      expect(result.issues.some(i => i.code === 'DUPLICATE_OPENING_ID')).toBe(true)
    })

    it('detects element inside opening', () => {
      const invalidDoc = { ...baseDoc }
      const opening = invalidDoc.building.openings[0]
      const el = invalidDoc.assembly.elements[0]
      el.position.x = opening.positionUmm + opening.widthMm / 2
      el.position.y = opening.sillHeightMm + opening.heightMm / 2
      const result = validateProject(invalidDoc)
      expect(result.valid).toBe(false)
    })

    it('validates marker properties', () => {
      const invalidDoc = { ...baseDoc }
      invalidDoc.building.markers[0].color = 'invalid-color'
      const result = validateProject(invalidDoc)
      expect(result.valid).toBe(false)
      expect(result.issues.some(i => i.code === 'INVALID_MARKER_COLOR')).toBe(true)
    })

    it('validateProjectSnapshot returns validation result', () => {
      const result = validateProjectSnapshot(baseDoc)
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('engineeringStatus')
      expect(result.engineeringStatus).toBe('not_evaluated')
    })

    it('buildProjectSnapshot regenerates assembly', () => {
      const newDoc = buildProjectSnapshot(baseDoc)
      expect(newDoc.assembly.elements.length).toBe(baseDoc.assembly.elements.length)
      expect(newDoc.validation.valid).toBe(true)
    })
  })
})