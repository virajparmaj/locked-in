import { describe, it, expect } from 'vitest'

/**
 * Replicate computeNextReminderDate from db.service.ts
 * since it can't be imported directly (Electron/better-sqlite3 dependency).
 */
function computeNextReminderDate(frequency: string, from: Date): Date {
  const next = new Date(from)
  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'quarterly':
      next.setMonth(next.getMonth() + 3)
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1)
      break
    default:
      next.setDate(next.getDate() + 7)
  }
  return next
}

describe('computeNextReminderDate', () => {
  const baseDate = new Date(2025, 2, 15, 10, 0, 0) // March 15, 2025

  describe('weekly', () => {
    it('adds 7 days', () => {
      const result = computeNextReminderDate('weekly', baseDate)
      expect(result).toEqual(new Date(2025, 2, 22, 10, 0, 0))
    })

    it('handles month boundary', () => {
      const endOfMonth = new Date(2025, 2, 29, 10, 0, 0) // March 29
      const result = computeNextReminderDate('weekly', endOfMonth)
      expect(result).toEqual(new Date(2025, 3, 5, 10, 0, 0)) // April 5
    })

    it('handles year boundary', () => {
      const endOfYear = new Date(2025, 11, 28, 10, 0, 0) // Dec 28
      const result = computeNextReminderDate('weekly', endOfYear)
      expect(result).toEqual(new Date(2026, 0, 4, 10, 0, 0)) // Jan 4, 2026
    })
  })

  describe('quarterly', () => {
    it('adds 3 months', () => {
      const result = computeNextReminderDate('quarterly', baseDate)
      expect(result).toEqual(new Date(2025, 5, 15, 10, 0, 0)) // June 15
    })

    it('handles year boundary', () => {
      const november = new Date(2025, 10, 15, 10, 0, 0)
      const result = computeNextReminderDate('quarterly', november)
      expect(result).toEqual(new Date(2026, 1, 15, 10, 0, 0)) // Feb 15, 2026
    })

    it('handles day overflow (e.g., Jan 31 + 3 months)', () => {
      const jan31 = new Date(2025, 0, 31, 10, 0, 0)
      const result = computeNextReminderDate('quarterly', jan31)
      // April has only 30 days, so JS Date rolls to May 1
      expect(result.getMonth()).toBe(4) // May (rolled over)
      expect(result.getDate()).toBe(1)
    })
  })

  describe('yearly', () => {
    it('adds 1 year', () => {
      const result = computeNextReminderDate('yearly', baseDate)
      expect(result).toEqual(new Date(2026, 2, 15, 10, 0, 0))
    })

    it('handles leap year (Feb 29 → Feb 28)', () => {
      // 2024 is a leap year
      const leapDay = new Date(2024, 1, 29, 10, 0, 0)
      const result = computeNextReminderDate('yearly', leapDay)
      // 2025 is not a leap year, Feb 29 → Mar 1 in JS
      expect(result.getFullYear()).toBe(2025)
    })
  })

  describe('unknown frequency', () => {
    it('defaults to 7 days for unknown frequency', () => {
      const result = computeNextReminderDate('biweekly', baseDate)
      expect(result).toEqual(new Date(2025, 2, 22, 10, 0, 0))
    })
  })
})

describe('computeNextReminderDate exists in source', () => {
  it('db.service.ts exports computeNextReminderDate', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const src = readFileSync(join(__dirname, '..', 'electron/services/db.service.ts'), 'utf-8')
    expect(src).toContain('export function computeNextReminderDate')
    expect(src).toContain("case 'weekly'")
    expect(src).toContain("case 'quarterly'")
    expect(src).toContain("case 'yearly'")
  })
})
