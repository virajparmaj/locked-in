import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { snoozeReminderService } from '../services/reminder.service'
import { openLinkedInCompose } from '../services/linkedin.service'
import { normalizeLinkedInProfileUrl } from '@shared/linkedin'
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
      const profileUrl = normalizeLinkedInProfileUrl(contact.linkedinUrl)
      if (!profileUrl) throw new Error('Contact has no valid LinkedIn profile URL')

      await openLinkedInCompose(profileUrl)
    } catch (err) {
      log.error('openCompose failed', err)
      throw err
    }
  })
}
