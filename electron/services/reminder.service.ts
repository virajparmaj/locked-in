import { getDueReminders, advanceReminder, snoozeReminder as dbSnooze, getReminderById } from './db.service'
import { createLogger } from '../utils/logger'
import type { Reminder } from '../../shared/types'

const log = createLogger('reminders')

let checkInterval: NodeJS.Timeout | null = null

// Callback for notifying the renderer when a reminder triggers
let onReminderCallback: ((reminder: Reminder) => void) | null = null

export function setOnReminderCallback(cb: (reminder: Reminder) => void): void {
  onReminderCallback = cb
}

/**
 * Initialize the reminder engine: check for due reminders every 15 minutes.
 */
export function initReminders(): void {
  // Check immediately on startup
  checkAndFireReminders()

  // Then check every 15 minutes
  checkInterval = setInterval(() => {
    checkAndFireReminders()
  }, 15 * 60 * 1000)

  log.info('Reminder engine initialized (checking every 15 minutes)')
}

/**
 * Check for due reminders and fire them.
 */
export function checkAndFireReminders(): void {
  try {
    const dueReminders = getDueReminders()

    for (const reminder of dueReminders) {
      log.info(`Reminder triggered: ${reminder.id} for contact ${reminder.contactName}`)

      // Notify renderer
      if (onReminderCallback) {
        onReminderCallback(reminder)
      }

      // Advance to next reminder date
      advanceReminder(reminder.id)
    }

    if (dueReminders.length > 0) {
      log.info(`Fired ${dueReminders.length} reminder(s)`)
    }
  } catch (err) {
    log.error('Error checking reminders', err)
  }
}

/**
 * Snooze a reminder to a specific date.
 */
export function snoozeReminderService(id: string, until: string): void {
  dbSnooze(id, until)
  log.info(`Reminder ${id} snoozed until ${until}`)
}

/**
 * Resync reminders after wake (re-check immediately).
 */
export function resyncReminders(): void {
  log.info('Resyncing reminders after wake...')
  checkAndFireReminders()
}

/**
 * Shutdown the reminder engine.
 */
export function shutdownReminders(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  log.info('Reminder engine shut down')
}
