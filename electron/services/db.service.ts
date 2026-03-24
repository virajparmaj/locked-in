import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { chmodSync } from 'fs'
import { nanoid } from 'nanoid'
import { createLogger } from '../utils/logger'
import { extractLinkedInSlug, normalizeLinkedInProfileUrl } from '@shared/linkedin'
import type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  Schedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  Reminder,
  CreateReminderInput,
  UpdateReminderInput,
  RunLog,
  RunStatus,
  AppSettings
} from '../../shared/types'

const log = createLogger('db')

let db: Database.Database

function getDbPath(): string {
  return join(app.getPath('userData'), 'lockedin.db')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  linkedin_url  TEXT NOT NULL,
  linkedin_slug TEXT NOT NULL DEFAULT '',
  company       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_slug ON contacts(linkedin_slug);

CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  scheduled_at  TEXT,
  time_of_day   TEXT,
  day_of_week   INTEGER,
  day_of_month  INTEGER,
  month_of_year INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  dry_run       INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS run_logs (
  id                  TEXT PRIMARY KEY,
  schedule_id         TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK(status IN ('success', 'failed', 'dry_run', 'skipped')),
  error_message       TEXT,
  fired_at            TEXT NOT NULL,
  completed_at        TEXT,
  execution_duration  INTEGER,
  scheduled_time      TEXT,
  retry_attempt       INTEGER DEFAULT 0,
  retry_of            TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_logs_schedule ON run_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_fired_at ON run_logs(fired_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('global_dry_run', '0'),
  ('send_delay_ms', '5000'),
  ('page_load_delay_ms', '4000'),
  ('browser_app', 'Google Chrome'),
  ('open_at_login', '0'),
  ('max_retries', '2'),
  ('theme', 'system'),
  ('default_message_template', ''),
  ('min_interval_between_sends', '60000');

CREATE TABLE IF NOT EXISTS notification_rules (
  id                TEXT PRIMARY KEY,
  contact_id        TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  frequency         TEXT NOT NULL CHECK(frequency IN ('weekly', 'quarterly', 'yearly')),
  next_reminder_at  TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  message           TEXT NOT NULL DEFAULT ''
);
`

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

const SETTINGS_DEFAULTS = {
  global_dry_run: '0',
  send_delay_ms: '5000',
  page_load_delay_ms: '4000',
  browser_app: 'Google Chrome',
  open_at_login: '0',
  max_retries: '2',
  theme: 'system',
  default_message_template: '',
  min_interval_between_sends: '60000'
} as const

const BOOLEAN_SETTINGS = new Set(['global_dry_run', 'open_at_login'])
const VALID_THEMES = new Set<AppSettings['theme']>(['system', 'light', 'dark'])
const NUMERIC_SETTING_RULES = {
  send_delay_ms: { min: 1000, max: 15000, label: 'Send delay' },
  page_load_delay_ms: { min: 1000, max: 15000, label: 'Page load delay' },
  max_retries: { min: 0, max: 5, label: 'Max retries' },
  min_interval_between_sends: { min: 10000, max: 300000, label: 'Minimum interval between sends' }
} as const

type SettingKey = keyof typeof SETTINGS_DEFAULTS

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

export function validateAndNormalizeSetting(key: string, value: unknown): string {
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
    if (typeof value !== 'string' || !VALID_THEMES.has(value as AppSettings['theme'])) {
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

function getStoredSetting(map: Partial<Record<SettingKey, string>>, key: SettingKey): string {
  const fallback = SETTINGS_DEFAULTS[key]
  const storedValue = map[key]
  const candidate = storedValue ?? fallback

  try {
    return validateAndNormalizeSetting(key, candidate)
  } catch (err) {
    if (storedValue !== undefined) {
      log.warn(`Invalid stored setting "${key}", using default`, err)
    }
    return fallback
  }
}

// --- Row Mappers ---

function rowToContact(row: Record<string, unknown>): Contact {
  const tagsStr = (row.tags as string) || ''
  return {
    id: row.id as string,
    name: row.name as string,
    linkedinUrl: row.linkedin_url as string,
    linkedinSlug: row.linkedin_slug as string,
    company: (row.company as string) || '',
    notes: (row.notes as string) || '',
    tags: tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function rowToSchedule(row: Record<string, unknown>): Schedule {
  return {
    id: row.id as string,
    contactId: row.contact_id as string,
    contactName: (row.contact_name as string) || '',
    message: row.message as string,
    scheduleType: row.schedule_type as Schedule['scheduleType'],
    scheduledAt: row.scheduled_at as string | null,
    timeOfDay: row.time_of_day as string | null,
    dayOfWeek: row.day_of_week as number | null,
    dayOfMonth: row.day_of_month as number | null,
    monthOfYear: row.month_of_year as number | null,
    enabled: row.enabled === 1,
    dryRun: row.dry_run === 1,
    lastFiredAt: (row.last_fired_at as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function rowToRunLog(row: Record<string, unknown>): RunLog {
  return {
    id: row.id as string,
    scheduleId: row.schedule_id as string,
    status: row.status as RunStatus,
    errorMessage: row.error_message as string | null,
    firedAt: row.fired_at as string,
    completedAt: row.completed_at as string | null,
    executionDuration: row.execution_duration as number | undefined,
    scheduledTime: row.scheduled_time as string | undefined,
    retryAttempt: row.retry_attempt as number | undefined,
    retryOf: row.retry_of as string | undefined,
    contactName: row.contact_name as string | undefined,
    linkedinSlug: row.linkedin_slug as string | undefined,
    messagePreview: row.message_preview as string | undefined
  }
}

function rowToReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row.id as string,
    contactId: row.contact_id as string,
    contactName: (row.contact_name as string) || '',
    frequency: row.frequency as Reminder['frequency'],
    nextReminderAt: row.next_reminder_at as string,
    enabled: row.enabled === 1,
    message: (row.message as string) || ''
  }
}

// --- Init ---

export function initDb(): void {
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Integrity check on startup
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[]
  if (integrity[0]?.integrity_check !== 'ok') {
    log.error('Database integrity check failed', integrity)
  } else {
    log.info(`Database opened: ${dbPath}`)
  }

  db.exec(SCHEMA)

  // Set DB file permissions to owner-only
  try { chmodSync(dbPath, 0o600) } catch {}

  // Auto-prune logs older than 90 days on startup
  pruneOldLogs(90)
}

export function pruneOldLogs(olderThanDays: number): void {
  const result = db.prepare(
    `DELETE FROM run_logs WHERE fired_at < datetime('now', '-' || ? || ' days')`
  ).run(olderThanDays)
  if (result.changes > 0) {
    log.info(`Pruned ${result.changes} log entries older than ${olderThanDays} days`)
  }
}

// --- Contacts ---

export function getAllContacts(): Contact[] {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY name ASC').all()
  return (rows as Record<string, unknown>[]).map(rowToContact)
}

export function getContactById(id: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)
  return row ? rowToContact(row as Record<string, unknown>) : null
}

export function createContact(input: CreateContactInput): Contact {
  const id = nanoid()
  const now = new Date().toISOString()
  const normalizedUrl = normalizeLinkedInProfileUrl(input.linkedinUrl)
  if (!normalizedUrl) {
    throw new Error('Invalid LinkedIn profile URL')
  }
  const slug = extractLinkedInSlug(normalizedUrl)
  db.prepare(`
    INSERT INTO contacts (id, name, linkedin_url, linkedin_slug, company, notes, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    normalizedUrl,
    slug,
    input.company || '',
    input.notes || '',
    (input.tags || []).join(','),
    now,
    now
  )
  return getContactById(id)!
}

export function updateContact(id: string, input: UpdateContactInput): Contact {
  const existing = getContactById(id)
  if (!existing) throw new Error(`Contact ${id} not found`)

  const now = new Date().toISOString()
  const url = input.linkedinUrl !== undefined
    ? normalizeLinkedInProfileUrl(input.linkedinUrl)
    : existing.linkedinUrl
  if (!url) {
    throw new Error('Invalid LinkedIn profile URL')
  }
  const slug = extractLinkedInSlug(url)

  db.prepare(`
    UPDATE contacts SET
      name = ?, linkedin_url = ?, linkedin_slug = ?, company = ?, notes = ?, tags = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    url,
    slug,
    input.company ?? existing.company,
    input.notes ?? existing.notes,
    input.tags !== undefined ? input.tags.join(',') : existing.tags.join(','),
    now,
    id
  )
  return getContactById(id)!
}

export function deleteContact(id: string): void {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
}

export function searchContacts(query: string): Contact[] {
  const q = `%${query}%`
  const rows = db.prepare(`
    SELECT * FROM contacts
    WHERE name LIKE ? OR company LIKE ? OR notes LIKE ? OR tags LIKE ? OR linkedin_slug LIKE ?
    ORDER BY name ASC
  `).all(q, q, q, q, q)
  return (rows as Record<string, unknown>[]).map(rowToContact)
}

// --- Schedules ---

export function getAllSchedules(): Schedule[] {
  const rows = db.prepare(`
    SELECT s.*, c.name as contact_name
    FROM schedules s
    LEFT JOIN contacts c ON s.contact_id = c.id
    ORDER BY s.created_at DESC
  `).all()
  return (rows as Record<string, unknown>[]).map(rowToSchedule)
}

export function getScheduleById(id: string): Schedule | null {
  const row = db.prepare(`
    SELECT s.*, c.name as contact_name
    FROM schedules s
    LEFT JOIN contacts c ON s.contact_id = c.id
    WHERE s.id = ?
  `).get(id)
  return row ? rowToSchedule(row as Record<string, unknown>) : null
}

export function getSchedulesByContact(contactId: string): Schedule[] {
  const rows = db.prepare(`
    SELECT s.*, c.name as contact_name
    FROM schedules s
    LEFT JOIN contacts c ON s.contact_id = c.id
    WHERE s.contact_id = ?
    ORDER BY s.created_at DESC
  `).all(contactId)
  return (rows as Record<string, unknown>[]).map(rowToSchedule)
}

export function createSchedule(input: CreateScheduleInput): Schedule {
  const id = nanoid()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO schedules (id, contact_id, message, schedule_type, scheduled_at, time_of_day, day_of_week, day_of_month, month_of_year, dry_run, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.contactId,
    input.message,
    input.scheduleType,
    input.scheduledAt || null,
    input.timeOfDay || null,
    input.dayOfWeek ?? null,
    input.dayOfMonth ?? null,
    input.monthOfYear ?? null,
    input.dryRun ? 1 : 0,
    now,
    now
  )
  return getScheduleById(id)!
}

export function updateSchedule(id: string, input: UpdateScheduleInput): Schedule {
  const existing = getScheduleById(id)
  if (!existing) throw new Error(`Schedule ${id} not found`)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE schedules SET
      contact_id = ?,
      message = ?,
      schedule_type = ?,
      scheduled_at = ?,
      time_of_day = ?,
      day_of_week = ?,
      day_of_month = ?,
      month_of_year = ?,
      enabled = ?,
      dry_run = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.contactId ?? existing.contactId,
    input.message ?? existing.message,
    input.scheduleType ?? existing.scheduleType,
    input.scheduledAt !== undefined ? input.scheduledAt || null : existing.scheduledAt,
    input.timeOfDay !== undefined ? input.timeOfDay || null : existing.timeOfDay,
    input.dayOfWeek !== undefined ? (input.dayOfWeek ?? null) : existing.dayOfWeek,
    input.dayOfMonth !== undefined ? (input.dayOfMonth ?? null) : existing.dayOfMonth,
    input.monthOfYear !== undefined ? (input.monthOfYear ?? null) : existing.monthOfYear,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    input.dryRun !== undefined ? (input.dryRun ? 1 : 0) : (existing.dryRun ? 1 : 0),
    now,
    id
  )
  return getScheduleById(id)!
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

export function toggleSchedule(id: string, enabled: boolean): Schedule {
  return updateSchedule(id, { enabled })
}

export function findConflicts(
  contactId: string,
  scheduleType: string,
  scheduledAt: string | null,
  timeOfDay: string | null,
  dayOfWeek: number | null,
  excludeId?: string
): Schedule[] {
  const rows = db.prepare(`
    SELECT s.*, c.name as contact_name
    FROM schedules s
    LEFT JOIN contacts c ON s.contact_id = c.id
    WHERE s.contact_id = ? AND s.enabled = 1
  `).all(contactId) as Record<string, unknown>[]

  const candidates = rows.map(rowToSchedule).filter((s) => s.id !== excludeId)

  return candidates.filter((existing) => {
    if (scheduleType === 'one_time' && existing.scheduleType === 'one_time') {
      if (!scheduledAt || !existing.scheduledAt) return false
      return new Date(scheduledAt).getTime() === new Date(existing.scheduledAt).getTime()
    }

    if (timeOfDay && existing.timeOfDay && timeOfDay === existing.timeOfDay) {
      if (scheduleType === 'weekly' && existing.scheduleType === 'weekly') {
        return dayOfWeek === existing.dayOfWeek
      }
    }

    return false
  })
}

export function updateLastFiredAt(scheduleId: string): void {
  db.prepare('UPDATE schedules SET last_fired_at = ? WHERE id = ?').run(new Date().toISOString(), scheduleId)
}

// --- Run Logs ---

export function insertRunLog(
  scheduleId: string,
  status: RunStatus,
  errorMessage?: string,
  executionDurationMs?: number,
  scheduledTime?: string,
  retryAttempt?: number,
  retryOf?: string
): RunLog {
  const id = nanoid()
  const firedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO run_logs (id, schedule_id, status, error_message, fired_at, completed_at, execution_duration, scheduled_time, retry_attempt, retry_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scheduleId, status, errorMessage || null, firedAt, completedAt, executionDurationMs ?? null, scheduledTime || null, retryAttempt ?? 0, retryOf || null)

  return {
    id,
    scheduleId,
    status,
    errorMessage: errorMessage || null,
    firedAt,
    completedAt,
    executionDuration: executionDurationMs,
    scheduledTime: scheduledTime || undefined,
    retryAttempt: retryAttempt ?? 0,
    retryOf: retryOf || undefined
  }
}

export function getLogs(limit = 100): RunLog[] {
  const rows = db
    .prepare(
      `SELECT l.*, c.name as contact_name, c.linkedin_slug, substr(s.message, 1, 80) as message_preview
       FROM run_logs l
       LEFT JOIN schedules s ON l.schedule_id = s.id
       LEFT JOIN contacts c ON s.contact_id = c.id
       ORDER BY l.fired_at DESC
       LIMIT ?`
    )
    .all(limit)
  return (rows as Record<string, unknown>[]).map(rowToRunLog)
}

export function getLogsBySchedule(scheduleId: string): RunLog[] {
  const rows = db
    .prepare(
      `SELECT l.*, c.name as contact_name, c.linkedin_slug, substr(s.message, 1, 80) as message_preview
       FROM run_logs l
       LEFT JOIN schedules s ON l.schedule_id = s.id
       LEFT JOIN contacts c ON s.contact_id = c.id
       WHERE l.schedule_id = ?
       ORDER BY l.fired_at DESC
       LIMIT 50`
    )
    .all(scheduleId)
  return (rows as Record<string, unknown>[]).map(rowToRunLog)
}

export function clearLogs(olderThanDays?: number): void {
  if (olderThanDays) {
    db.prepare(
      `DELETE FROM run_logs WHERE fired_at < datetime('now', '-' || ? || ' days')`
    ).run(olderThanDays)
  } else {
    db.prepare('DELETE FROM run_logs').run()
  }
}

// --- Reminders (notification_rules) ---

export function getAllReminders(): Reminder[] {
  const rows = db.prepare(`
    SELECT nr.*, c.name as contact_name
    FROM notification_rules nr
    LEFT JOIN contacts c ON nr.contact_id = c.id
    ORDER BY nr.next_reminder_at ASC
  `).all()
  return (rows as Record<string, unknown>[]).map(rowToReminder)
}

export function getReminderById(id: string): Reminder | null {
  const row = db.prepare(`
    SELECT nr.*, c.name as contact_name
    FROM notification_rules nr
    LEFT JOIN contacts c ON nr.contact_id = c.id
    WHERE nr.id = ?
  `).get(id)
  return row ? rowToReminder(row as Record<string, unknown>) : null
}

export function createReminder(input: CreateReminderInput): Reminder {
  const id = nanoid()
  const nextReminderAt = computeNextReminderDate(input.frequency, new Date()).toISOString()
  db.prepare(`
    INSERT INTO notification_rules (id, contact_id, frequency, next_reminder_at, enabled, message)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, input.contactId, input.frequency, nextReminderAt, input.message || '')
  return getReminderById(id)!
}

export function updateReminder(id: string, input: UpdateReminderInput): Reminder {
  const existing = getReminderById(id)
  if (!existing) throw new Error(`Reminder ${id} not found`)

  const frequency = input.frequency ?? existing.frequency
  // If frequency changed, recompute next reminder date
  const nextReminderAt = input.frequency && input.frequency !== existing.frequency
    ? computeNextReminderDate(input.frequency, new Date()).toISOString()
    : existing.nextReminderAt

  db.prepare(`
    UPDATE notification_rules SET
      contact_id = ?, frequency = ?, next_reminder_at = ?, enabled = ?, message = ?
    WHERE id = ?
  `).run(
    input.contactId ?? existing.contactId,
    frequency,
    nextReminderAt,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    input.message ?? existing.message,
    id
  )
  return getReminderById(id)!
}

export function deleteReminder(id: string): void {
  db.prepare('DELETE FROM notification_rules WHERE id = ?').run(id)
}

export function snoozeReminder(id: string, until: string): void {
  db.prepare('UPDATE notification_rules SET next_reminder_at = ? WHERE id = ?').run(until, id)
}

export function advanceReminder(id: string): void {
  const reminder = getReminderById(id)
  if (!reminder) return
  const next = computeNextReminderDate(reminder.frequency, new Date()).toISOString()
  db.prepare('UPDATE notification_rules SET next_reminder_at = ? WHERE id = ?').run(next, id)
}

export function getDueReminders(): Reminder[] {
  const now = new Date().toISOString()
  const rows = db.prepare(`
    SELECT nr.*, c.name as contact_name
    FROM notification_rules nr
    LEFT JOIN contacts c ON nr.contact_id = c.id
    WHERE nr.enabled = 1 AND nr.next_reminder_at <= ?
  `).all(now)
  return (rows as Record<string, unknown>[]).map(rowToReminder)
}

// --- Settings ---

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map: Partial<Record<SettingKey, string>> = {}
  for (const row of rows) {
    if (row.key in SETTINGS_DEFAULTS) {
      map[row.key as SettingKey] = row.value
    }
  }

  const globalDryRun = getStoredSetting(map, 'global_dry_run')
  const sendDelayMs = getStoredSetting(map, 'send_delay_ms')
  const pageLoadDelayMs = getStoredSetting(map, 'page_load_delay_ms')
  const browserApp = getStoredSetting(map, 'browser_app')
  const openAtLogin = getStoredSetting(map, 'open_at_login')
  const maxRetries = getStoredSetting(map, 'max_retries')
  const theme = getStoredSetting(map, 'theme')
  const defaultMessageTemplate = getStoredSetting(map, 'default_message_template')
  const minIntervalBetweenSends = getStoredSetting(map, 'min_interval_between_sends')

  return {
    globalDryRun: globalDryRun === '1',
    sendDelayMs: Number(sendDelayMs),
    pageLoadDelayMs: Number(pageLoadDelayMs),
    browserApp,
    openAtLogin: openAtLogin === '1',
    maxRetries: Number(maxRetries),
    theme: theme as AppSettings['theme'],
    defaultMessageTemplate,
    minIntervalBetweenSends: Number(minIntervalBetweenSends)
  }
}

export function updateSetting(key: string, value: string): void {
  const normalizedValue = validateAndNormalizeSetting(key, value)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, normalizedValue)
}

export function closeDb(): void {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    db.close()
    log.info('Database closed')
  }
}

// --- Helpers ---

/** Compute the next reminder date based on frequency from a given date. */
export function computeNextReminderDate(frequency: string, from: Date): Date {
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
