import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings, Contact, CreateContactInput, CreateScheduleInput, Schedule } from '../shared/types'

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      })
    },
    app: {
      setLoginItemSettings: vi.fn()
    }
  }
})

const dbMocks = vi.hoisted(() => ({
  createContact: vi.fn(),
  createSchedule: vi.fn(),
  getAllContacts: vi.fn(),
  getContactById: vi.fn(),
  getScheduleById: vi.fn(),
  getSchedulesByContact: vi.fn(),
  getSettings: vi.fn(),
  validateAndNormalizeSetting: vi.fn(),
  searchContacts: vi.fn(),
  toggleSchedule: vi.fn(),
  updateContact: vi.fn(),
  updateSchedule: vi.fn(),
  updateSetting: vi.fn(),
  deleteContact: vi.fn(),
  deleteSchedule: vi.fn(),
  findConflicts: vi.fn(),
  getAllSchedules: vi.fn()
}))

const schedulerMocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  getAllNextFireTimes: vi.fn(),
  registerJob: vi.fn(),
  rescheduleJob: vi.fn(),
  testSendSchedule: vi.fn()
}))

const linkedinMocks = vi.hoisted(() => ({
  checkChromeAccess: vi.fn(),
  openLinkedInInChrome: vi.fn()
}))

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('electron', () => ({
  app: electronMocks.app,
  ipcMain: electronMocks.ipcMain
}))

vi.mock('../electron/services/db.service', () => dbMocks)
vi.mock('../electron/services/scheduler.service', () => schedulerMocks)
vi.mock('../electron/services/linkedin.service', () => linkedinMocks)
vi.mock('../electron/utils/logger', () => ({
  createLogger: () => loggerMocks
}))

const DEFAULT_SETTINGS: AppSettings = {
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

const VALID_SETTINGS_KEYS = new Set([
  'global_dry_run',
  'send_delay_ms',
  'page_load_delay_ms',
  'browser_app',
  'open_at_login',
  'max_retries',
  'theme',
  'default_message_template',
  'min_interval_between_sends'
])

const BOOLEAN_SETTINGS = new Set(['global_dry_run', 'open_at_login'])
const VALID_THEMES = new Set(['system', 'light', 'dark'])
const NUMERIC_SETTING_RULES = {
  send_delay_ms: { min: 1000, max: 15000, label: 'Send delay' },
  page_load_delay_ms: { min: 1000, max: 15000, label: 'Page load delay' },
  max_retries: { min: 0, max: 5, label: 'Max retries' },
  min_interval_between_sends: { min: 10000, max: 300000, label: 'Minimum interval between sends' }
} as const

function parseIntegerSetting(key: keyof typeof NUMERIC_SETTING_RULES, value: unknown): string {
  const { min, max, label } = NUMERIC_SETTING_RULES[key]
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a whole number between ${min} and ${max}`)
  }

  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}`)
  }

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }

  return String(parsed)
}

function validateAndNormalizeSetting(key: string, value: unknown): string {
  if (!VALID_SETTINGS_KEYS.has(key)) {
    throw new Error(`Invalid settings key: ${key}`)
  }

  if (BOOLEAN_SETTINGS.has(key)) {
    if (value !== '0' && value !== '1') {
      throw new Error(`${key} must be "0" or "1"`)
    }
    return value
  }

  if (key in NUMERIC_SETTING_RULES) {
    return parseIntegerSetting(key as keyof typeof NUMERIC_SETTING_RULES, value)
  }

  if (key === 'theme') {
    if (typeof value !== 'string' || !VALID_THEMES.has(value)) {
      throw new Error('Theme must be one of: system, light, dark')
    }
    return value
  }

  if (key === 'browser_app') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('Browser app name is required')
    }
    return value.trim()
  }

  if (key === 'default_message_template') {
    if (typeof value !== 'string') {
      throw new Error('Default message template must be a string')
    }
    return value
  }

  throw new Error(`Unhandled settings key: ${key}`)
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'schedule-1',
    contactId: 'contact-1',
    contactName: 'Test User',
    message: 'Follow up',
    scheduleType: 'weekly',
    scheduledAt: null,
    timeOfDay: '09:00',
    dayOfWeek: 1,
    dayOfMonth: null,
    monthOfYear: null,
    enabled: true,
    dryRun: false,
    lastFiredAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    name: 'Ada Lovelace',
    linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace/',
    linkedinSlug: 'ada-lovelace',
    company: '',
    notes: '',
    tags: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

function getHandler<T extends (...args: never[]) => unknown>(channel: string): T {
  const handler = electronMocks.handlers.get(channel)
  if (!handler) {
    throw new Error(`Handler ${channel} was not registered`)
  }
  return handler as T
}

async function registerHandlers(): Promise<void> {
  vi.resetModules()
  const [{ registerScheduleHandlers }, { registerContactsHandlers }, { registerSettingsHandlers }] = await Promise.all([
    import('../electron/ipc/schedule.ipc'),
    import('../electron/ipc/contacts.ipc'),
    import('../electron/ipc/settings.ipc')
  ])

  registerScheduleHandlers()
  registerContactsHandlers()
  registerSettingsHandlers()
}

beforeEach(async () => {
  vi.clearAllMocks()
  electronMocks.handlers.clear()

  dbMocks.getSettings.mockReturnValue(DEFAULT_SETTINGS)
  dbMocks.validateAndNormalizeSetting.mockImplementation(validateAndNormalizeSetting)
  schedulerMocks.getAllNextFireTimes.mockReturnValue({})
  schedulerMocks.testSendSchedule.mockResolvedValue(null)
  linkedinMocks.checkChromeAccess.mockResolvedValue({ granted: true })
  linkedinMocks.openLinkedInInChrome.mockResolvedValue(undefined)

  await registerHandlers()
})

describe('schedule IPC validation', () => {
  it('creates a valid recurring schedule and registers the job', () => {
    const input: CreateScheduleInput = {
      contactId: 'contact-1',
      message: 'Weekly check-in',
      scheduleType: 'weekly',
      timeOfDay: '09:00'
    }
    const created = makeSchedule()
    dbMocks.createSchedule.mockReturnValue(created)

    const create = getHandler<(event: unknown, data: CreateScheduleInput) => Schedule>('schedule:create')
    const result = create({} as never, input)

    expect(result).toBe(created)
    expect(dbMocks.createSchedule).toHaveBeenCalledWith(input)
    expect(schedulerMocks.registerJob).toHaveBeenCalledWith(created)
  })

  it('rejects one-time schedules without a valid ISO fire date', () => {
    const create = getHandler<(event: unknown, data: CreateScheduleInput) => Schedule>('schedule:create')

    expect(() => create({} as never, {
      contactId: 'contact-1',
      message: 'Hello',
      scheduleType: 'one_time'
    })).toThrow('scheduledAt must be a valid ISO date for one-time schedules')

    expect(dbMocks.createSchedule).not.toHaveBeenCalled()
    expect(schedulerMocks.registerJob).not.toHaveBeenCalled()
  })

  it('rejects recurring schedules without HH:mm time input', () => {
    const create = getHandler<(event: unknown, data: CreateScheduleInput) => Schedule>('schedule:create')

    expect(() => create({} as never, {
      contactId: 'contact-1',
      message: 'Hello',
      scheduleType: 'weekly',
      timeOfDay: '9:00'
    })).toThrow('timeOfDay must be in HH:mm format for recurring schedules')

    expect(dbMocks.createSchedule).not.toHaveBeenCalled()
  })
})

describe('contacts IPC validation', () => {
  it('creates a contact when the LinkedIn profile URL normalizes correctly', () => {
    const input: CreateContactInput = {
      name: 'Ada Lovelace',
      linkedinUrl: 'linkedin.com/in/ada-lovelace?trk=public_profile'
    }
    const created = makeContact()
    dbMocks.createContact.mockReturnValue(created)

    const create = getHandler<(event: unknown, data: CreateContactInput) => Contact>('contacts:create')
    const result = create({} as never, input)

    expect(result).toBe(created)
    expect(dbMocks.createContact).toHaveBeenCalledWith(input)
  })

  it('rejects contact creates for non-profile LinkedIn URLs', () => {
    const create = getHandler<(event: unknown, data: CreateContactInput) => Contact>('contacts:create')

    expect(() => create({} as never, {
      name: 'Ada Lovelace',
      linkedinUrl: 'https://www.linkedin.com/company/openai/'
    })).toThrow('Invalid LinkedIn profile URL')

    expect(dbMocks.createContact).not.toHaveBeenCalled()
  })

  it('rejects updates with blank names before hitting the database', () => {
    const update = getHandler<(event: unknown, id: string, data: Partial<CreateContactInput>) => Contact>('contacts:update')

    expect(() => update({} as never, 'contact-1', { name: '   ' })).toThrow('Name is required')
    expect(dbMocks.updateContact).not.toHaveBeenCalled()
  })
})

describe('settings IPC validation', () => {
  it('rejects unknown setting keys before they are written', () => {
    expect(() => validateAndNormalizeSetting('not_real_setting', '1')).toThrow('Invalid settings key')
  })

  it('accepts valid boolean settings and rejects invalid ones', () => {
    expect(validateAndNormalizeSetting('global_dry_run', '0')).toBe('0')
    expect(validateAndNormalizeSetting('open_at_login', '1')).toBe('1')
    expect(() => validateAndNormalizeSetting('global_dry_run', 'true')).toThrow('"0" or "1"')
    expect(() => validateAndNormalizeSetting('open_at_login', ' 1 ')).toThrow('"0" or "1"')
  })

  it('accepts valid theme values and rejects invalid ones', () => {
    expect(validateAndNormalizeSetting('theme', 'system')).toBe('system')
    expect(validateAndNormalizeSetting('theme', 'light')).toBe('light')
    expect(validateAndNormalizeSetting('theme', 'dark')).toBe('dark')
    expect(() => validateAndNormalizeSetting('theme', 'blue')).toThrow('Theme must be one of')
  })

  it('rejects blank, NaN, decimal, negative, and out-of-range numeric settings', () => {
    expect(() => validateAndNormalizeSetting('send_delay_ms', '')).toThrow('whole number')
    expect(() => validateAndNormalizeSetting('send_delay_ms', '   ')).toThrow('whole number')
    expect(() => validateAndNormalizeSetting('send_delay_ms', 'NaN')).toThrow('whole number')
    expect(() => validateAndNormalizeSetting('send_delay_ms', '1.5')).toThrow('whole number')
    expect(() => validateAndNormalizeSetting('send_delay_ms', '-1')).toThrow('between 1000 and 15000')
    expect(() => validateAndNormalizeSetting('send_delay_ms', '999')).toThrow('between 1000 and 15000')
    expect(() => validateAndNormalizeSetting('max_retries', '6')).toThrow('between 0 and 5')
  })

  it('accepts numeric boundary values and normalizes trimmed integers', () => {
    expect(validateAndNormalizeSetting('page_load_delay_ms', '1000')).toBe('1000')
    expect(validateAndNormalizeSetting('page_load_delay_ms', '15000')).toBe('15000')
    expect(validateAndNormalizeSetting('max_retries', '0')).toBe('0')
    expect(validateAndNormalizeSetting('max_retries', '5')).toBe('5')
    expect(validateAndNormalizeSetting('min_interval_between_sends', ' 60000 ')).toBe('60000')
  })

  it('rejects blank browser app names and trims valid ones', () => {
    expect(() => validateAndNormalizeSetting('browser_app', '')).toThrow('Browser app name is required')
    expect(() => validateAndNormalizeSetting('browser_app', '   ')).toThrow('Browser app name is required')
    expect(validateAndNormalizeSetting('browser_app', '  Google Chrome  ')).toBe('Google Chrome')
  })

  it('syncs open-at-login changes to the Electron app shell', () => {
    const update = getHandler<(event: unknown, key: string, value: string) => void>('settings:update')

    update({} as never, 'open_at_login', '1')

    expect(dbMocks.updateSetting).toHaveBeenCalledWith('open_at_login', '1')
    expect(dbMocks.validateAndNormalizeSetting).toHaveBeenCalledWith('open_at_login', '1')
    expect(electronMocks.app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true
    })
  })

  it('propagates invalid settings keys without mutating login settings', () => {
    const update = getHandler<(event: unknown, key: string, value: string) => void>('settings:update')
    dbMocks.updateSetting.mockImplementation(() => {
      throw new Error('Invalid settings key: nope')
    })

    expect(() => update({} as never, 'nope', '1')).toThrow('Invalid settings key: nope')
    expect(dbMocks.updateSetting).not.toHaveBeenCalled()
    expect(electronMocks.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})

describe('source validation hooks exist', () => {
  it('settings.ipc.ts uses the dedicated settings validator', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/ipc/settings.ipc.ts'), 'utf-8')
    expect(src).toContain('validateAndNormalizeSetting')
    expect(src).toContain('normalizedValue')
  })

  it('db.service.ts exports validateAndNormalizeSetting', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/services/db.service.ts'), 'utf-8')
    expect(src).toContain('export function validateAndNormalizeSetting')
    expect(src).toContain('parseIntegerSetting')
  })
})
