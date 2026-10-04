import { describe, expect, test } from 'vitest'
import { localDate, nowLocalIso } from '@shared/time'

describe('time', () => {
  const d = new Date(2026, 9, 4, 5, 6, 7)

  test('localDate is the local calendar date', () => {
    expect(localDate(d)).toBe('2026-10-04')
  })

  test('nowLocalIso is local time with an offset', () => {
    const iso = nowLocalIso(d)
    expect(iso.startsWith('2026-10-04T05:06:07')).toBe(true)
    expect(iso).toMatch(/[+-]\d\d:\d\d$/)
  })
})
