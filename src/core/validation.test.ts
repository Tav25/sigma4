
import { describe, it, expect } from 'vitest'
import { validateWallLength, validateInt, WALL_LENGTH_MIN } from './validation'

describe('validation', () => {
  it('empty length -> message', () => {
    const r = validateWallLength('')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0434\u043b\u0438\u043d\u0443 \u0441\u0442\u0435\u043d\u044b')
  })

  it('invalid format', () => {
    const r = validateWallLength('abc')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u0432 \u043c\u0438\u043b\u043b\u0438\u043c\u0435\u0442\u0440\u0430\u0445')
  })

  it('too small 2 -> min message', () => {
    const r = validateWallLength('2')
    expect(r.ok).toBe(false)
    expect(r.error).toBe(`\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0434\u043b\u0438\u043d\u0430 \u0441\u0442\u0435\u043d\u044b \u2014 ${WALL_LENGTH_MIN} \u043c\u043c`)
  })

  it('valid 3000', () => {
    const r = validateWallLength('3000')
    expect(r.ok).toBe(true)
    expect(r.value).toBe(3000)
  })

  it('validateInt empty', () => {
    const r = validateInt('', 1, 10, 'x')
    expect(r.ok).toBe(false)
  })

  it('validateInt zero/negative', () => {
    expect(validateInt('0', 1, 10, 'x').ok).toBe(false)
    expect(validateInt('-5', 1, 10, 'x').ok).toBe(false)
  })

  it('validateInt valid', () => {
    const r = validateInt('5', 1, 10, 'x')
    expect(r.ok).toBe(true)
    expect(r.value).toBe(5)
  })
})
