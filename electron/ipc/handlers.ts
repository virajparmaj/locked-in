import { registerContactsHandlers } from './contacts.ipc'
import { registerScheduleHandlers } from './schedule.ipc'
import { registerRemindersHandlers } from './reminders.ipc'
import { registerLogsHandlers } from './logs.ipc'
import { registerSettingsHandlers } from './settings.ipc'

export function registerAllHandlers(): void {
  registerContactsHandlers()
  registerScheduleHandlers()
  registerRemindersHandlers()
  registerLogsHandlers()
  registerSettingsHandlers()
}
