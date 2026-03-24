import { app, BrowserWindow, shell, powerMonitor, Notification, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { initDb, closeDb, getSettings, getScheduleById, getContactById } from './services/db.service'
import { initScheduler, setOnExecutedCallback, shutdownScheduler, resyncAfterWake } from './services/scheduler.service'
import { initReminders, setOnReminderCallback, shutdownReminders, resyncReminders } from './services/reminder.service'
import { registerAllHandlers } from './ipc/handlers'
import { createLogger } from './utils/logger'
import type { RunLog, Reminder } from '../shared/types'

const log = createLogger('app')
const isDev = !app.isPackaged

// --- Single instance lock ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log.warn('Another instance is already running — quitting')
  app.quit()
}

// --- Crash safety ---
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception (scheduler continues running)', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', reason instanceof Error ? reason : String(reason))
})

/** Resolve a resource path that works in both dev and packaged builds. */
function getResourcePath(...segments: string[]): string {
  const base = isDev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath, 'resources')
  return join(base, ...segments)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const DEFAULT_CONTACT_LABEL = 'saved contact'
const DEFAULT_REMINDER_LABEL = 'your contact'
const NOTIFICATION_TEXT_LIMIT = 120

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) return normalized
  }
  return null
}

function truncateForNotification(value: string | null | undefined, maxLength = NOTIFICATION_TEXT_LIMIT): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function wasOpenedHiddenAtLogin(): boolean {
  const loginItemSettings = app.getLoginItemSettings()
  return loginItemSettings.wasOpenedAtLogin && loginItemSettings.wasOpenedAsHidden
}

function getMainWindow(): BrowserWindow | null {
  if (mainWindow?.isDestroyed()) {
    mainWindow = null
  }
  return mainWindow
}

function createWindow(): BrowserWindow {
  const existingWindow = getMainWindow()
  if (existingWindow) return existingWindow

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    icon: getResourcePath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide window on close instead of destroying (keeps scheduler running)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      hideMainWindow()
    }
  })

  mainWindow.on('closed', () => {
    log.info('Main window closed')
    mainWindow = null
  })

  // Load renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function ensureMainWindow(): BrowserWindow {
  return getMainWindow() ?? createWindow()
}

function showMainWindow(): void {
  const window = ensureMainWindow()
  if (window.isMinimized()) {
    window.restore()
  }
  if (!window.isVisible()) {
    window.show()
  }
  window.focus()
}

function hideMainWindow(): void {
  const window = getMainWindow()
  if (!window || !window.isVisible()) return
  window.hide()
  log.info('Main window hidden; app remains active in the tray/background')
}

function syncLoginItemSettings(): void {
  const settings = getSettings()
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: true })
}

function sendToRenderer(channel: 'schedule:executed' | 'reminder:triggered', payload: RunLog | Reminder): void {
  const window = getMainWindow()
  if (!window) return

  if (channel === 'schedule:executed') {
    window.webContents.send('schedule:executed', payload)
    return
  }

  window.webContents.send('reminder:triggered', payload)
}

function getExecutionContactLabel(execLog: RunLog): string {
  const schedule = getScheduleById(execLog.scheduleId)
  const contact = schedule ? getContactById(schedule.contactId) : null

  return firstNonEmpty(
    contact?.name,
    schedule?.contactName,
    execLog.contactName,
    contact?.linkedinSlug,
    execLog.linkedinSlug
  ) ?? DEFAULT_CONTACT_LABEL
}

function getExecutionMessagePreview(execLog: RunLog): string | null {
  const schedule = getScheduleById(execLog.scheduleId)
  return truncateForNotification(schedule?.message ?? execLog.messagePreview, 90)
}

function buildExecutionNotification(execLog: RunLog): { title: string; body: string } {
  const label = getExecutionContactLabel(execLog)
  const messagePreview = getExecutionMessagePreview(execLog)
  const title = execLog.status === 'success' ? 'Message Sent'
    : execLog.status === 'dry_run' ? 'Dry Run Complete'
    : execLog.status === 'failed' ? 'Send Failed'
    : 'Schedule Skipped'

  if (execLog.status === 'failed') {
    const failureReason = truncateForNotification(execLog.errorMessage, 180) ?? 'Unknown error'
    return {
      title,
      body: label === DEFAULT_CONTACT_LABEL ? failureReason : `${label}: ${failureReason}`
    }
  }

  if (execLog.status === 'skipped') {
    const skipReason = truncateForNotification(execLog.errorMessage, 180)
    return {
      title,
      body: skipReason ? `${label}: ${skipReason}` : `Skipped for ${label}`
    }
  }

  if (messagePreview) {
    return { title, body: `${label}: ${messagePreview}` }
  }

  return {
    title,
    body: execLog.status === 'dry_run'
      ? `Dry run completed for ${label}`
      : `Message sent to ${label}`
  }
}

function buildReminderNotification(reminder: Reminder): { title: string; body: string } {
  const contact = getContactById(reminder.contactId)
  const label = firstNonEmpty(contact?.name, reminder.contactName, contact?.linkedinSlug) ?? DEFAULT_REMINDER_LABEL
  const message = truncateForNotification(reminder.message, 180)

  return {
    title: label === DEFAULT_REMINDER_LABEL ? 'LinkedIn Reminder' : `Reach out to ${label}`,
    body: message ?? (
      label === DEFAULT_REMINDER_LABEL
        ? 'Time to review your LinkedIn reminders.'
        : `Time to connect with ${label} on LinkedIn.`
    )
  }
}

function createTray(): void {
  const iconPath = getResourcePath('trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('LockedIn')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        showMainWindow()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit LockedIn',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    showMainWindow()
  })
}

// --- Second instance handler: focus existing window ---
app.on('second-instance', () => {
  app.whenReady().then(() => {
    showMainWindow()
  })
})

app.whenReady().then(() => {
  log.info(`Starting LockedIn v${app.getVersion()} (${isDev ? 'dev' : 'packaged'})`)

  // Initialize database
  initDb()

  // Register IPC handlers
  registerAllHandlers()

  // Initialize scheduler
  initScheduler()

  // Initialize reminder engine
  initReminders()

  // Create system tray icon
  createTray()
  log.info('System tray created')

  // Sync login item setting from DB
  syncLoginItemSettings()

  // Push execution events to renderer + show native notification
  setOnExecutedCallback((execLog: RunLog) => {
    sendToRenderer('schedule:executed', execLog)

    if (Notification.isSupported()) {
      new Notification(buildExecutionNotification(execLog)).show()
    }
  })

  // Push reminder events to renderer + show native notification
  setOnReminderCallback((reminder: Reminder) => {
    sendToRenderer('reminder:triggered', reminder)

    if (Notification.isSupported()) {
      new Notification(buildReminderNotification(reminder)).show()
    }
  })

  // Re-sync after macOS sleep/wake
  powerMonitor.on('resume', () => {
    log.info('System resumed from sleep — resyncing')
    resyncAfterWake()
    resyncReminders()
  })

  if (wasOpenedHiddenAtLogin()) {
    log.info('App launched hidden at login; waiting for explicit show action')
  } else {
    showMainWindow()
  }

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  log.info('Shutting down...')
  shutdownScheduler()
  shutdownReminders()
  closeDb()
  log.info('Shutdown complete')
})
