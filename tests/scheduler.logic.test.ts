import { describe, it, expect } from 'vitest'
import { getMostRecentExpectedFire } from '../electron/services/scheduler.service'
import type { Schedule } from '../shared/types'

function makeSchedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 'test-id',
    contactId: 'contact-1',
    contactName: 'Test User',
    message: 'Hello',
    scheduleType: 'weekly',
    scheduledAt: null,
    timeOfDay: '09:00',
    dayOfWeek: null,
    dayOfMonth: null,
    monthOfYear: null,
    enabled: true,
    dryRun: false,
    lastFiredAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('getMostRecentExpectedFire', () => {
  describe('weekly schedules', () => {
    it('returns most recent matching day of week', () => {
      // Wednesday = dayOfWeek 3
      const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: '09:00', dayOfWeek: 3 })
      // Now is Saturday March 15, 2025
      const now = new Date(2025, 2, 15, 10, 0)
      const result = getMostRecentExpectedFire(s, now)
      // Most recent Wednesday before March 15 (Saturday) is March 12
      expect(result).toEqual(new Date(2025, 2, 12, 9, 0, 0, 0))
    })

    it('returns today if it is the matching day and time has passed', () => {
      // Saturday = dayOfWeek 6
      const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: '08:00', dayOfWeek: 6 })
      // Now is Saturday March 15, 2025
      const now = new Date(2025, 2, 15, 10, 0)
      const result = getMostRecentExpectedFire(s, now)
      expect(result).toEqual(new Date(2025, 2, 15, 8, 0, 0, 0))
    })

    it('returns null if dayOfWeek is missing', () => {
      const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: '09:00', dayOfWeek: null })
      const result = getMostRecentExpectedFire(s, new Date())
      expect(result).toBeNull()
    })
  })

  describe('yearly schedules', () => {
    it('returns most recent matching month and day', () => {
      const s = makeSchedule({
        scheduleType: 'yearly',
        timeOfDay: '10:00',
        dayOfMonth: 1,
        monthOfYear: 0 // January
      })
      const now = new Date(2025, 2, 15, 10, 0) // March 2025
      const result = getMostRecentExpectedFire(s, now)
      expect(result).toEqual(new Date(2025, 0, 1, 10, 0, 0, 0))
    })

    it('returns previous year if this year date has not happened yet', () => {
      const s = makeSchedule({
        scheduleType: 'yearly',
        timeOfDay: '10:00',
        dayOfMonth: 25,
        monthOfYear: 11 // December
      })
      const now = new Date(2025, 2, 15, 10, 0) // March 2025
      const result = getMostRecentExpectedFire(s, now)
      expect(result).toEqual(new Date(2024, 11, 25, 10, 0, 0, 0))
    })

    it('returns null if required fields are missing', () => {
      const s = makeSchedule({ scheduleType: 'yearly', timeOfDay: '10:00', dayOfMonth: null })
      expect(getMostRecentExpectedFire(s, new Date())).toBeNull()
    })
  })

  describe('quarterly schedules', () => {
    it('returns most recent quarterly fire date', () => {
      const s = makeSchedule({
        scheduleType: 'quarterly',
        timeOfDay: '10:00',
        dayOfMonth: 15,
        monthOfYear: 0 // Jan, Apr, Jul, Oct
      })
      const now = new Date(2025, 2, 20, 10, 0) // March 20, 2025
      const result = getMostRecentExpectedFire(s, now)
      // Most recent quarterly fire: Jan 15
      expect(result).toEqual(new Date(2025, 0, 15, 10, 0, 0, 0))
    })
  })

  describe('half_yearly schedules', () => {
    it('returns most recent half-yearly fire date', () => {
      const s = makeSchedule({
        scheduleType: 'half_yearly',
        timeOfDay: '10:00',
        dayOfMonth: 1,
        monthOfYear: 2 // Mar, Sep
      })
      const now = new Date(2025, 5, 15, 10, 0) // June 15, 2025
      const result = getMostRecentExpectedFire(s, now)
      // Most recent: March 1
      expect(result).toEqual(new Date(2025, 2, 1, 10, 0, 0, 0))
    })
  })

  describe('one_time schedules', () => {
    it('returns null for one-time (no recurrence to compute)', () => {
      const s = makeSchedule({ scheduleType: 'one_time' })
      expect(getMostRecentExpectedFire(s, new Date())).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('returns null if timeOfDay is missing', () => {
      const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: null, dayOfWeek: 1 })
      expect(getMostRecentExpectedFire(s, new Date())).toBeNull()
    })
  })
})
