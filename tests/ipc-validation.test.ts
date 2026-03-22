import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Replicate the validation logic from schedule.ipc.ts and contacts.ipc.ts
 * since they can't be imported directly (Electron dependency).
 */

type ScheduleType = 'one_time' | 'weekly' | 'quarterly' | 'half_yearly' | 'yearly'

interface CreateScheduleInput {
  contactId: string
  message: string
  scheduleType: ScheduleType
  scheduledAt?: string
  timeOfDay?: string
  dayOfWeek?: number
  dayOfMonth?: number
  monthOfYear?: number
  dryRun?: boolean
}

const VALID_SCHEDULE_TYPES = new Set<ScheduleType>([
  'one_time', 'weekly', 'quarterly', 'half_yearly', 'yearly'
])

const TIME_OF_DAY_RE = /^\d{2}:\d{2}$/

function validateScheduleInput(data: CreateScheduleInput): string | null {
  if (!data.contactId || typeof data.contactId !== 'string') {
    return 'Contact is required'
  }
  if (!data.message || typeof data.message !== 'string' || data.message.trim().length === 0) {
    return 'Message is required'
  }
  if (!VALID_SCHEDULE_TYPES.has(data.scheduleType)) {
    return `Invalid schedule type: ${data.scheduleType}`
  }
  if (data.scheduleType === 'one_time') {
    if (!data.scheduledAt || isNaN(Date.parse(data.scheduledAt))) {
      return 'scheduledAt must be a valid ISO date for one-time schedules'
    }
  } else {
    if (!data.timeOfDay || !TIME_OF_DAY_RE.test(data.timeOfDay)) {
      return 'timeOfDay must be in HH:mm format for recurring schedules'
    }
  }
  return null
}

describe('IPC schedule input validation', () => {
  const validOneTime: CreateScheduleInput = {
    contactId: 'contact-123',
    message: 'Hello!',
    scheduleType: 'one_time',
    scheduledAt: new Date(Date.now() + 86400000).toISOString()
  }

  const validWeekly: CreateScheduleInput = {
    contactId: 'contact-123',
    message: 'Weekly check-in',
    scheduleType: 'weekly',
    timeOfDay: '09:00'
  }

  it('accepts valid one-time schedule', () => {
    expect(validateScheduleInput(validOneTime)).toBeNull()
  })

  it('accepts valid weekly schedule', () => {
    expect(validateScheduleInput(validWeekly)).toBeNull()
  })

  it('rejects empty contactId', () => {
    const input = { ...validOneTime, contactId: '' }
    expect(validateScheduleInput(input)).toContain('Contact')
  })

  it('rejects empty message', () => {
    const input = { ...validOneTime, message: '' }
    expect(validateScheduleInput(input)).toContain('Message')
  })

  it('rejects whitespace-only message', () => {
    const input = { ...validOneTime, message: '   ' }
    expect(validateScheduleInput(input)).toContain('Message')
  })

  it('rejects invalid schedule type', () => {
    const input = { ...validOneTime, scheduleType: 'daily' as ScheduleType }
    expect(validateScheduleInput(input)).toContain('Invalid schedule type')
  })

  it('rejects one-time without scheduledAt', () => {
    const input = { ...validOneTime, scheduledAt: undefined }
    expect(validateScheduleInput(input)).toContain('scheduledAt')
  })

  it('rejects one-time with invalid date', () => {
    const input = { ...validOneTime, scheduledAt: 'not-a-date' }
    expect(validateScheduleInput(input)).toContain('scheduledAt')
  })

  it('rejects recurring without timeOfDay', () => {
    const input = { ...validWeekly, timeOfDay: undefined }
    expect(validateScheduleInput(input)).toContain('timeOfDay')
  })

  it('rejects recurring with bad timeOfDay format', () => {
    const input = { ...validWeekly, timeOfDay: '9:00' }
    expect(validateScheduleInput(input)).toContain('timeOfDay')
  })

  it('accepts all valid schedule types', () => {
    for (const type of ['one_time', 'weekly', 'quarterly', 'half_yearly', 'yearly'] as ScheduleType[]) {
      const input: CreateScheduleInput = {
        contactId: 'contact-123',
        message: 'test',
        scheduleType: type,
        ...(type === 'one_time'
          ? { scheduledAt: new Date(Date.now() + 86400000).toISOString() }
          : { timeOfDay: '09:00' })
      }
      expect(validateScheduleInput(input)).toBeNull()
    }
  })

  it('rejects "daily" as a schedule type (not supported in LockedIn)', () => {
    const input = { ...validOneTime, scheduleType: 'daily' as ScheduleType }
    expect(validateScheduleInput(input)).not.toBeNull()
  })
})

describe('IPC validation functions exist in source', () => {
  it('schedule.ipc.ts contains validateCreateInput', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/ipc/schedule.ipc.ts'), 'utf-8')
    expect(src).toContain('validateCreateInput')
    expect(src).toContain('VALID_SCHEDULE_TYPES')
    expect(src).toContain('TIME_OF_DAY_RE')
  })

  it('contacts.ipc.ts contains validateCreateInput', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/ipc/contacts.ipc.ts'), 'utf-8')
    expect(src).toContain('validateCreateInput')
    expect(src).toContain('LINKEDIN_URL_RE')
  })
})
