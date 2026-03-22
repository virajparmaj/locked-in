import { app, BrowserWindow, shell, powerMonitor, Notification, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { initDb, closeDb, getSettings } from './services/db.service'
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
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
      mainWindow?.hide()
      log.info('Window hidden (scheduler still running in background)')
    }
  })

  // Load renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
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
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      createWindow()
    }
  })
}

// --- Second instance handler: focus existing window ---
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
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
  const settings = getSettings()
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: true })

  // Push execution events to renderer + show native notification
  setOnExecutedCallback((execLog: RunLog) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedule:executed', execLog)
    }

    if (Notification.isSupported()) {
      const title = execLog.status === 'success' ? 'Message Sent'
        : execLog.status === 'dry_run' ? 'Dry Run Complete'
        : execLog.status === 'failed' ? 'Send Failed'
        : 'Schedule Skipped'
      const body = execLog.status === 'failed'
        ? (execLog.errorMessage || 'Unknown error')
        : (execLog.contactName || execLog.scheduleId)
      new Notification({ title, body }).show()
    }
  })

  // Push reminder events to renderer + show native notification
  setOnReminderCallback((reminder: Reminder) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reminder:triggered', reminder)
    }

    if (Notification.isSupported()) {
      new Notification({
        title: `Reach out to ${reminder.contactName}`,
        body: reminder.message || `Time to connect with ${reminder.contactName} on LinkedIn`
      }).show()
    }
  })

  // Re-sync after macOS sleep/wake
  powerMonitor.on('resume', () => {
    log.info('System resumed from sleep — resyncing')
    resyncAfterWake()
    resyncReminders()
  })

  createWindow()

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
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
