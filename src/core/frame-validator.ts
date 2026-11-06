import type {
  ProjectDocument,
  ValidationResult,
  ValidationIssue,
  Opening,
} from './project'
import { canFitCornerFraming, rightCornerOrigin } from './corner'
import { effectiveConnections, validateWallTopology } from './wall-topology'
import { validateGarageOpening, garageEngineeringNotices } from './garage-door'
import { validateOpeningHeaderInputs, verifyOpeningFraming, verifyHeaderLoadInputs } from './opening-profiles'
import { wallMidplaneOrigin } from './world-origin'
import { validateFloorPlan } from './floor-plan'
import { perimeterCorners, projectPlanFrame, validatePlanFrame } from './plan-frame'
import { isPartitionWall } from './partition-layout'

const SUPPORTED_SCHEMA_VERSIONS = ['1.0.0', '1.1.0']
const SUPPORTED_RULESET_VERSIONS = ['1.0.0']
const SUPPORTED_GENERATOR_VERSIONS = ['1.0.0']

const REQUIRED_ROLES = ['stud', 'king-stud', 'jack-stud', 'cripple-stud', 'cripple-bottom', 'cripple-top', 'bottom-plate', 'top-plate', 'header', 'sill', 'corner-backing', 'garage-lintel-preview'] as const

function createIssue(
  code: string,
  severity: 'error' | 'warning' | 'info',
  path: string,
  messageRu: string,
  affectedIds: string[]
): ValidationIssue {
  return { code, severity, path, messageRu, affectedIds }
}

function checkPositive(
  val: any,
  field: string,
  label: string,
  gender: 'm' | 'f' | 'n' = 'n',
  path: string,
  issues: ValidationIssue[],
  affectedIds: string[]
): boolean {
  if (typeof val !== 'number' || val <= 0) {
    const verb = gender === 'f' ? 'должна быть положительной' : gender === 'm' ? 'должен быть положительным' : 'должно быть положительным'
    issues.push(createIssue('INVALID_POSITIVE_VALUE', 'error', `${path}.${field}`, `${label} ${verb}`, affectedIds))
    return true
  }
  return false
}

function checkNonNeg(
  val: any,
  field: string,
  label: string,
  path: string,
  issues: ValidationIssue[],
  affectedIds: string[]
): boolean {
  if (typeof val !== 'number' || val < 0) {
    issues.push(createIssue('INVALID_NON_NEGATIVE', 'error', `${path}.${field}`, `${label} не может быть отрицательным`, affectedIds))
    return true
  }
  return false
}

export function validateStructure(doc: any): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!doc || typeof doc !== 'object') {
    issues.push(createIssue('INVALID_DOCUMENT', 'error', '', 'Документ не является объектом', []))
    return issues
  }

  if (!doc.project) issues.push(createIssue('MISSING_PROJECT', 'error', 'project', 'Отсутствует раздел project', []))
  if (!doc.building) issues.push(createIssue('MISSING_BUILDING', 'error', 'building', 'Отсутствует раздел building', []))
  if (!doc.assembly) issues.push(createIssue('MISSING_ASSEMBLY', 'error', 'assembly', 'Отсутствует раздел assembly', []))
  if (!doc.validation) issues.push(createIssue('MISSING_VALIDATION', 'error', 'validation', 'Отсутствует раздел validation', []))

  if (doc.project) {
    const p = doc.project
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(p.schemaVersion)) {
      issues.push(createIssue('UNSUPPORTED_SCHEMA_VERSION', 'error', 'project.schemaVersion', `Неподдерживаемая версия схемы: ${p.schemaVersion}`, []))
    }
    if (!p.projectId) issues.push(createIssue('MISSING_PROJECT_ID', 'error', 'project.projectId', 'Отсутствует projectId', []))
    if (!p.projectName) issues.push(createIssue('MISSING_PROJECT_NAME', 'error', 'project.projectName', 'Отсутствует projectName', []))
    if (p.units !== 'mm') issues.push(createIssue('INVALID_UNITS', 'error', 'project.units', 'Поддерживаются только миллиметры', []))
    if (!SUPPORTED_RULESET_VERSIONS.includes(p.rulesetVersion)) {
      issues.push(createIssue('UNSUPPORTED_RULESET_VERSION', 'error', 'project.rulesetVersion', `Неподдерживаемая версия наборa правил: ${p.rulesetVersion}`, []))
    }
    if (!SUPPORTED_GENERATOR_VERSIONS.includes(p.generatorVersion)) {
      issues.push(createIssue('UNSUPPORTED_GENERATOR_VERSION', 'error', 'project.generatorVersion', `Неподдерживаемая версия генератора: ${p.generatorVersion}`, []))
    }
  }

  if (doc.building?.floorPlan !== undefined) {
    const planErrors = validateFloorPlan(doc.building.floorPlan)
    for (const message of planErrors) {
      issues.push(createIssue('INVALID_FLOOR_PLAN', 'error',
        'building.floorPlan', message, []))
    }
    if (!planErrors.length) issues.push(...validatePlanFrame(doc.building.floorPlan))
  }
  const wallIds = new Set<string>()
  const openingIds = new Set<string>()

  if (doc.building) {
    const b = doc.building

    if (Array.isArray(b.walls)) {
      b.walls.forEach((w: any, i: number) => {
        const path = `building.walls[${i}]`
        if (!w.wallId) issues.push(createIssue('MISSING_WALL_ID', 'error', path, 'Отсутствует wallId', []))
        else if (wallIds.has(w.wallId)) issues.push(createIssue('DUPLICATE_WALL_ID', 'error', path, `Дублирующийся wallId: ${w.wallId}`, [w.wallId]))
        else wallIds.add(w.wallId)

        checkPositive(w.lengthMm, 'lengthMm', 'Длина стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.heightMm, 'heightMm', 'Высота стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.thicknessMm, 'thicknessMm', 'Толщина стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.studSpacingMm, 'studSpacingMm', 'Шаг стоек', 'm', path, issues, w.wallId ? [w.wallId] : [])
        if (w.sectionMm) {
          checkPositive(w.sectionMm.width, 'sectionMm.width', 'Ширина сечения', 'f', path, issues, w.wallId ? [w.wallId] : [])
          checkPositive(w.sectionMm.height, 'sectionMm.height', 'Высота сечения', 'f', path, issues, w.wallId ? [w.wallId] : [])
        }
        if (!['x', 'y', 'z'].includes(w.orientation)) {
          issues.push(createIssue('INVALID_WALL_ORIENTATION', 'error', `${path}.orientation`, 'Недопустимая ориентация стены', w.wallId ? [w.wallId] : []))
        }
        if (w.origin) {
          ['x', 'y', 'z'].forEach(coord => {
            if (typeof w.origin[coord] !== 'number') {
              issues.push(createIssue('INVALID_ORIGIN_COORD', 'error', `${path}.origin.${coord}`, `Координата ${coord} должна быть числом`, w.wallId ? [w.wallId] : []))
            }
          })
        }
        if (Array.isArray(w.openings)) {
          w.openings.forEach((oid: string) => {
            if (typeof oid !== 'string' || !oid) {
              issues.push(createIssue('INVALID_OPENING_REF', 'error', `${path}.openings[]`, 'Ссылка на проём должна быть непустой строкой', w.wallId ? [w.wallId] : []))
            }
          })
        }
      })
    }

    if (Array.isArray(b.openings)) {
      b.openings.forEach((o: any, i: number) => {
        const path = `building.openings[${i}]`
        if (!o.id) issues.push(createIssue('MISSING_OPENING_ID', 'error', path, 'Отсутствует id проёма', []))
        else if (openingIds.has(o.id)) issues.push(createIssue('DUPLICATE_OPENING_ID', 'error', path, `Дублирующийся id проёма: ${o.id}`, [o.id]))
        else openingIds.add(o.id)

        if (!o.wallId) issues.push(createIssue('MISSING_OPENING_WALL_ID', 'error', path, 'Отсутствует wallId у проёма', o.id ? [o.id] : []))
        else if (!wallIds.has(o.wallId)) issues.push(createIssue('OPENING_REF_INVALID_WALL', 'error', path, `Проём ссылается на несуществующую стену: ${o.wallId}`, o.id ? [o.id] : []))

        if (!['window', 'door', 'garage-door'].includes(o.type)) {
          issues.push(createIssue('INVALID_OPENING_TYPE', 'error', `${path}.type`, 'Тип проёма должен быть window, door или garage-door', o.id ? [o.id] : []))
        }
        issues.push(...validateGarageOpening(o))
        issues.push(...validateOpeningHeaderInputs(o,typeof o.wallId==='string' && o.wallId.startsWith('partition-')))

        const checkNonNeg = (val: any, field: string, label: string) => {
          if (typeof val !== 'number' || val < 0) {
            issues.push(createIssue('INVALID_NON_NEGATIVE', 'error', `${path}.${field}`, `${label} не может быть отрицательным`, o.id ? [o.id] : []))
          }
        }
        checkNonNeg(o.positionUmm, 'positionUmm', 'Положение проёма')
        checkPositive(o.widthMm, 'widthMm', 'Ширина проёма', 'f', path, issues, o.id ? [o.id] : [])
        checkPositive(o.heightMm, 'heightMm', 'Высота проёма', 'f', path, issues, o.id ? [o.id] : [])
        checkNonNeg(o.sillHeightMm, 'sillHeightMm', 'Высота подоконника')
      })
    }

    const materialIds = new Set<string>()
    if (Array.isArray(b.materials)) {
      b.materials.forEach((m: any, i: number) => {
        const path = `building.materials[${i}]`
        if (!m.id) issues.push(createIssue('MISSING_MATERIAL_ID', 'error', path, 'Отсутствует id материала', []))
        else if (materialIds.has(m.id)) issues.push(createIssue('DUPLICATE_MATERIAL_ID', 'error', path, `Дублирующийся id материала: ${m.id}`, [m.id]))
        else materialIds.add(m.id)
        if (!m.name) issues.push(createIssue('MISSING_MATERIAL_NAME', 'error', path, 'Отсутствует название материала', m.id ? [m.id] : []))
        if (typeof m.densityKgM3 !== 'number' || m.densityKgM3 <= 0) {
          issues.push(createIssue('INVALID_MATERIAL_DENSITY', 'error', `${path}.densityKgM3`, 'Плотность должна быть положительной', m.id ? [m.id] : []))
        }
      })
    }

    if (Array.isArray(b.markers)) {
      b.markers.forEach((m: any, i: number) => {
        const path = `building.markers[${i}]`
        if (!m.openingId) issues.push(createIssue('MISSING_MARKER_OPENING_ID', 'error', path, 'Отсутствует openingId у маркера', []))
        else if (!openingIds.has(m.openingId)) issues.push(createIssue('MARKER_REF_INVALID_OPENING', 'error', path, `Маркер ссылается на несуществующий проём: ${m.openingId}`, []))
        if (!['center', 'left', 'right'].includes(m.anchor)) {
          issues.push(createIssue('INVALID_MARKER_ANCHOR', 'error', `${path}.anchor`, 'Некорректный якорь маркера', m.openingId ? [m.openingId] : []))
        }
        if (typeof m.outsideOffsetMm !== 'number') issues.push(createIssue('INVALID_MARKER_OFFSET', 'error', `${path}.outsideOffsetMm`, 'outsideOffsetMm должен быть числом', m.openingId ? [m.openingId] : []))
        if (typeof m.elevationMm !== 'number') issues.push(createIssue('INVALID_MARKER_ELEVATION', 'error', `${path}.elevationMm`, 'elevationMm должен быть числом', m.openingId ? [m.openingId] : []))
        if (typeof m.visible !== 'boolean') issues.push(createIssue('INVALID_MARKER_VISIBLE', 'error', `${path}.visible`, 'visible должен быть булевым', m.openingId ? [m.openingId] : []))
        if (!m.color || !/^#[0-9a-fA-F]{6}$/.test(m.color)) issues.push(createIssue('INVALID_MARKER_COLOR', 'error', `${path}.color`, 'Цвет должен быть в формате #RRGGBB', m.openingId ? [m.openingId] : []))
      })
    }
  }

  if (doc.assembly && Array.isArray(doc.assembly.elements)) {
    const elementIds = new Set<string>()
    doc.assembly.elements.forEach((e: any, i: number) => {
      const path = `assembly.elements[${i}]`
      if (!e.elementId) issues.push(createIssue('MISSING_ELEMENT_ID', 'error', path, 'Отсутствует elementId', []))
      else if (elementIds.has(e.elementId)) issues.push(createIssue('DUPLICATE_ELEMENT_ID', 'error', path, `Дублирующийся elementId: ${e.elementId}`, [e.elementId]))
      else elementIds.add(e.elementId)

      if (!e.wallId) issues.push(createIssue('MISSING_ELEMENT_WALL_ID', 'error', path, 'Отсутствует wallId у элемента', e.elementId ? [e.elementId] : []))
      else if (!wallIds.has(e.wallId)) issues.push(createIssue('ELEMENT_REF_INVALID_WALL', 'error', path, `Элемент ссылается на несуществующую стену: ${e.wallId}`, e.elementId ? [e.elementId] : []))

      if (!REQUIRED_ROLES.includes(e.role)) {
        issues.push(createIssue('INVALID_ELEMENT_ROLE', 'error', `${path}.role`, `Недопустимая роль элемента: ${e.role}`, e.elementId ? [e.elementId] : []))
      }

      if (e.sectionMm) {
        checkPositive(e.sectionMm.width, 'sectionMm.width', 'Ширина сечения', 'f', path, issues, e.elementId ? [e.elementId] : [])
        checkPositive(e.sectionMm.height, 'sectionMm.height', 'Высота сечения', 'f', path, issues, e.elementId ? [e.elementId] : [])
      }

      checkPositive(e.lengthMm, 'lengthMm', 'Длина элемента', 'f', path, issues, e.elementId ? [e.elementId] : [])

      if (e.orientation) {
        if (!['x', 'y', 'z', 'slope'].includes(e.orientation.mode)) issues.push(createIssue('INVALID_ORIENTATION_MODE', 'error', `${path}.orientation.mode`, 'Недопустимый режим ориентации', e.elementId ? [e.elementId] : []))
        if (typeof e.orientation.angle !== 'number') issues.push(createIssue('INVALID_ORIENTATION_ANGLE', 'error', `${path}.orientation.angle`, 'Угол должен быть числом', e.elementId ? [e.elementId] : []))
        if (typeof e.orientation.roll !== 'number') issues.push(createIssue('INVALID_ORIENTATION_ROLL', 'error', `${path}.orientation.roll`, 'Roll должен быть числом', e.elementId ? [e.elementId] : []))
      }

      if (e.position) {
        ['x', 'y', 'z'].forEach(coord => {
          if (typeof e.position[coord] !== 'number') {
            issues.push(createIssue('INVALID_POSITION_COORD', 'error', `${path}.position.${coord}`, `Координата ${coord} должна быть числом`, e.elementId ? [e.elementId] : []))
          }
        })
      }

      if (!Array.isArray(e.connectionIds)) issues.push(createIssue('INVALID_CONNECTION_IDS', 'error', `${path}.connectionIds`, 'connectionIds должен быть массивом', e.elementId ? [e.elementId] : []))
      if (typeof e.generated !== 'boolean') issues.push(createIssue('INVALID_GENERATED_FLAG', 'error', `${path}.generated`, 'generated должен быть булевым', e.elementId ? [e.elementId] : []))
    })
  }

  return issues
}

export function validateGeometry(doc: ProjectDocument | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!doc || !doc.building || !doc.assembly) return issues

  const { building, assembly } = doc
  for (const opening of building.openings) issues.push(...garageEngineeringNotices(opening))
  // Stage 3: physically inspect the derived header and jack studs. Load
  // demands are reported separately from structural capacity, which remains
  // unevaluated without species/grade, tributary loads and design context.
  if (building.floorPlan?.frame?.built) for (const opening of building.openings) {
    const wall=building.walls.find(w=>w.wallId===opening.wallId)
    if(!wall)continue
    issues.push(...verifyOpeningFraming(opening,wall,assembly.elements))
    issues.push(...verifyHeaderLoadInputs(opening,wall))
  }
  const links = effectiveConnections(doc)
  issues.push(...validateWallTopology(building.walls, links))
  const california = links.find(link => link && link.type === 'california-right' &&
    building.walls.some(w => w.wallId === link.fromWallId) &&
    building.walls.some(w => w.wallId === link.toWallId))
  if (california) {
    const front = building.walls.find(w => w.wallId === california.fromWallId)!
    const right = building.walls.find(w => w.wallId === california.toWallId)!
    const expected = rightCornerOrigin(front, right)
    const aligned = (['x', 'y', 'z'] as const).every(k => Math.abs(right.origin[k] - expected[k]) < 0.01)
    if (front.orientation !== 'x' || right.orientation !== 'z' || !aligned ||
        front.heightMm !== right.heightMm ||
        front.sectionMm.width !== right.sectionMm.width ||
        front.sectionMm.height !== right.sectionMm.height) {
      issues.push(createIssue('INVALID_CORNER_GEOMETRY', 'error', 'building.walls[1]',
        'Вторая стена должна быть справа, внутри дома и на одном уровне с первой',
        [front.wallId, right.wallId]))
    }
    for (const opening of building.openings.filter(o => o.wallId === front.wallId)) {
      if (!canFitCornerFraming(front, opening.positionUmm + opening.widthMm + 90)) {
        issues.push(createIssue('CORNER_BACKING_OVERLAP', 'error', `building.openings[id=${opening.id}]`,
          'Окно или дверь слишком близко к угловым стойкам', [front.wallId, opening.id]))
      }
    }
    // Independently validate the materialized California corner contacts.
    // A stud may be inside wall bounds yet overlap another stud or leave a gap.
    const backing = assembly.elements.find(e => e.wallId === front.wallId && e.elementId === 'warm-corner-stud')
    const endStud = assembly.elements
      .filter(e => e.wallId === front.wallId && e.role === 'stud')
      .sort((a, b) => b.position.x - a.position.x)[0]
    const startStud = assembly.elements
      .filter(e => e.wallId === right.wallId && e.role === 'stud')
      .sort((a, b) => a.position.x - b.position.x)[0]

    if (!backing || !endStud || !startStud) {
      issues.push(createIssue('CALIFORNIA_CORNER_MISSING_BOARD', 'error',
        'assembly.elements', 'В калифорнийском углу отсутствует одна из трёх стоек',
        [front.wallId, right.wallId]))
    } else {
      // Rolled vertical member: local section height spans +X and the
      // 45mm section width is centred across Z. The right wall points to -Z.
      const frontMidplane = wallMidplaneOrigin(front)
      const rightMidplane = wallMidplaneOrigin(right)
      const backingMinX = frontMidplane.x + backing.position.x
      const backingMaxX = backingMinX + backing.sectionMm.height
      const frontEndMinX = frontMidplane.x + endStud.position.x - endStud.sectionMm.width / 2
      const backingMinZ = frontMidplane.z + backing.position.z - backing.sectionMm.width / 2
      const sideStartMaxZ = rightMidplane.z - startStud.position.x + startStud.sectionMm.width / 2
      const sideStartMinX = rightMidplane.x + startStud.position.z
      const sideStartMaxX = sideStartMinX + startStud.sectionMm.height
      const sideOverlapX = Math.min(backingMaxX, sideStartMaxX) -
        Math.max(backingMinX, sideStartMinX)
      const toleranceMm = 0.01
      const flat = backing.orientation.mode === 'y' && backing.orientation.roll === 90 &&
        backing.orientation.angle === 0 &&
        backing.sectionMm.width === front.sectionMm.width &&
        backing.sectionMm.height === front.sectionMm.height
      const alignedY = Math.abs(backing.position.y - endStud.position.y) <= toleranceMm &&
        Math.abs(backing.lengthMm - endStud.lengthMm) <= toleranceMm &&
        Math.abs(backing.position.y - startStud.position.y) <= toleranceMm &&
        Math.abs(backing.lengthMm - startStud.lengthMm) <= toleranceMm

      if (!flat || !alignedY ||
        Math.abs(backingMaxX - frontEndMinX) > toleranceMm ||
        Math.abs(backingMinZ - sideStartMaxZ) > toleranceMm ||
        sideOverlapX <= toleranceMm) {
        issues.push(createIssue('CALIFORNIA_CORNER_INVALID_CONTACT', 'error',
          'assembly.elements[id=warm-corner-stud]',
          'Калифорнийский угол: стойки должны касаться без зазора и пересечения',
          [backing.elementId, endStud.elementId, startStud.elementId]))
      }
    }
  }
  const wallsById = new Map(building.walls.map(w => [w.wallId, w]))
  const openingsByWall = new Map<string, Opening[]>()
  building.openings.forEach(o => {
    if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, [])
    openingsByWall.get(o.wallId)!.push(o)
  })

  const wallOpeningsMap = new Map<string, Opening[]>()
  building.walls.forEach(wall => {
    wallOpeningsMap.set(wall.wallId, openingsByWall.get(wall.wallId) || [])
  })

  building.walls.forEach(wall => {
    const wallOpenings = [...(wallOpeningsMap.get(wall.wallId) || [])].sort((a, b) => a.positionUmm - b.positionUmm)

    wallOpenings.forEach(opening => {
      if (opening.positionUmm < 0) {
        issues.push(createIssue('OPENING_NEGATIVE_POSITION', 'error', `building.openings[id=${opening.id}].positionUmm`, 'Положение проёма не может быть отрицательным', [opening.id, wall.wallId]))
      }
      if (opening.positionUmm + opening.widthMm > wall.lengthMm) {
        issues.push(createIssue('OPENING_OUT_OF_BOUNDS', 'error', `building.openings[id=${opening.id}]`, 'Проём выходит за границы стены', [opening.id, wall.wallId]))
      }
      if (opening.sillHeightMm + opening.heightMm > wall.heightMm) {
        issues.push(createIssue('OPENING_TOO_TALL', 'error', `building.openings[id=${opening.id}]`, 'Проём слишком высокий для стены', [opening.id, wall.wallId]))
      }
      if (opening.sillHeightMm < 0) {
        issues.push(createIssue('INVALID_SILL_HEIGHT', 'error', `building.openings[id=${opening.id}].sillHeightMm`, 'Высота подоконника не может быть отрицательной', [opening.id, wall.wallId]))
      }
    })

    for (let i = 0; i < wallOpenings.length; i++) {
      for (let j = i + 1; j < wallOpenings.length; j++) {
        const a = wallOpenings[i]
        const b = wallOpenings[j]
        const aEnd = a.positionUmm + a.widthMm
        const aFrameMax = aEnd + 90
        const bFrameMin = b.positionUmm - 90
        if (aFrameMax > bFrameMin) {
          issues.push(createIssue('OPENINGS_FRAME_OVERLAP', 'error', `building.openings[id=${a.id}],building.openings[id=${b.id}]`, 'Недостаточно места между проёмами для рамы', [a.id, b.id, wall.wallId]))
        }
      }
    }
  })

  const insetWalls = new Set(building.floorPlan?.frame?.built
    ? perimeterCorners(building.walls).map(corner => corner.inset.wallId) : [])
  const elementIds = new Set<string>()
  assembly.elements.forEach(el => {
    if (elementIds.has(el.elementId)) {
      issues.push(createIssue('DUPLICATE_ELEMENT_IN_ASSEMBLY', 'error', `assembly.elements[id=${el.elementId}]`, `Дублирующийся элемент в сборке: ${el.elementId}`, [el.elementId]))
    }
    elementIds.add(el.elementId)

    const wall = wallsById.get(el.wallId)
    if (wall) {
      const halfW = el.sectionMm.width / 2
      const halfH = el.sectionMm.height / 2
      // A vertical California corner nailer is rolled about its long axis:
      // its 145-mm dimension is now along the wall's local X axis.
      const isRolledStud = el.orientation.mode === 'y' &&
        Math.abs(Math.abs(el.orientation.roll % 180) - 90) < 0.001
      // For a Y-axis stud rolled ±90°, local section height projects along
      // X from the saved reference point, not from a centred X coordinate.
      const positiveRoll = Math.sin(el.orientation.roll * Math.PI / 180) > 0
      let minX = isRolledStud ? el.position.x - (positiveRoll ? 0 : el.sectionMm.height) : el.position.x - halfW
      let maxX = isRolledStud ? el.position.x + (positiveRoll ? el.sectionMm.height : 0) : el.position.x + halfW
      let minY = el.position.y
      let maxY = el.position.y + el.lengthMm

      if (el.orientation.mode === 'x') {
        minX = el.position.x
        maxX = el.position.x + el.lengthMm
        minY = el.position.y - halfW
        maxY = el.position.y + halfW
      } else if (el.orientation.mode === 'z') {
        minX = el.position.x - halfW
        maxX = el.position.x + halfW
        minY = el.position.y - halfH
        maxY = el.position.y + halfH
      }

      // The right wall's second top plate intentionally overhangs its
      // local origin by the wall depth to tie into the first wall.
      const rightLap = california?.toWallId === el.wallId &&
        el.elementId === `${el.wallId}:plate-top-2`
      const planLap = insetWalls.has(el.wallId) && el.elementId.startsWith(`${el.wallId}:plate-top-2`)
      // The linked interior wall's second cap bridges across its host wall.
      // Validate only that designated cap, never allow ordinary studs/plates
      // to overhang by this extra amount. Contact is tested separately.
      const interiorLap = building.floorPlan?.frame?.built && isPartitionWall(el.wallId) &&
        el.role === 'top-plate' && el.elementId.startsWith(el.wallId + ':plate-top-2')
      const maxHostDepth = Math.max(0, ...building.walls.map(w => w.sectionMm.height))
      const minAllowed = interiorLap ? -maxHostDepth : rightLap || planLap ? -wall.sectionMm.height : 0
      const maxAllowed = wall.lengthMm +
        (interiorLap ? maxHostDepth : planLap ? wall.sectionMm.height : 0)
      if (minX < minAllowed - 0.001 || maxX > maxAllowed + 0.001) {
        issues.push(createIssue('ELEMENT_OUT_OF_WALL_BOUNDS', 'error',
          `assembly.elements[id=${el.elementId}]`,
          `Элемент выходит за границы стены по X: ${el.elementId} (${el.wallId}); ` +
          `от ${Number(minX.toFixed(2))} до ${Number(maxX.toFixed(2))} мм, ` +
          `допустимо от ${Number(minAllowed.toFixed(2))} до ${Number(maxAllowed.toFixed(2))} мм`,
          [el.elementId, el.wallId]))
      }
      if (minY < 0 || maxY > wall.heightMm) {
        issues.push(createIssue('ELEMENT_OUT_OF_WALL_HEIGHT', 'error', `assembly.elements[id=${el.elementId}]`, 'Элемент выходит за границы стены по Y', [el.elementId, el.wallId]))
      }
    }

    const wallOpenings = wallOpeningsMap.get(el.wallId) || []
    wallOpenings.forEach(opening => {
      const ox = opening.positionUmm
      const ow = opening.widthMm
      const oy = opening.sillHeightMm
      const oh = opening.heightMm
      const openingRight = ox + ow
      const openingTop = oy + oh

      const halfW = el.sectionMm.width / 2
      const halfH = el.sectionMm.height / 2
      const isRolledStud = el.orientation.mode === 'y' &&
        Math.abs(Math.abs(el.orientation.roll % 180) - 90) < 0.001
      const positiveRoll = Math.sin(el.orientation.roll * Math.PI / 180) > 0
      let elMinX = isRolledStud ? el.position.x - (positiveRoll ? 0 : el.sectionMm.height) : el.position.x - halfW
      let elMaxX = isRolledStud ? el.position.x + (positiveRoll ? el.sectionMm.height : 0) : el.position.x + halfW
      let elMinY = el.position.y
      let elMaxY = el.position.y + el.lengthMm

      if (el.orientation.mode === 'x') {
        elMinX = el.position.x
        elMaxX = el.position.x + el.lengthMm
        elMinY = el.position.y - halfW
        elMaxY = el.position.y + halfW
      } else if (el.orientation.mode === 'z') {
        elMinX = el.position.x - halfW
        elMaxX = el.position.x + halfW
        elMinY = el.position.y - halfH
        elMaxY = el.position.y + halfH
      }

      const xOverlap = elMinX < openingRight && ox < elMaxX
      const yOverlap = elMinY < openingTop && oy < elMaxY

      if (xOverlap && yOverlap) {
        const fullyInside = elMinX >= ox - 1e-9 && elMaxX <= openingRight + 1e-9 && elMinY >= oy - 1e-9 && elMaxY <= openingTop + 1e-9
        if (fullyInside && el.role !== 'sill') {
          issues.push(createIssue('ELEMENT_INSIDE_OPENING', 'error', `assembly.elements[id=${el.elementId}]`, 'Элемент находится внутри проёма', [el.elementId, opening.id, el.wallId]))
        }
      }
    })
  })

  return issues
}

function matchesJson(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') return false
  if (Array.isArray(actual) !== Array.isArray(expected)) return false
  const entries = Object.entries(expected)
  return entries.length === Object.keys(actual).length &&
    entries.every(([key, value]) => matchesJson((actual as Record<string, unknown>)[key], value))
}

export function validateConsistency(doc: ProjectDocument | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!doc || !doc.building || !doc.assembly) return issues

  const { building, assembly } = doc

  const wallIds = new Set(building.walls.map(w => w.wallId))
  const openingIds = new Set(building.openings.map(o => o.id))
  const plan = building.floorPlan
  if (plan?.frame?.built && !validateFloorPlan(plan).length && !validatePlanFrame(plan).length) {
    const projection = projectPlanFrame(plan, plan.frame)
    const actual = { walls: building.walls, openings: building.openings, connections: building.connections }
    if (!matchesJson(actual, projection)) {
      issues.push(createIssue('PLAN_FRAME_OUT_OF_SYNC', 'error', 'building.walls',
        'Каркас не соответствует наружному плану', []))
    }
  }

  building.walls.forEach(wall => {
    wall.openings.forEach(oid => {
      if (!openingIds.has(oid)) {
        issues.push(createIssue('WALL_REF_MISSING_OPENING', 'error', `building.walls[id=${wall.wallId}].openings[]`, `Стена ссылается на несуществующий проём: ${oid}`, [wall.wallId, oid]))
      }
    })
  })

  building.openings.forEach(opening => {
    if (!wallIds.has(opening.wallId)) {
      issues.push(createIssue('OPENING_REF_MISSING_WALL', 'error', `building.openings[id=${opening.id}].wallId`, `Проём ссылается на несуществующую стену: ${opening.wallId}`, [opening.id, opening.wallId]))
    }
  })

  building.markers.forEach(marker => {
    if (!openingIds.has(marker.openingId)) {
      issues.push(createIssue('MARKER_REF_MISSING_OPENING', 'error', `building.markers[openingId=${marker.openingId}]`, `Маркер ссылается на несуществующий проём: ${marker.openingId}`, [marker.openingId]))
    }
  })

  assembly.elements.forEach(el => {
    if (!wallIds.has(el.wallId)) {
      issues.push(createIssue('ELEMENT_REF_MISSING_WALL', 'error', `assembly.elements[id=${el.elementId}].wallId`, `Элемент ссылается на несуществующую стену: ${el.wallId}`, [el.elementId, el.wallId]))
    }
    if (el.generated && !wallIds.has(el.wallId)) {
      issues.push(createIssue('GENERATED_ELEMENT_INVALID_WALL', 'error', `assembly.elements[id=${el.elementId}]`, 'Сгенерированный элемент ссылается на несуществующую стену', [el.elementId, el.wallId]))
    }
  })

  return issues
}

export function validateProject(doc: any): ValidationResult {
  const structureIssues = validateStructure(doc)
  const geometryIssues = validateGeometry(doc as ProjectDocument)
  const consistencyIssues = validateConsistency(doc as ProjectDocument)

  const allIssues = [...structureIssues, ...geometryIssues, ...consistencyIssues]
  const hasErrors = allIssues.some(i => i.severity === 'error')

  return {
    valid: !hasErrors,
    issues: allIssues,
    engineeringStatus: 'not_evaluated'
  }
}

export function validateProjectSnapshot(doc: any): ValidationResult {
  return validateProject(doc)
}

export function validateSourceParameters(doc: any): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!doc || typeof doc !== 'object') {
    issues.push(createIssue('INVALID_DOCUMENT', 'error', '', 'Документ не является объектом', []))
    return issues
  }

  if (!doc.project) issues.push(createIssue('MISSING_PROJECT', 'error', 'project', 'Отсутствует раздел project', []))
  if (!doc.building) issues.push(createIssue('MISSING_BUILDING', 'error', 'building', 'Отсутствует раздел building', []))

  if (doc.project) {
    const p = doc.project
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(p.schemaVersion)) {
      issues.push(createIssue('UNSUPPORTED_SCHEMA_VERSION', 'error', 'project.schemaVersion', `Неподдерживаемая версия схемы: ${p.schemaVersion}`, []))
    }
    if (!p.projectId) issues.push(createIssue('MISSING_PROJECT_ID', 'error', 'project.projectId', 'Отсутствует projectId', []))
    if (!p.projectName) issues.push(createIssue('MISSING_PROJECT_NAME', 'error', 'project.projectName', 'Отсутствует projectName', []))
    if (p.units !== 'mm') issues.push(createIssue('INVALID_UNITS', 'error', 'project.units', 'Поддерживаются только миллиметры', []))
    if (!SUPPORTED_RULESET_VERSIONS.includes(p.rulesetVersion)) {
      issues.push(createIssue('UNSUPPORTED_RULESET_VERSION', 'error', 'project.rulesetVersion', `Неподдерживаемая версия наборa правил: ${p.rulesetVersion}`, []))
    }
    if (!SUPPORTED_GENERATOR_VERSIONS.includes(p.generatorVersion)) {
      issues.push(createIssue('UNSUPPORTED_GENERATOR_VERSION', 'error', 'project.generatorVersion', `Неподдерживаемая версия генератора: ${p.generatorVersion}`, []))
    }
  }

  if (doc.building?.floorPlan !== undefined) {
    const planErrors = validateFloorPlan(doc.building.floorPlan)
    for (const message of planErrors) {
      issues.push(createIssue('INVALID_FLOOR_PLAN', 'error',
        'building.floorPlan', message, []))
    }
    if (!planErrors.length) issues.push(...validatePlanFrame(doc.building.floorPlan))
  }
  const wallIds = new Set<string>()
  const openingIds = new Set<string>()

  const linked = doc.building?.floorPlan?.frame?.built === true
  if (doc.building) {
    // Linked walls, openings, markers and connections are generated from the plan.
    const b = linked ? { materials: doc.building.materials } : doc.building

    if (Array.isArray(b.walls)) {
      b.walls.forEach((w: any, i: number) => {
        const path = `building.walls[${i}]`
        if (!w.wallId) issues.push(createIssue('MISSING_WALL_ID', 'error', path, 'Отсутствует wallId', []))
        else if (wallIds.has(w.wallId)) issues.push(createIssue('DUPLICATE_WALL_ID', 'error', path, `Дублирующийся wallId: ${w.wallId}`, [w.wallId]))
        else wallIds.add(w.wallId)

        checkPositive(w.lengthMm, 'lengthMm', 'Длина стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.heightMm, 'heightMm', 'Высота стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.thicknessMm, 'thicknessMm', 'Толщина стены', 'f', path, issues, w.wallId ? [w.wallId] : [])
        checkPositive(w.studSpacingMm, 'studSpacingMm', 'Шаг стоек', 'm', path, issues, w.wallId ? [w.wallId] : [])
        if (w.sectionMm) {
          checkPositive(w.sectionMm.width, 'sectionMm.width', 'Ширина сечения', 'f', path, issues, w.wallId ? [w.wallId] : [])
          checkPositive(w.sectionMm.height, 'sectionMm.height', 'Высота сечения', 'f', path, issues, w.wallId ? [w.wallId] : [])
        }
        if (!['x', 'y', 'z'].includes(w.orientation)) {
          issues.push(createIssue('INVALID_WALL_ORIENTATION', 'error', `${path}.orientation`, 'Недопустимая ориентация стены', w.wallId ? [w.wallId] : []))
        }
        if (w.origin) {
          ['x', 'y', 'z'].forEach(coord => {
            if (typeof w.origin[coord] !== 'number') {
              issues.push(createIssue('INVALID_ORIGIN_COORD', 'error', `${path}.origin.${coord}`, `Координата ${coord} должна быть числом`, w.wallId ? [w.wallId] : []))
            }
          })
        }
        if (Array.isArray(w.openings)) {
          w.openings.forEach((oid: string) => {
            if (typeof oid !== 'string' || !oid) {
              issues.push(createIssue('INVALID_OPENING_REF', 'error', `${path}.openings[]`, 'Ссылка на проём должна быть непустой строкой', w.wallId ? [w.wallId] : []))
            }
          })
        }
      })
    }

    if (Array.isArray(b.openings)) {
      b.openings.forEach((o: any, i: number) => {
        const path = `building.openings[${i}]`
        if (!o.id) issues.push(createIssue('MISSING_OPENING_ID', 'error', path, 'Отсутствует id проёма', []))
        else if (openingIds.has(o.id)) issues.push(createIssue('DUPLICATE_OPENING_ID', 'error', path, `Дублирующийся id проёма: ${o.id}`, [o.id]))
        else openingIds.add(o.id)

        if (!o.wallId) issues.push(createIssue('MISSING_OPENING_WALL_ID', 'error', path, 'Отсутствует wallId у проёма', o.id ? [o.id] : []))
        else if (!wallIds.has(o.wallId)) issues.push(createIssue('OPENING_REF_INVALID_WALL', 'error', path, `Проём ссылается на несуществующую стену: ${o.wallId}`, o.id ? [o.id] : []))

        if (!['window', 'door', 'garage-door'].includes(o.type)) {
          issues.push(createIssue('INVALID_OPENING_TYPE', 'error', `${path}.type`, 'Тип проёма должен быть window, door или garage-door', o.id ? [o.id] : []))
        }
        issues.push(...validateGarageOpening(o))

        checkNonNeg(o.positionUmm, 'positionUmm', 'Положение проёма', path, issues, o.id ? [o.id] : [])
        checkPositive(o.widthMm, 'widthMm', 'Ширина проёма', 'f', path, issues, o.id ? [o.id] : [])
        checkPositive(o.heightMm, 'heightMm', 'Высота проёма', 'f', path, issues, o.id ? [o.id] : [])
        checkNonNeg(o.sillHeightMm, 'sillHeightMm', 'Высота подоконника', path, issues, o.id ? [o.id] : [])
      })

      // Geometry validation: check opening bounds and frame overlaps
      b.walls.forEach((wall: any) => {
        if (!wall.wallId) return
        const wallOpenings = b.openings.filter((o: any) => o.wallId === wall.wallId).sort((a: any, b: any) => a.positionUmm - b.positionUmm)
        wallOpenings.forEach((o: any) => {
          const path = `building.openings[id=${o.id}]`
          if (o.positionUmm + o.widthMm > wall.lengthMm) {
            issues.push(createIssue('OPENING_OUT_OF_BOUNDS', 'error', path, 'Проём выходит за границы стены', [o.id, wall.wallId]))
          }
          if (o.sillHeightMm + o.heightMm > wall.heightMm) {
            issues.push(createIssue('OPENING_TOO_TALL', 'error', path, 'Проём слишком высокий для стены', [o.id, wall.wallId]))
          }
        })
        for (let i = 0; i < wallOpenings.length; i++) {
          for (let j = i + 1; j < wallOpenings.length; j++) {
            const a = wallOpenings[i]
            const b = wallOpenings[j]
            const aFrameMax = a.positionUmm + a.widthMm + 90
            const bFrameMin = b.positionUmm - 90
            if (aFrameMax > bFrameMin) {
              issues.push(createIssue('OPENINGS_FRAME_OVERLAP', 'error', `building.openings[id=${a.id}],building.openings[id=${b.id}]`, 'Недостаточно места между проёмами для рамы', [a.id, b.id, wall.wallId]))
            }
          }
        }
      })
    }

    const materialIds = new Set<string>()
    if (Array.isArray(b.materials)) {
      b.materials.forEach((m: any, i: number) => {
        const path = `building.materials[${i}]`
        if (!m.id) issues.push(createIssue('MISSING_MATERIAL_ID', 'error', path, 'Отсутствует id материала', []))
        else if (materialIds.has(m.id)) issues.push(createIssue('DUPLICATE_MATERIAL_ID', 'error', path, `Дублирующийся id материала: ${m.id}`, [m.id]))
        else materialIds.add(m.id)
        if (!m.name) issues.push(createIssue('MISSING_MATERIAL_NAME', 'error', path, 'Отсутствует название материала', m.id ? [m.id] : []))
        if (typeof m.densityKgM3 !== 'number' || m.densityKgM3 <= 0) {
          issues.push(createIssue('INVALID_MATERIAL_DENSITY', 'error', `${path}.densityKgM3`, 'Плотность должна быть положительной', m.id ? [m.id] : []))
        }
      })
    }

    if (Array.isArray(b.markers)) {
      b.markers.forEach((m: any, i: number) => {
        const path = `building.markers[${i}]`
        if (!m.openingId) issues.push(createIssue('MISSING_MARKER_OPENING_ID', 'error', path, 'Отсутствует openingId у маркера', []))
        else if (!openingIds.has(m.openingId)) issues.push(createIssue('MARKER_REF_INVALID_OPENING', 'error', path, `Маркер ссылается на несуществующий проём: ${m.openingId}`, []))
        if (!['center', 'left', 'right'].includes(m.anchor)) {
          issues.push(createIssue('INVALID_MARKER_ANCHOR', 'error', `${path}.anchor`, 'Некорректный якорь маркера', m.openingId ? [m.openingId] : []))
        }
        if (typeof m.outsideOffsetMm !== 'number') issues.push(createIssue('INVALID_MARKER_OFFSET', 'error', `${path}.outsideOffsetMm`, 'outsideOffsetMm должен быть числом', m.openingId ? [m.openingId] : []))
        if (typeof m.elevationMm !== 'number') issues.push(createIssue('INVALID_MARKER_ELEVATION', 'error', `${path}.elevationMm`, 'elevationMm должен быть числом', m.openingId ? [m.openingId] : []))
        if (typeof m.visible !== 'boolean') issues.push(createIssue('INVALID_MARKER_VISIBLE', 'error', `${path}.visible`, 'visible должен быть булевым', m.openingId ? [m.openingId] : []))
        if (!m.color || !/^#[0-9a-fA-F]{6}$/.test(m.color)) issues.push(createIssue('INVALID_MARKER_COLOR', 'error', `${path}.color`, 'Цвет должен быть в формате #RRGGBB', m.openingId ? [m.openingId] : []))
      })
    }
  }

  if (!linked && doc.building && Array.isArray(doc.building.walls)) {
    const links = Array.isArray(doc.building.connections)
      ? doc.building.connections
      : (doc.building.walls.length === 2
        ? [{ fromWallId: doc.building.walls[0].wallId,
             toWallId: doc.building.walls[1].wallId,
             type: 'california-right' as const }]
        : [])
    issues.push(...validateWallTopology(doc.building.walls, links))
  }
  if (!linked && doc.building?.connections !== undefined && !Array.isArray(doc.building.connections)) {
    issues.push(createIssue('INVALID_CONNECTIONS_ARRAY', 'error', 'building.connections',
      'Соединения должны быть массивом', []))
  }

  return issues
}