import { describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3', () => ({
  default: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id')
}))

vi.mock('../electron/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  })
}))

import { computeNextReminderDate } from '../electron/services/db.service'

describe('computeNextReminderDate', () => {
  const baseDate = new Date(2025, 2, 15, 10, 0, 0)

  describe('weekly', () => {
    it('adds 7 days', () => {
      expect(computeNextReminderDate('weekly', baseDate))
        .toEqual(new Date(2025, 2, 22, 10, 0, 0))
    })

    it('handles month and year boundaries', () => {
      expect(computeNextReminderDate('weekly', new Date(2025, 2, 29, 10, 0, 0)))
        .toEqual(new Date(2025, 3, 5, 10, 0, 0))
      expect(computeNextReminderDate('weekly', new Date(2025, 11, 28, 10, 0, 0)))
        .toEqual(new Date(2026, 0, 4, 10, 0, 0))
    })
  })

  describe('quarterly', () => {
    it('adds 3 months and rolls across years', () => {
      expect(computeNextReminderDate('quarterly', baseDate))
        .toEqual(new Date(2025, 5, 15, 10, 0, 0))
      expect(computeNextReminderDate('quarterly', new Date(2025, 10, 15, 10, 0, 0)))
        .toEqual(new Date(2026, 1, 15, 10, 0, 0))
    })

    it('keeps JavaScript date overflow semantics for long months', () => {
      const result = computeNextReminderDate('quarterly', new Date(2025, 0, 31, 10, 0, 0))

      expect(result.getMonth()).toBe(4)
      expect(result.getDate()).toBe(1)
    })
  })

  describe('yearly', () => {
    it('adds one calendar year', () => {
      expect(computeNextReminderDate('yearly', baseDate))
        .toEqual(new Date(2026, 2, 15, 10, 0, 0))
    })

    it('preserves native leap-day rollover behavior', () => {
      const result = computeNextReminderDate('yearly', new Date(2024, 1, 29, 10, 0, 0))

      expect(result.getFullYear()).toBe(2025)
    })
  })

  it('falls back to weekly cadence for unknown frequencies', () => {
    expect(computeNextReminderDate('biweekly', baseDate))
      .toEqual(new Date(2025, 2, 22, 10, 0, 0))
  })
})
