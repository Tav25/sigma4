import type { GarageDoorSpec, Opening, ValidationIssue } from './project'

/**
 * Planning profile from Clopay residential standard torsion track guidance.
 * These are REQUIRED clearances, not measurements of the user's garage.
 * The selected manufacturer/model can impose different requirements.
 */
export function defaultGarageDoorSpec(): GarageDoorSpec {
  return {
    installationProfile: 'clopay-standard-torsion',
    minSideRoomMm: 96,
    minHeadRoomMm: 305,
    minBackRoomExtraMm: 457,
    lintelPreviewDepthMm: 286,
    jackStudsPerSide: 2,
  }
}

export const GARAGE_DOOR_PRESETS = [
  { label: 'Один автомобиль · 8 × 7 ft', widthMm: 2438, heightMm: 2134 },
  { label: 'Один автомобиль · 9 × 7 ft', widthMm: 2743, heightMm: 2134 },
  { label: 'Два автомобиля · 16 × 7 ft', widthMm: 4877, heightMm: 2134 },
] as const

/**
 * Independent validation of author-controlled garage input. No silent
 * calculation of beam bearing strength or portal-frame shear resistance.
 */
export function validateGarageOpening(opening: Opening): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const path = 'building.openings[id=' + opening.id + ']'
  const fail = (code: string, messageRu: string) => issues.push({
    code, severity: 'error', path, messageRu,
    affectedIds: [opening.id, opening.wallId],
  })
  if (opening.type !== 'garage-door') {
    if (opening.garage !== undefined) fail('GARAGE_SPEC_ON_NON_GARAGE', 'Данные гаражных ворот допустимы только для гаражного проёма')
    return issues
  }
  if (opening.sillHeightMm !== 0) fail('GARAGE_DOOR_REQUIRES_GROUND_OPENING', 'Гаражный проём должен начинаться от нулевого уровня стены')
  if (!Number.isFinite(opening.widthMm) || opening.widthMm < 1800) {
    fail('GARAGE_DOOR_WIDTH_INVALID', 'Ширина гаражных ворот должна быть не менее 1800 мм')
  }
  if (!Number.isFinite(opening.heightMm) || opening.heightMm < 1800) {
    fail('GARAGE_DOOR_HEIGHT_INVALID', 'Высота гаражных ворот должна быть не менее 1800 мм')
  }
  const spec = opening.garage
  if (!spec || typeof spec !== 'object') {
    fail('GARAGE_SPEC_REQUIRED', 'Для гаражных ворот необходима спецификация монтажных зазоров и предварительной перемычки')
    return issues
  }
  if (spec.installationProfile !== 'clopay-standard-torsion') {
    fail('GARAGE_PROFILE_UNSUPPORTED', 'Неподдерживаемый профиль гаражных ворот')
  }
  for (const [key, label] of [
    ['minSideRoomMm', 'Боковой монтажный зазор'],
    ['minHeadRoomMm', 'Верхний монтажный зазор'],
    ['minBackRoomExtraMm', 'Дополнительная глубина гаража'],
    ['lintelPreviewDepthMm', 'Предварительная глубина перемычки'],
  ] as const) {
    const value = spec[key]
    if (!Number.isFinite(value) || value <= 0 || value > 3000) {
      fail('GARAGE_SPEC_DIMENSION_INVALID', label + ' должен быть положительным конечным размером в мм')
    }
  }
  if (!Number.isInteger(spec.jackStudsPerSide) || spec.jackStudsPerSide < 1 || spec.jackStudsPerSide > 4) {
    fail('GARAGE_SUPPORT_STUDS_INVALID', 'Число опорных стоек с каждой стороны должно быть от 1 до 4')
  }
  if (Number.isInteger(spec.jackStudsPerSide) &&
    opening.positionUmm < (spec.jackStudsPerSide + 2) * 45) {
    fail('GARAGE_EDGE_STUD_CLEARANCE',
      'Проём слишком близко к краю стены: необходимо сохранить угловую/крайнюю стойку')
  }
  if (spec.jackStudsPerSide < 2 && opening.widthMm > 3000) {
    fail('GARAGE_WIDE_OPENING_NEEDS_SUPPORT_STUDS',
      'Для пролёта более 3 м необходимо предусмотреть минимум две опорные стойки на сторону (конкретный расчёт отдельно)')
  }
  return issues
}

export function garageEngineeringNotices(opening: Opening): ValidationIssue[] {
  if (opening.type !== 'garage-door') return []
  return [
    {
      code: 'GARAGE_LINTEL_REQUIRES_ENGINEERING',
      severity: 'warning' as const,
      path: 'building.openings[id=' + opening.id + '].garage',
      messageRu: 'Гаражные ворота: показанная перемычка — предварительная компоновка, её пролёт и сечение НЕ рассчитаны по нагрузкам.',
      affectedIds: [opening.id, opening.wallId],
    },
    {
      code: 'GARAGE_BRACING_AND_TRACK_CLEARANCES_UNVERIFIED',
      severity: 'warning' as const,
      path: 'building.openings[id=' + opening.id + '].garage',
      messageRu: 'Проверить ветровую/сейсмическую жёсткость (portal frame, крепления и фундамент) и реальные зазоры для выбранной модели ворот.',
      affectedIds: [opening.id, opening.wallId],
    },
  ]
}
