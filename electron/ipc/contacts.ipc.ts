import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { createLogger } from '../utils/logger'
import { isLinkedInProfileUrl } from '@shared/linkedin'
import type { CreateContactInput, UpdateContactInput } from '../../shared/types'

const log = createLogger('ipc:contacts')

function validateCreateInput(data: CreateContactInput): string | null {
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    return 'Name is required'
  }
  if (!data.linkedinUrl || typeof data.linkedinUrl !== 'string') {
    return 'LinkedIn URL is required'
  }
  if (!isLinkedInProfileUrl(data.linkedinUrl)) {
    return 'Invalid LinkedIn profile URL (expected format: linkedin.com/in/username)'
  }
  return null
}

function validateUpdateInput(data: UpdateContactInput): string | null {
  if (data.name !== undefined && (!data.name || data.name.trim().length === 0)) {
    return 'Name is required'
  }
  if (data.linkedinUrl !== undefined && !isLinkedInProfileUrl(data.linkedinUrl)) {
    return 'Invalid LinkedIn profile URL (expected format: linkedin.com/in/username)'
  }
  return null
}

export function registerContactsHandlers(): void {
  ipcMain.handle('contacts:getAll', () => {
    try {
      return db.getAllContacts()
    } catch (err) {
      log.error('getAll failed', err)
      throw err
    }
  })

  ipcMain.handle('contacts:get', (_, id: string) => {
    try {
      return db.getContactById(id)
    } catch (err) {
      log.error('get failed', err)
      throw err
    }
  })

  ipcMain.handle('contacts:create', (_, data: CreateContactInput) => {
    const validationError = validateCreateInput(data)
    if (validationError) {
      throw new Error(validationError)
    }
    try {
      const contact = db.createContact(data)
      log.info(`Created contact ${contact.id} (${contact.name})`)
      return contact
    } catch (err) {
      log.error('create failed', err)
      throw err
    }
  })

  ipcMain.handle('contacts:update', (_, id: string, data: UpdateContactInput) => {
    const validationError = validateUpdateInput(data)
    if (validationError) {
      throw new Error(validationError)
    }
    try {
      const contact = db.updateContact(id, data)
      return contact
    } catch (err) {
      log.error('update failed', err)
      throw err
    }
  })

  ipcMain.handle('contacts:delete', (_, id: string) => {
    try {
      db.deleteContact(id)
      log.info(`Deleted contact ${id}`)
    } catch (err) {
      log.error('delete failed', err)
      throw err
    }
  })

  ipcMain.handle('contacts:search', (_, query: string) => {
    try {
      return db.searchContacts(query)
    } catch (err) {
      log.error('search failed', err)
      throw err
    }
  })
}
