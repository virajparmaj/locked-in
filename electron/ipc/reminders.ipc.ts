import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { snoozeReminderService } from '../services/reminder.service'
import { openLinkedInInChrome } from '../services/linkedin.service'
import { LINKEDIN_SELECTORS } from '../services/linkedin.service'
import { runAppleScript } from '../utils/applescript'
import { createLogger } from '../utils/logger'
import type { CreateReminderInput, UpdateReminderInput, ReminderFrequency } from '../../shared/types'

const log = createLogger('ipc:reminders')

const VALID_FREQUENCIES = new Set<ReminderFrequency>(['weekly', 'quarterly', 'yearly'])

function validateCreateInput(data: CreateReminderInput): string | null {
  if (!data.contactId || typeof data.contactId !== 'string') {
    return 'Contact is required'
  }
  if (!VALID_FREQUENCIES.has(data.frequency)) {
    return `Invalid frequency: ${data.frequency}`
  }
  return null
}

export function registerRemindersHandlers(): void {
  ipcMain.handle('reminders:getAll', () => {
    try {
      return db.getAllReminders()
    } catch (err) {
      log.error('getAll failed', err)
      throw err
    }
  })

  ipcMain.handle('reminders:create', (_, data: CreateReminderInput) => {
    const validationError = validateCreateInput(data)
    if (validationError) {
      throw new Error(validationError)
    }
    // Verify contact exists
    const contact = db.getContactById(data.contactId)
    if (!contact) {
      throw new Error('Contact not found')
    }
    try {
      const reminder = db.createReminder(data)
      log.info(`Created reminder ${reminder.id} for ${contact.name}`)
      return reminder
    } catch (err) {
      log.error('create failed', err)
      throw err
    }
  })

  ipcMain.handle('reminders:update', (_, id: string, data: UpdateReminderInput) => {
    try {
      const reminder = db.updateReminder(id, data)
      return reminder
    } catch (err) {
      log.error('update failed', err)
      throw err
    }
  })

  ipcMain.handle('reminders:delete', (_, id: string) => {
    try {
      db.deleteReminder(id)
      log.info(`Deleted reminder ${id}`)
    } catch (err) {
      log.error('delete failed', err)
      throw err
    }
  })

  ipcMain.handle('reminders:snooze', (_, id: string, until: string) => {
    try {
      snoozeReminderService(id, until)
    } catch (err) {
      log.error('snooze failed', err)
      throw err
    }
  })

  ipcMain.handle('reminders:openCompose', async (_, contactId: string) => {
    try {
      const contact = db.getContactById(contactId)
      if (!contact) throw new Error('Contact not found')
      if (!contact.linkedinSlug) throw new Error('Contact has no LinkedIn slug')

      const settings = db.getSettings()
      const browserApp = settings.browserApp.replace(/['"\\;\n\r]/g, '')
      const profileUrl = `${LINKEDIN_SELECTORS.PROFILE_URL_PREFIX}${encodeURIComponent(contact.linkedinSlug)}/`

      const script = `
        tell application "${browserApp}"
          activate
          if (count of windows) = 0 then make new window
          set URL of active tab of first window to "${profileUrl}"
        end tell
      `
      await runAppleScript(script)
    } catch (err) {
      log.error('openCompose failed', err)
      throw err
    }
  })
}
