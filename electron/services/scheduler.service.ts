import * as schedule from 'node-schedule'
import { getAllSchedules, getScheduleById, getContactById, getLogsBySchedule, getSettings, insertRunLog, toggleSchedule, updateLastFiredAt } from './db.service'
import { sendLinkedInMessage } from './linkedin.service'
import { runAppleScript } from '../utils/applescript'
import { createLogger } from '../utils/logger'
import { normalizeLinkedInProfileUrl } from '@shared/linkedin'
import type { Schedule, RunLog, RunStatus } from '../../shared/types'

const log = createLogger('scheduler')

// In-memory map of active node-schedule jobs
const jobs = new Map<string, schedule.Job>()

// Mutex: set of schedule IDs currently executing (prevents double-send)
const executing = new Set<string>()

// Pending retry timeouts per schedule ID
const pendingRetries = new Map<string, NodeJS.Timeout>()

// Callback for notifying the renderer when a job executes
let onExecutedCallback: ((log: RunLog) => void) | null = null

// Retry backoff intervals in ms — more conservative for LinkedIn
const RETRY_BACKOFF_MS = [15_000, 45_000, 120_000]

type ExecutionContext = 'scheduled' | 'catch_up' | 'retry' | 'manual_test'

interface ExecutionRequest {
  context: ExecutionContext
  scheduledTime?: string
  retryAttempt?: number
  retryOf?: string
}

interface ExecutionOutcome {
  status: RunStatus
  errorMessage?: string
  executionDurationMs?: number
  retryable?: boolean
}

type PastDueOneTimeAction = 'missed' | 'recover' | 'consume'

// Errors that should not be retried (non-transient)
const NON_RETRYABLE_PATTERNS = [
  'not allowed assistive access',
  'Accessibility permission',
  'Allow JavaScript from Apple Events',
  'Screen locked',
  'Screen saver is running',
  'not logged in',
  'Chrome not found',
  'Rate limited'
]

export function setOnExecutedCallback(cb: (log: RunLog) => void): void {
  onExecutedCallback = cb
}

/**
 * Initialize scheduler: load all enabled schedules from DB, register jobs,
 * detect missed one-time schedules, and catch up missed recurring runs.
 */
export function initScheduler(): void {
  const schedules = getAllSchedules()
  const missedRecurring: Array<{ schedule: Schedule, expected: Date }> = []
  const now = new Date()
  const maxRetries = getSettings().maxRetries

  for (const s of schedules) {
    if (!s.enabled) continue

    // Detect past-due one-time schedules and either mark them missed, recover them,
    // or consume stale enabled state left behind by older scheduler bugs.
    if (s.scheduleType === 'one_time' && s.scheduledAt) {
      const fireDate = new Date(s.scheduledAt)
      if (fireDate <= now) {
        const action = getPastDueOneTimeAction(s, getLogsBySchedule(s.id), maxRetries)

        if (action === 'recover') {
          log.info(`Recovering past-due one-time schedule ${s.id}`)
          executeJob(s.id, { context: 'catch_up', scheduledTime: s.scheduledAt }).catch((err) => {
            log.error(`Failed one-time recovery execution for ${s.id}`, err)
          })
          continue
        }

        if (action === 'missed') {
          insertRunLog(s.id, 'skipped', 'Missed: app was not running at scheduled time', undefined, s.scheduledAt)
          log.info(`Missed one-time schedule ${s.id} — marked as skipped`)
        } else {
          log.info(`Past-due one-time schedule ${s.id} already reached a terminal outcome — disabling stale enabled state`)
        }

        toggleSchedule(s.id, false)
        continue
      }
    }

    if (s.scheduleType !== 'one_time') {
      const expected = getMostRecentExpectedFire(s, now)
      if (expected && shouldCatchUpRecurringSchedule(s, expected)) {
        missedRecurring.push({ schedule: s, expected })
      }
    }

    registerJob(s)
  }

  detectAndCatchUpMissedRuns(missedRecurring)

  log.info(`Scheduler initialized: ${jobs.size} active jobs`)
}

/**
 * For each recurring schedule, check if the most recent expected fire time
 * is after last_fired_at. If so, fire once immediately to catch up.
 */
function detectAndCatchUpMissedRuns(schedules: Array<{ schedule: Schedule, expected: Date }>): void {
  for (const { schedule: s, expected } of schedules) {
    const lastFired = s.lastFiredAt ? new Date(s.lastFiredAt) : null
    const missedCount = lastFired ? 'at least 1' : 'unknown'
    insertRunLog(s.id, 'skipped', `Missed ${missedCount} run(s): app was not running`, undefined, expected.toISOString())
    log.info(`Catching up missed recurring schedule ${s.id} — firing now`)

    executeJob(s.id, { context: 'catch_up', scheduledTime: expected.toISOString() }).catch((err) => {
      log.error(`Failed catch-up execution for ${s.id}`, err)
    })
  }
}

/**
 * Compute the most recent time a recurring schedule should have fired
 * before `now`. Returns null if no expected fire time can be determined.
 */
export function getMostRecentExpectedFire(s: Schedule, now: Date): Date | null {
  if (!s.timeOfDay) return null
  const [hours, minutes] = s.timeOfDay.split(':').map(Number)

  if (s.scheduleType === 'weekly') {
    if (s.dayOfWeek === null || s.dayOfWeek === undefined) return null
    const candidate = new Date(now)
    candidate.setHours(hours, minutes, 0, 0)
    const currentDay = candidate.getDay()
    let daysBack = (currentDay - s.dayOfWeek + 7) % 7
    if (daysBack === 0 && candidate > now) daysBack = 7
    candidate.setDate(candidate.getDate() - daysBack)
    return candidate
  }

  if (s.scheduleType === 'quarterly' || s.scheduleType === 'half_yearly' || s.scheduleType === 'yearly') {
    if (s.dayOfMonth === null || s.dayOfMonth === undefined) return null

    let targetMonths: number[]
    if (s.scheduleType === 'yearly') {
      if (s.monthOfYear === null || s.monthOfYear === undefined) return null
      targetMonths = [s.monthOfYear]
    } else if (s.scheduleType === 'half_yearly') {
      const start = s.monthOfYear ?? 0
      targetMonths = [start, (start + 6) % 12]
    } else {
      const start = s.monthOfYear ?? 0
      targetMonths = [0, 1, 2, 3].map(i => (start + i * 3) % 12)
    }

    targetMonths.sort((a, b) => a - b)

    let best: Date | null = null
    const currentYear = now.getFullYear()

    for (const year of [currentYear, currentYear - 1]) {
      for (const month of targetMonths) {
        const candidate = new Date(year, month, s.dayOfMonth, hours, minutes, 0, 0)
        if (candidate <= now && (!best || candidate > best)) {
          best = candidate
        }
      }
    }
    return best
  }

  return null
}

function shouldCatchUpRecurringSchedule(s: Schedule, expected: Date): boolean {
  const createdAt = new Date(s.createdAt)
  if (expected < createdAt) {
    return false
  }

  const lastFired = s.lastFiredAt ? new Date(s.lastFiredAt) : null
  return !lastFired || lastFired < expected
}

function getPastDueOneTimeAction(s: Schedule, logs: RunLog[], maxRetries: number): PastDueOneTimeAction {
  if (!s.scheduledAt) {
    return 'missed'
  }

  const slotLogs = logs
    .filter((entry) => entry.scheduledTime === s.scheduledAt)
    .sort((a, b) => new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime())

  if (slotLogs.length === 0) {
    return 'missed'
  }

  return isTerminalLoggedOutcome(slotLogs[0], maxRetries) ? 'consume' : 'recover'
}

function isTerminalLoggedOutcome(logEntry: RunLog, maxRetries: number): boolean {
  if (logEntry.status === 'success' || logEntry.status === 'dry_run') {
    return true
  }

  if (logEntry.status !== 'failed') {
    return false
  }

  if (!logEntry.errorMessage || isNonRetryableError(logEntry.errorMessage)) {
    return true
  }

  return (logEntry.retryAttempt ?? 0) >= maxRetries
}

/**
 * Re-sync all jobs after sleep/wake.
 */
export function resyncAfterWake(): void {
  log.info('Resyncing scheduler after wake...')
  for (const [, job] of jobs) {
    job.cancel()
  }
  jobs.clear()
  initScheduler()
}

/**
 * Register a node-schedule job for a given schedule.
 */
export function registerJob(s: Schedule): void {
  cancelJob(s.id)

  let rule: Date | string | schedule.RecurrenceRule

  if (s.scheduleType === 'one_time') {
    if (!s.scheduledAt) return
    const fireDate = new Date(s.scheduledAt)
    if (fireDate <= new Date()) return
    rule = fireDate
  } else if (s.scheduleType === 'weekly') {
    if (!s.timeOfDay || s.dayOfWeek === null || s.dayOfWeek === undefined) return
    const [hours, mins] = s.timeOfDay.split(':').map(Number)
    const r = new schedule.RecurrenceRule()
    r.dayOfWeek = s.dayOfWeek
    r.hour = hours
    r.minute = mins
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'quarterly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined) return
    const [hours, mins] = s.timeOfDay.split(':').map(Number)
    const startMonth = s.monthOfYear ?? 0
    const r = new schedule.RecurrenceRule()
    r.month = [0, 1, 2, 3].map(i => (startMonth + i * 3) % 12)
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = mins
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'half_yearly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined) return
    const [hours, mins] = s.timeOfDay.split(':').map(Number)
    const startMonth = s.monthOfYear ?? 0
    const r = new schedule.RecurrenceRule()
    r.month = [startMonth, (startMonth + 6) % 12]
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = mins
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'yearly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined || s.monthOfYear === null || s.monthOfYear === undefined) return
    const [hours, mins] = s.timeOfDay.split(':').map(Number)
    const r = new schedule.RecurrenceRule()
    r.month = s.monthOfYear
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = mins
    r.second = 0
    rule = r
  } else {
    return
  }

  const job = schedule.scheduleJob(rule, async (fireDate: Date) => {
    const scheduledTime = fireDate instanceof Date ? fireDate.toISOString() : new Date().toISOString()
    await executeJob(s.id, { context: 'scheduled', scheduledTime })
  })

  if (job) {
    jobs.set(s.id, job)
  }
}

export function cancelJob(scheduleId: string): void {
  const existing = jobs.get(scheduleId)
  if (existing) {
    existing.cancel()
    jobs.delete(scheduleId)
  }
  clearPendingRetry(scheduleId)
}

function clearPendingRetry(scheduleId: string): void {
  const timeout = pendingRetries.get(scheduleId)
  if (timeout) {
    clearTimeout(timeout)
    pendingRetries.delete(scheduleId)
  }
}

export function rescheduleJob(scheduleId: string): void {
  const s = getScheduleById(scheduleId)
  if (!s) {
    cancelJob(scheduleId)
    return
  }
  if (s.enabled) {
    registerJob(s)
  } else {
    cancelJob(scheduleId)
  }
}

function isNonRetryableError(errorMsg: string): boolean {
  return NON_RETRYABLE_PATTERNS.some(pattern => errorMsg.includes(pattern))
}

function scheduleRetry(
  scheduleId: string,
  request: ExecutionRequest,
  originalLogId: string,
  scheduledTime: string
): void {
  const settings = getSettings()
  const maxRetries = settings.maxRetries
  const retryAttempt = (request.retryAttempt ?? 0) + 1
  const delayMs = RETRY_BACKOFF_MS[retryAttempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
  log.info(`Schedule ${scheduleId}: retry ${retryAttempt}/${maxRetries} in ${delayMs}ms`)

  clearPendingRetry(scheduleId)

  const timeout = setTimeout(async () => {
    pendingRetries.delete(scheduleId)
    await executeJob(scheduleId, {
      context: 'retry',
      retryAttempt,
      retryOf: originalLogId,
      scheduledTime
    })
  }, delayMs)

  pendingRetries.set(scheduleId, timeout)
}

function isRealExecutionContext(context: ExecutionContext): boolean {
  return context !== 'manual_test'
}

function getRetryAttempt(request: ExecutionRequest): number {
  return request.retryAttempt ?? 0
}

function getScheduledTime(request: ExecutionRequest): string | undefined {
  if (request.context === 'manual_test') {
    return undefined
  }

  return request.scheduledTime ?? new Date().toISOString()
}

function shouldScheduleRetry(request: ExecutionRequest, outcome: ExecutionOutcome, maxRetries: number): boolean {
  return isRealExecutionContext(request.context)
    && outcome.status === 'failed'
    && Boolean(outcome.retryable)
    && getRetryAttempt(request) < maxRetries
}

function isTerminalOutcome(request: ExecutionRequest, outcome: ExecutionOutcome, maxRetries: number): boolean {
  if (!isRealExecutionContext(request.context)) {
    return false
  }

  if (outcome.status === 'success' || outcome.status === 'dry_run') {
    return true
  }

  if (outcome.status !== 'failed') {
    return false
  }

  return !shouldScheduleRetry(request, outcome, maxRetries)
}

function shouldConsumeOneTimeSchedule(scheduleRecord: Schedule, request: ExecutionRequest, outcome: ExecutionOutcome, maxRetries: number): boolean {
  return scheduleRecord.scheduleType === 'one_time' && isTerminalOutcome(request, outcome, maxRetries)
}

/**
 * Execute a scheduled job: send the LinkedIn message and log the result.
 */
async function executeJob(
  scheduleId: string,
  request: ExecutionRequest
): Promise<RunLog | null> {
  if (executing.has(scheduleId)) {
    log.warn(`Schedule ${scheduleId} is already executing, skipping duplicate`)
    return null
  }

  executing.add(scheduleId)
  try {
    const s = getScheduleById(scheduleId)
    if (!s) return null

    const scheduledTime = getScheduledTime(request)
    const retryAttempt = getRetryAttempt(request)
    const maxRetries = getSettings().maxRetries

    if (request.context !== 'manual_test' && !s.enabled) {
      const entry = insertRunLog(scheduleId, 'skipped', 'Schedule is disabled', undefined, scheduledTime)
      if (onExecutedCallback) onExecutedCallback(entry)
      return entry
    }

    // Look up contact to get the canonical LinkedIn profile URL.
    const contact = getContactById(s.contactId)
    if (!contact) {
      return persistOutcome(s, request, maxRetries, {
        status: 'failed',
        errorMessage: 'Contact not found'
      })
    }

    const profileUrl = normalizeLinkedInProfileUrl(contact.linkedinUrl)
    if (!profileUrl) {
      return persistOutcome(s, request, maxRetries, {
        status: 'failed',
        errorMessage: 'Contact has no valid LinkedIn profile URL'
      })
    }

    // Check if screen is locked
    let screenLocked = false
    try {
      const result = await runAppleScript('tell application "System Events" to return running of screen saver preferences', 5000)
      screenLocked = result.trim() === 'true'
    } catch {
      // If we can't check, proceed anyway
    }

    if (screenLocked) {
      return persistOutcome(s, request, maxRetries, {
        status: 'skipped',
        errorMessage: 'Screen locked: cannot send via AppleScript'
      })
    }

    log.info(`Executing ${scheduleId} (${s.scheduleType}) → ${profileUrl}${s.dryRun ? ' [dry-run]' : ''}${retryAttempt > 0 ? ` [retry ${retryAttempt}]` : ''}`)

    const startTime = Date.now()
    const result = await sendLinkedInMessage(profileUrl, s.message, s.dryRun)
    const durationMs = Date.now() - startTime

    let status: 'success' | 'failed' | 'dry_run'
    if (result.dryRun) {
      status = 'dry_run'
    } else if (result.success) {
      status = 'success'
    } else {
      status = 'failed'
    }

    log.info(`Execution ${scheduleId} → ${status} (${durationMs}ms)${result.error ? ` error: ${result.error}` : ''}`)

    return persistOutcome(s, request, maxRetries, {
      status,
      errorMessage: result.error,
      executionDurationMs: durationMs,
      retryable: status === 'failed' && typeof result.error === 'string' && !isNonRetryableError(result.error)
    })
  } finally {
    executing.delete(scheduleId)
  }
}

export async function testSendSchedule(scheduleId: string): Promise<RunLog | null> {
  return executeJob(scheduleId, { context: 'manual_test' })
}

function persistOutcome(
  scheduleRecord: Schedule,
  request: ExecutionRequest,
  maxRetries: number,
  outcome: ExecutionOutcome
): RunLog {
  const entry = insertRunLog(
    scheduleRecord.id,
    outcome.status,
    outcome.errorMessage,
    outcome.executionDurationMs,
    getScheduledTime(request),
    getRetryAttempt(request),
    request.retryOf
  )

  if (onExecutedCallback) {
    onExecutedCallback(entry)
  }

  const scheduledTime = entry.scheduledTime
  if (shouldScheduleRetry(request, outcome, maxRetries) && scheduledTime) {
    scheduleRetry(scheduleRecord.id, request, request.retryOf || entry.id, scheduledTime)
    return entry
  }

  if (isTerminalOutcome(request, outcome, maxRetries)) {
    updateLastFiredAt(scheduleRecord.id)
  }

  if (shouldConsumeOneTimeSchedule(scheduleRecord, request, outcome, maxRetries)) {
    toggleSchedule(scheduleRecord.id, false)
    cancelJob(scheduleRecord.id)
  }

  return entry
}

export function getNextFireTime(scheduleId: string): Date | null {
  const job = jobs.get(scheduleId)
  if (!job) return null
  return job.nextInvocation()
}

export function getAllNextFireTimes(): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const [id, job] of jobs) {
    const next = job.nextInvocation()
    result[id] = next ? next.toISOString() : null
  }
  return result
}

export function shutdownScheduler(): void {
  for (const [, job] of jobs) {
    job.cancel()
  }
  jobs.clear()

  for (const [, timeout] of pendingRetries) {
    clearTimeout(timeout)
  }
  pendingRetries.clear()
}
