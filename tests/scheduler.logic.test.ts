import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunLog, Schedule } from '../shared/types'

interface SchedulerTestContext {
  scheduler: typeof import('../electron/services/scheduler.service')
  db: {
    getAllSchedules: ReturnType<typeof vi.fn>
    getScheduleById: ReturnType<typeof vi.fn>
    getContactById: ReturnType<typeof vi.fn>
    getLogsBySchedule: ReturnType<typeof vi.fn>
    getSettings: ReturnType<typeof vi.fn>
    insertRunLog: ReturnType<typeof vi.fn>
    toggleSchedule: ReturnType<typeof vi.fn>
    updateLastFiredAt: ReturnType<typeof vi.fn>
  }
  sendLinkedInMessage: ReturnType<typeof vi.fn>
  scheduleJob: ReturnType<typeof vi.fn>
  scheduledCallbacks: Array<(fireDate: Date) => Promise<void>>
  setSchedules: (records: Schedule[]) => void
  seedLogs: (scheduleId: string, logs: RunLog[]) => void
}

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

function makeRunLog(overrides: Partial<RunLog>): RunLog {
  return {
    id: 'log-1',
    scheduleId: 'test-id',
    status: 'success',
    errorMessage: null,
    firedAt: '2025-03-15T16:00:00.000Z',
    completedAt: '2025-03-15T16:00:00.000Z',
    retryAttempt: 0,
    ...overrides
  }
}

function makeSettings(maxRetries: number) {
  return {
    globalDryRun: false,
    sendDelayMs: 1000,
    pageLoadDelayMs: 1000,
    browserApp: 'Google Chrome',
    openAtLogin: false,
    maxRetries,
    theme: 'system' as const,
    defaultMessageTemplate: '',
    minIntervalBetweenSends: 60_000
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function setupSchedulerTest(options?: {
  maxRetries?: number
  now?: string
}): Promise<SchedulerTestContext> {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(options?.now ?? '2025-03-15T16:00:00.000Z'))

  const schedules = new Map<string, Schedule>()
  const logsBySchedule = new Map<string, RunLog[]>()
  let logCounter = 0

  const db = {
    getAllSchedules: vi.fn(() => Array.from(schedules.values())),
    getScheduleById: vi.fn((id: string) => schedules.get(id) ?? null),
    getContactById: vi.fn(() => ({
      id: 'contact-1',
      linkedinUrl: 'https://www.linkedin.com/in/test-user/'
    })),
    getLogsBySchedule: vi.fn((scheduleId: string) => logsBySchedule.get(scheduleId) ?? []),
    getSettings: vi.fn(() => makeSettings(options?.maxRetries ?? 2)),
    insertRunLog: vi.fn((
      scheduleId: string,
      status: RunLog['status'],
      errorMessage?: string,
      executionDuration?: number,
      scheduledTime?: string,
      retryAttempt = 0,
      retryOf?: string
    ) => {
      logCounter += 1
      const entry: RunLog = {
        id: `log-${logCounter}`,
        scheduleId,
        status,
        errorMessage: errorMessage ?? null,
        firedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionDuration,
        scheduledTime,
        retryAttempt,
        retryOf
      }
      const existing = logsBySchedule.get(scheduleId) ?? []
      logsBySchedule.set(scheduleId, [entry, ...existing])
      return entry
    }),
    toggleSchedule: vi.fn((id: string, enabled: boolean) => {
      const existing = schedules.get(id)
      if (!existing) {
        throw new Error(`Schedule ${id} not found`)
      }
      const updated = { ...existing, enabled }
      schedules.set(id, updated)
      return updated
    }),
    updateLastFiredAt: vi.fn((scheduleId: string) => {
      const existing = schedules.get(scheduleId)
      if (!existing) {
        return
      }
      schedules.set(scheduleId, { ...existing, lastFiredAt: new Date().toISOString() })
    })
  }

  const sendLinkedInMessage = vi.fn().mockResolvedValue({
    success: true,
    dryRun: false
  })
  const scheduleJob = vi.fn((rule: unknown, callback: (fireDate: Date) => Promise<void>) => {
    scheduledCallbacks.push(callback)
    return {
      cancel: vi.fn(),
      nextInvocation: vi.fn(() => null)
    }
  })
  const scheduledCallbacks: Array<(fireDate: Date) => Promise<void>> = []

  class MockRecurrenceRule {
    dayOfWeek?: number
    hour?: number
    minute?: number
    second?: number
    month?: number | number[]
    date?: number
  }

  vi.doMock('../electron/services/db.service', () => db)
  vi.doMock('../electron/services/linkedin.service', () => ({ sendLinkedInMessage }))
  vi.doMock('../electron/utils/applescript', () => ({
    runAppleScript: vi.fn().mockResolvedValue('false')
  }))
  vi.doMock('../electron/utils/logger', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }))
  vi.doMock('@shared/linkedin', () => ({
    normalizeLinkedInProfileUrl: (url: string) => url
  }))
  vi.doMock('node-schedule', () => ({
    scheduleJob,
    RecurrenceRule: MockRecurrenceRule
  }))

  const scheduler = await import('../electron/services/scheduler.service')

  return {
    scheduler,
    db,
    sendLinkedInMessage,
    scheduleJob,
    scheduledCallbacks,
    setSchedules(records: Schedule[]) {
      schedules.clear()
      for (const record of records) {
        schedules.set(record.id, { ...record })
      }
    },
    seedLogs(scheduleId: string, logs: RunLog[]) {
      logsBySchedule.set(scheduleId, [...logs])
    }
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('getMostRecentExpectedFire', () => {
  it('returns most recent matching day of week', async () => {
    const { scheduler } = await setupSchedulerTest()
    const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: '09:00', dayOfWeek: 3 })
    const now = new Date(2025, 2, 15, 10, 0)

    expect(scheduler.getMostRecentExpectedFire(s, now)).toEqual(new Date(2025, 2, 12, 9, 0, 0, 0))
  })

  it('returns today if it is the matching day and time has passed', async () => {
    const { scheduler } = await setupSchedulerTest()
    const s = makeSchedule({ scheduleType: 'weekly', timeOfDay: '08:00', dayOfWeek: 6 })
    const now = new Date(2025, 2, 15, 10, 0)

    expect(scheduler.getMostRecentExpectedFire(s, now)).toEqual(new Date(2025, 2, 15, 8, 0, 0, 0))
  })

  it('returns previous year if this year date has not happened yet', async () => {
    const { scheduler } = await setupSchedulerTest()
    const s = makeSchedule({
      scheduleType: 'yearly',
      timeOfDay: '10:00',
      dayOfMonth: 25,
      monthOfYear: 11
    })
    const now = new Date(2025, 2, 15, 10, 0)

    expect(scheduler.getMostRecentExpectedFire(s, now)).toEqual(new Date(2024, 11, 25, 10, 0, 0, 0))
  })

  it('returns null for one-time schedules', async () => {
    const { scheduler } = await setupSchedulerTest()
    expect(scheduler.getMostRecentExpectedFire(makeSchedule({ scheduleType: 'one_time' }), new Date())).toBeNull()
  })
})

describe('scheduler execution semantics', () => {
  it('treats maxRetries=0 as no retries after the initial failure', async () => {
    const ctx = await setupSchedulerTest({ maxRetries: 0 })
    const schedule = makeSchedule({ scheduleType: 'weekly', dayOfWeek: 6 })
    ctx.setSchedules([schedule])
    ctx.sendLinkedInMessage.mockResolvedValueOnce({
      success: false,
      dryRun: false,
      error: 'Temporary failure'
    })

    ctx.scheduler.registerJob(schedule)
    await ctx.scheduledCallbacks[0](new Date('2025-03-15T15:00:00.000Z'))

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(1)
    expect(ctx.db.insertRunLog).toHaveBeenCalledTimes(1)
    expect(ctx.db.insertRunLog.mock.calls.map((call) => call[5])).toEqual([0])
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
  })

  it('retries exactly maxRetries additional times without creating a synthetic terminal log', async () => {
    const ctx = await setupSchedulerTest({ maxRetries: 2 })
    const schedule = makeSchedule({ scheduleType: 'weekly', dayOfWeek: 6 })
    ctx.setSchedules([schedule])
    ctx.sendLinkedInMessage
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })

    ctx.scheduler.registerJob(schedule)
    await ctx.scheduledCallbacks[0](new Date('2025-03-15T15:00:00.000Z'))
    await vi.runAllTimersAsync()

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(3)
    expect(ctx.db.insertRunLog).toHaveBeenCalledTimes(3)
    expect(ctx.db.insertRunLog.mock.calls.map((call) => call[5])).toEqual([0, 1, 2])
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
  })

  it('keeps manual test sends non-consuming for one-time schedules', async () => {
    const ctx = await setupSchedulerTest()
    const schedule = makeSchedule({
      scheduleType: 'one_time',
      scheduledAt: '2025-03-15T17:00:00.000Z'
    })
    ctx.setSchedules([schedule])

    ctx.scheduler.registerJob(schedule)
    await ctx.scheduler.testSendSchedule(schedule.id)

    expect(ctx.db.toggleSchedule).not.toHaveBeenCalled()
    expect(ctx.db.updateLastFiredAt).not.toHaveBeenCalled()
    expect(ctx.db.insertRunLog.mock.calls[0]?.[4]).toBeUndefined()

    await ctx.scheduledCallbacks[0](new Date(schedule.scheduledAt!))

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(2)
    expect(ctx.db.toggleSchedule).toHaveBeenCalledTimes(1)
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
  })

  it('does not cancel a pending scheduled retry when a manual test send runs', async () => {
    const ctx = await setupSchedulerTest({ maxRetries: 1 })
    const schedule = makeSchedule({ scheduleType: 'weekly', dayOfWeek: 6 })
    ctx.setSchedules([schedule])
    ctx.sendLinkedInMessage
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: true, dryRun: false })
      .mockResolvedValueOnce({ success: true, dryRun: false })

    ctx.scheduler.registerJob(schedule)
    await ctx.scheduledCallbacks[0](new Date('2025-03-15T15:00:00.000Z'))
    expect(vi.getTimerCount()).toBe(1)

    await ctx.scheduler.testSendSchedule(schedule.id)
    await vi.runAllTimersAsync()

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(3)
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
  })

  it('keeps one-time schedules enabled until their final retry attempt finishes', async () => {
    const ctx = await setupSchedulerTest({ maxRetries: 2 })
    const schedule = makeSchedule({
      scheduleType: 'one_time',
      scheduledAt: '2025-03-16T17:00:00.000Z'
    })
    ctx.setSchedules([schedule])
    ctx.sendLinkedInMessage
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({ success: false, dryRun: false, error: 'Temporary failure' })

    ctx.scheduler.registerJob(schedule)
    await ctx.scheduledCallbacks[0](new Date(schedule.scheduledAt!))
    expect(ctx.db.toggleSchedule).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(ctx.db.toggleSchedule).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(45_000)
    expect(ctx.db.toggleSchedule).toHaveBeenCalledTimes(1)
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
  })
})

describe('scheduler catch-up and recovery', () => {
  it('does not catch up recurring runs that predate schedule creation', async () => {
    const ctx = await setupSchedulerTest({ now: '2025-03-15T16:00:00.000Z' })
    const schedule = makeSchedule({
      scheduleType: 'weekly',
      dayOfWeek: 3,
      timeOfDay: '09:00',
      createdAt: '2025-03-13T12:00:00.000Z'
    })
    ctx.setSchedules([schedule])

    ctx.scheduler.initScheduler()
    await flushPromises()

    expect(ctx.sendLinkedInMessage).not.toHaveBeenCalled()
    expect(ctx.db.insertRunLog).not.toHaveBeenCalled()
  })

  it('still catches up a missed recurring run after a manual test send', async () => {
    const ctx = await setupSchedulerTest({ now: '2025-03-15T16:00:00.000Z' })
    const schedule = makeSchedule({
      scheduleType: 'weekly',
      dayOfWeek: 6,
      timeOfDay: '09:00',
      createdAt: '2025-03-01T00:00:00.000Z'
    })
    ctx.setSchedules([schedule])

    await ctx.scheduler.testSendSchedule(schedule.id)
    ctx.scheduler.initScheduler()
    await flushPromises()

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(2)
    expect(ctx.db.updateLastFiredAt).toHaveBeenCalledTimes(1)
    expect(ctx.db.insertRunLog.mock.calls.some(
      (call) => call[1] === 'skipped' && typeof call[2] === 'string' && call[2].includes('Missed')
    )).toBe(true)
  })

  it('recovers a past-due one-time schedule when prior attempts were not terminal', async () => {
    const ctx = await setupSchedulerTest({ maxRetries: 2, now: '2025-03-15T16:00:00.000Z' })
    const schedule = makeSchedule({
      scheduleType: 'one_time',
      scheduledAt: '2025-03-15T15:00:00.000Z',
      createdAt: '2025-03-10T00:00:00.000Z'
    })
    ctx.setSchedules([schedule])
    ctx.seedLogs(schedule.id, [
      makeRunLog({
        scheduleId: schedule.id,
        status: 'failed',
        errorMessage: 'Temporary failure',
        scheduledTime: schedule.scheduledAt!,
        retryAttempt: 0
      })
    ])

    ctx.scheduler.initScheduler()
    await flushPromises()

    expect(ctx.sendLinkedInMessage).toHaveBeenCalledTimes(1)
    expect(ctx.db.insertRunLog).toHaveBeenCalledTimes(1)
    expect(ctx.db.insertRunLog.mock.calls[0]?.[4]).toBe(schedule.scheduledAt)
    expect(ctx.db.toggleSchedule).toHaveBeenCalledTimes(1)
  })
})
