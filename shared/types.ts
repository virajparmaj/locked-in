// Schedule types
export type ScheduleType = 'one_time' | 'weekly' | 'quarterly' | 'half_yearly' | 'yearly'
export type RunStatus = 'success' | 'failed' | 'dry_run' | 'skipped'
export type ReminderFrequency = 'weekly' | 'quarterly' | 'yearly'
export type ThemePreference = 'system' | 'light' | 'dark'

// --- Contacts ---

export interface Contact {
  id: string
  name: string
  linkedinUrl: string
  linkedinSlug: string
  company: string
  notes: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateContactInput {
  name: string
  linkedinUrl: string
  company?: string
  notes?: string
  tags?: string[]
}

export type UpdateContactInput = Partial<CreateContactInput>

// --- Schedules ---

export interface Schedule {
  id: string
  contactId: string
  contactName: string // joined from contacts
  message: string
  scheduleType: ScheduleType
  scheduledAt: string | null       // ISO 8601 for one-time
  timeOfDay: string | null         // HH:mm for recurring
  dayOfWeek: number | null         // 0=Sun, 1=Mon, ..., 6=Sat for weekly
  dayOfMonth: number | null        // 1-28 for quarterly/half_yearly/yearly
  monthOfYear: number | null       // 0=Jan, ..., 11=Dec
  enabled: boolean
  dryRun: boolean
  lastFiredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateScheduleInput {
  contactId: string
  message: string
  scheduleType: ScheduleType
  scheduledAt?: string
  timeOfDay?: string
  dayOfWeek?: number
  dayOfMonth?: number
  monthOfYear?: number
  dryRun?: boolean
}

export type UpdateScheduleInput = Partial<CreateScheduleInput> & { enabled?: boolean }

// --- Reminders (notification rules) ---

export interface Reminder {
  id: string
  contactId: string
  contactName: string // joined from contacts
  frequency: ReminderFrequency
  nextReminderAt: string  // ISO 8601
  enabled: boolean
  message: string
}

export interface CreateReminderInput {
  contactId: string
  frequency: ReminderFrequency
  message: string
}

export type UpdateReminderInput = Partial<CreateReminderInput> & { enabled?: boolean }

// --- Run Logs ---

export interface RunLog {
  id: string
  scheduleId: string
  status: RunStatus
  errorMessage: string | null
  firedAt: string
  completedAt: string | null
  executionDuration?: number      // milliseconds
  scheduledTime?: string          // ISO 8601 intended fire time
  retryAttempt?: number           // 0 = initial attempt for a scheduled slot, 1+ = retries for that same slot
  retryOf?: string                // original run_log.id if this is a retry
  // joined from schedule + contact for display
  contactName?: string
  linkedinSlug?: string
  messagePreview?: string
}

// --- Settings ---

export interface AppSettings {
  globalDryRun: boolean
  sendDelayMs: number
  pageLoadDelayMs: number
  browserApp: string
  openAtLogin: boolean
  maxRetries: number              // retry attempts allowed after the initial attempt
  theme: ThemePreference
  defaultMessageTemplate: string
  minIntervalBetweenSends: number
}

// --- Send Result ---

export interface SendResult {
  success: boolean
  error?: string
  dryRun: boolean
}

export interface AccessibilityStatus {
  granted: boolean
  error?: string
}

// --- IPC API ---

export interface ElectronAPI {
  // Contacts
  getContacts(): Promise<Contact[]>
  getContact(id: string): Promise<Contact | null>
  createContact(data: CreateContactInput): Promise<Contact>
  updateContact(id: string, data: UpdateContactInput): Promise<Contact>
  deleteContact(id: string): Promise<void>
  searchContacts(query: string): Promise<Contact[]>

  // Schedules
  getSchedules(): Promise<Schedule[]>
  getSchedule(id: string): Promise<Schedule | null>
  getSchedulesByContact(contactId: string): Promise<Schedule[]>
  createSchedule(data: CreateScheduleInput): Promise<Schedule>
  updateSchedule(id: string, data: UpdateScheduleInput): Promise<Schedule>
  deleteSchedule(id: string): Promise<void>
  toggleSchedule(id: string, enabled: boolean): Promise<Schedule>
  testSend(id: string): Promise<SendResult>
  getNextFireTimes(): Promise<Record<string, string | null>>
  checkConflicts(data: {
    contactId: string
    scheduleType: string
    scheduledAt?: string | null
    timeOfDay?: string | null
    dayOfWeek?: number | null
    excludeId?: string
  }): Promise<Schedule[]>

  // Reminders
  getReminders(): Promise<Reminder[]>
  createReminder(data: CreateReminderInput): Promise<Reminder>
  updateReminder(id: string, data: UpdateReminderInput): Promise<Reminder>
  deleteReminder(id: string): Promise<void>
  snoozeReminder(id: string, until: string): Promise<void>
  openMessageCompose(contactId: string): Promise<void>

  // Logs
  getLogs(limit?: number): Promise<RunLog[]>
  getLogsBySchedule(scheduleId: string): Promise<RunLog[]>
  clearLogs(olderThanDays?: number): Promise<void>

  // Settings
  getSettings(): Promise<AppSettings>
  updateSetting(key: string, value: string): Promise<void>

  // System
  checkChromeAccess(): Promise<AccessibilityStatus>
  openLinkedInInChrome(): Promise<void>

  // Events
  onScheduleExecuted(callback: (log: RunLog) => void): () => void
  onReminderTriggered(callback: (reminder: Reminder) => void): () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
