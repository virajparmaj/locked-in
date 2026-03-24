import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, ElectronAPI } from '../shared/types'

function makeSettings(): AppSettings {
  return {
    globalDryRun: false,
    sendDelayMs: 5000,
    pageLoadDelayMs: 4000,
    browserApp: 'Google Chrome',
    openAtLogin: false,
    maxRetries: 2,
    theme: 'system',
    defaultMessageTemplate: '',
    minIntervalBetweenSends: 60000
  }
}

function makeRawApi(): ElectronAPI {
  return {
    // Contacts
    getContacts: vi.fn().mockResolvedValue([]),
    getContact: vi.fn().mockResolvedValue(null),
    createContact: vi.fn().mockResolvedValue(undefined),
    updateContact: vi.fn().mockResolvedValue(undefined),
    deleteContact: vi.fn().mockResolvedValue(undefined),
    searchContacts: vi.fn().mockResolvedValue([]),

    // Schedules
    getSchedules: vi.fn().mockResolvedValue([]),
    getSchedule: vi.fn().mockResolvedValue(null),
    getSchedulesByContact: vi.fn().mockResolvedValue([]),
    createSchedule: vi.fn().mockResolvedValue(undefined),
    updateSchedule: vi.fn().mockResolvedValue(undefined),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    toggleSchedule: vi.fn().mockResolvedValue(undefined),
    testSend: vi.fn().mockResolvedValue({ success: true, dryRun: false }),
    getNextFireTimes: vi.fn().mockResolvedValue({}),
    checkConflicts: vi.fn().mockResolvedValue([]),

    // Reminders
    getReminders: vi.fn().mockResolvedValue([]),
    createReminder: vi.fn().mockResolvedValue(undefined),
    updateReminder: vi.fn().mockResolvedValue(undefined),
    deleteReminder: vi.fn().mockResolvedValue(undefined),
    snoozeReminder: vi.fn().mockResolvedValue(undefined),
    openMessageCompose: vi.fn().mockResolvedValue(undefined),

    // Logs
    getLogs: vi.fn().mockResolvedValue([]),
    getLogsBySchedule: vi.fn().mockResolvedValue([]),
    clearLogs: vi.fn().mockResolvedValue(undefined),

    // Settings
    getSettings: vi.fn().mockResolvedValue(makeSettings()),
    updateSetting: vi.fn().mockResolvedValue(undefined),

    // System
    checkChromeAccess: vi.fn().mockResolvedValue({ granted: true }),
    openLinkedInInChrome: vi.fn().mockResolvedValue(undefined),

    // Events
    onScheduleExecuted: vi.fn().mockReturnValue(() => undefined),
    onReminderTriggered: vi.fn().mockReturnValue(() => undefined)
  }
}

async function loadModule(rawApi?: ElectronAPI) {
  vi.resetModules()
  const api = rawApi ?? makeRawApi()
  vi.stubGlobal('window', { api })
  const mod = await import('../src/lib/ipc')
  return { api, mod }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('renderer IPC wrapper', () => {
  it('resolves async methods through timeout wrapper', async () => {
    const rawApi = makeRawApi()
    rawApi.getSchedules = vi.fn().mockResolvedValue([{ id: 'schedule-1' }])

    const { mod } = await loadModule(rawApi)
    const wrapped = mod.createIpcApi(rawApi)

    await expect(wrapped.getSchedules()).resolves.toEqual([{ id: 'schedule-1' }])
    expect(rawApi.getSchedules).toHaveBeenCalledTimes(1)
  })

  it('propagates rejected async calls without altering the error', async () => {
    const rawApi = makeRawApi()
    const err = new Error('boom')
    rawApi.getSchedules = vi.fn().mockRejectedValue(err)

    const { mod } = await loadModule(rawApi)
    const wrapped = mod.createIpcApi(rawApi)

    await expect(wrapped.getSchedules()).rejects.toBe(err)
  })

  it('rejects with timeout error when an IPC promise never settles', async () => {
    vi.useFakeTimers()
    const rawApi = makeRawApi()
    rawApi.getSchedules = vi.fn().mockImplementation(
      () => new Promise(() => undefined)
    )

    const { mod } = await loadModule(rawApi)
    const wrapped = mod.createIpcApi(rawApi)

    const pending = wrapped.getSchedules()
    const assertion = expect(pending).rejects.toThrow('IPC call "getSchedules" timed out after 10s')
    await vi.advanceTimersByTimeAsync(10_000)

    await assertion
  })

  it('passes through event listeners without timeout wrapping', async () => {
    const rawApi = makeRawApi()
    const unsubSchedule = vi.fn()
    const unsubReminder = vi.fn()
    rawApi.onScheduleExecuted = vi.fn().mockReturnValue(unsubSchedule)
    rawApi.onReminderTriggered = vi.fn().mockReturnValue(unsubReminder)
    const onSchedule = vi.fn()
    const onReminder = vi.fn()

    const { mod } = await loadModule(rawApi)
    const wrapped = mod.createIpcApi(rawApi)

    expect(wrapped.onScheduleExecuted(onSchedule)).toBe(unsubSchedule)
    expect(wrapped.onReminderTriggered(onReminder)).toBe(unsubReminder)
    expect(rawApi.onScheduleExecuted).toHaveBeenCalledWith(onSchedule)
    expect(rawApi.onReminderTriggered).toHaveBeenCalledWith(onReminder)
  })

  it('handles non-configurable source methods without proxy invariant errors', async () => {
    const rawApi = makeRawApi()
    const getSchedules = vi.fn().mockResolvedValue([])

    Object.defineProperty(rawApi, 'getSchedules', {
      value: getSchedules,
      writable: false,
      configurable: false
    })

    const { mod } = await loadModule(rawApi)
    const wrapped = mod.createIpcApi(rawApi)

    await expect(wrapped.getSchedules()).resolves.toEqual([])
    expect(getSchedules).toHaveBeenCalledTimes(1)
  })

  it('exports a frozen shared api instance', async () => {
    const rawApi = makeRawApi()

    const { mod } = await loadModule(rawApi)

    expect(Object.isFrozen(mod.api)).toBe(true)
  })
})
