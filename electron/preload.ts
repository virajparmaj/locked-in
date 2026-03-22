import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  // Contacts
  getContacts: () => ipcRenderer.invoke('contacts:getAll'),
  getContact: (id) => ipcRenderer.invoke('contacts:get', id),
  createContact: (data) => ipcRenderer.invoke('contacts:create', data),
  updateContact: (id, data) => ipcRenderer.invoke('contacts:update', id, data),
  deleteContact: (id) => ipcRenderer.invoke('contacts:delete', id),
  searchContacts: (query) => ipcRenderer.invoke('contacts:search', query),

  // Schedules
  getSchedules: () => ipcRenderer.invoke('schedule:getAll'),
  getSchedule: (id) => ipcRenderer.invoke('schedule:get', id),
  getSchedulesByContact: (contactId) => ipcRenderer.invoke('schedule:byContact', contactId),
  createSchedule: (data) => ipcRenderer.invoke('schedule:create', data),
  updateSchedule: (id, data) => ipcRenderer.invoke('schedule:update', id, data),
  deleteSchedule: (id) => ipcRenderer.invoke('schedule:delete', id),
  toggleSchedule: (id, enabled) => ipcRenderer.invoke('schedule:toggle', id, enabled),
  testSend: (id) => ipcRenderer.invoke('schedule:testSend', id),
  getNextFireTimes: () => ipcRenderer.invoke('schedule:getNextFireTimes'),
  checkConflicts: (data) => ipcRenderer.invoke('schedule:checkConflicts', data),

  // Reminders
  getReminders: () => ipcRenderer.invoke('reminders:getAll'),
  createReminder: (data) => ipcRenderer.invoke('reminders:create', data),
  updateReminder: (id, data) => ipcRenderer.invoke('reminders:update', id, data),
  deleteReminder: (id) => ipcRenderer.invoke('reminders:delete', id),
  snoozeReminder: (id, until) => ipcRenderer.invoke('reminders:snooze', id, until),
  openMessageCompose: (contactId) => ipcRenderer.invoke('reminders:openCompose', contactId),

  // Logs
  getLogs: (limit) => ipcRenderer.invoke('logs:getAll', limit),
  getLogsBySchedule: (scheduleId) => ipcRenderer.invoke('logs:bySchedule', scheduleId),
  clearLogs: (olderThanDays) => ipcRenderer.invoke('logs:clear', olderThanDays),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  updateSetting: (key, value) => ipcRenderer.invoke('settings:update', key, value),

  // System
  checkChromeAccess: () => ipcRenderer.invoke('system:checkChromeAccess'),
  openLinkedInInChrome: () => ipcRenderer.invoke('system:openLinkedIn'),

  // Events
  onScheduleExecuted: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, log: unknown) => {
      callback(log as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('schedule:executed', handler)
    return () => {
      ipcRenderer.removeListener('schedule:executed', handler)
    }
  },

  onReminderTriggered: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, reminder: unknown) => {
      callback(reminder as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('reminder:triggered', handler)
    return () => {
      ipcRenderer.removeListener('reminder:triggered', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
