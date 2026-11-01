
export interface ValidationResult {
  ok: boolean
  value?: number
  error?: string
}

export const WALL_LENGTH_MIN = 300
export const WALL_LENGTH_MAX = 100000

export function validateWallLength(raw: string): ValidationResult {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0434\u043b\u0438\u043d\u0443 \u0441\u0442\u0435\u043d\u044b' }
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u0432 \u043c\u0438\u043b\u043b\u0438\u043c\u0435\u0442\u0440\u0430\u0445' }
  }
  if (!Number.isInteger(n)) {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u0432 \u043c\u0438\u043b\u043b\u0438\u043c\u0435\u0442\u0440\u0430\u0445' }
  }
  if (n <= 0) {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u0432 \u043c\u0438\u043b\u043b\u0438\u043c\u0435\u0442\u0440\u0430\u0445' }
  }
  if (n < WALL_LENGTH_MIN) {
    return { ok: false, error: `\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0434\u043b\u0438\u043d\u0430 \u0441\u0442\u0435\u043d\u044b \u2014 ${WALL_LENGTH_MIN} \u043c\u043c` }
  }
  if (n > WALL_LENGTH_MAX) {
    return { ok: false, error: `\u041c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0434\u043b\u0438\u043d\u0430 \u0441\u0442\u0435\u043d\u044b \u2014 ${WALL_LENGTH_MAX} \u043c\u043c` }
  }
  return { ok: true, value: n }
}

export function validateInt(raw: string, min: number, max: number, label: string): ValidationResult {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, error: `\u0412\u0432\u0435\u0434\u0438\u0442\u0435 ${label}` }
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e' }
  }
  if (n <= 0) {
    return { ok: false, error: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e' }
  }
  if (n < min) {
    return { ok: false, error: `\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u2014 ${min}` }
  }
  if (n > max) {
    return { ok: false, error: `\u041c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u2014 ${max}` }
  }
  return { ok: true, value: n }
}
