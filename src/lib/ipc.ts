const IPC_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`IPC call "${label}" timed out after ${IPC_TIMEOUT_MS / 1000}s — main process may be unresponsive`)),
      IPC_TIMEOUT_MS
    )
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

type ElectronAPI = typeof window.api

export function createIpcApi(rawApi: ElectronAPI): ElectronAPI {
  return {
    // Contacts
    getContacts: () => withTimeout(rawApi.getContacts(), 'getContacts'),
    getContact: (id) => withTimeout(rawApi.getContact(id), 'getContact'),
    createContact: (data) => withTimeout(rawApi.createContact(data), 'createContact'),
    updateContact: (id, data) => withTimeout(rawApi.updateContact(id, data), 'updateContact'),
    deleteContact: (id) => withTimeout(rawApi.deleteContact(id), 'deleteContact'),
    searchContacts: (query) => withTimeout(rawApi.searchContacts(query), 'searchContacts'),

    // Schedules
    getSchedules: () => withTimeout(rawApi.getSchedules(), 'getSchedules'),
    getSchedule: (id) => withTimeout(rawApi.getSchedule(id), 'getSchedule'),
    getSchedulesByContact: (contactId) => withTimeout(rawApi.getSchedulesByContact(contactId), 'getSchedulesByContact'),
    createSchedule: (data) => withTimeout(rawApi.createSchedule(data), 'createSchedule'),
    updateSchedule: (id, data) => withTimeout(rawApi.updateSchedule(id, data), 'updateSchedule'),
    deleteSchedule: (id) => withTimeout(rawApi.deleteSchedule(id), 'deleteSchedule'),
    toggleSchedule: (id, enabled) => withTimeout(rawApi.toggleSchedule(id, enabled), 'toggleSchedule'),
    testSend: (id) => withTimeout(rawApi.testSend(id), 'testSend'),
    getNextFireTimes: () => withTimeout(rawApi.getNextFireTimes(), 'getNextFireTimes'),
    checkConflicts: (data) => withTimeout(rawApi.checkConflicts(data), 'checkConflicts'),

    // Reminders
    getReminders: () => withTimeout(rawApi.getReminders(), 'getReminders'),
    createReminder: (data) => withTimeout(rawApi.createReminder(data), 'createReminder'),
    updateReminder: (id, data) => withTimeout(rawApi.updateReminder(id, data), 'updateReminder'),
    deleteReminder: (id) => withTimeout(rawApi.deleteReminder(id), 'deleteReminder'),
    snoozeReminder: (id, until) => withTimeout(rawApi.snoozeReminder(id, until), 'snoozeReminder'),
    openMessageCompose: (contactId) => withTimeout(rawApi.openMessageCompose(contactId), 'openMessageCompose'),

    // Logs
    getLogs: (limit) => withTimeout(rawApi.getLogs(limit), 'getLogs'),
    getLogsBySchedule: (scheduleId) => withTimeout(rawApi.getLogsBySchedule(scheduleId), 'getLogsBySchedule'),
    clearLogs: (olderThanDays) => withTimeout(rawApi.clearLogs(olderThanDays), 'clearLogs'),

    // Settings
    getSettings: () => withTimeout(rawApi.getSettings(), 'getSettings'),
    updateSetting: (key, value) => withTimeout(rawApi.updateSetting(key, value), 'updateSetting'),

    // System
    checkChromeAccess: () => withTimeout(rawApi.checkChromeAccess(), 'checkChromeAccess'),
    openLinkedInInChrome: () => withTimeout(rawApi.openLinkedInInChrome(), 'openLinkedInInChrome'),

    // Events are pass-through (they return unsubscribe functions, not promises)
    onScheduleExecuted: (callback) => rawApi.onScheduleExecuted(callback),
    onReminderTriggered: (callback) => rawApi.onReminderTriggered(callback)
  }
}

export const api: ElectronAPI = createIpcApi(window.api)
Object.freeze(api)
