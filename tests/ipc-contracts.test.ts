import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Verify every IPC channel used in preload.ts has a corresponding handler
 * registered in the IPC handler files, and vice versa.
 */
describe('IPC contract completeness', () => {
  const root = join(__dirname, '..')

  function extractChannels(source: string, pattern: RegExp): string[] {
    const channels: string[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      channels.push(match[1])
    }
    return channels
  }

  it('all preload invoke channels have registered handlers', () => {
    const preloadSrc = readFileSync(join(root, 'electron/preload.ts'), 'utf-8')
    const invokeChannels = extractChannels(preloadSrc, /ipcRenderer\.invoke\('([^']+)'/g)

    const handlerFiles = [
      'electron/ipc/schedule.ipc.ts',
      'electron/ipc/logs.ipc.ts',
      'electron/ipc/settings.ipc.ts',
      'electron/ipc/contacts.ipc.ts',
      'electron/ipc/reminders.ipc.ts'
    ]

    const handlerSrc = handlerFiles
      .map(f => readFileSync(join(root, f), 'utf-8'))
      .join('\n')

    const handledChannels = extractChannels(handlerSrc, /ipcMain\.handle\('([^']+)'/g)

    for (const channel of invokeChannels) {
      expect(
        handledChannels,
        `Preload channel "${channel}" has no registered handler`
      ).toContain(channel)
    }
  })

  it('all registered handlers have preload invoke calls', () => {
    const preloadSrc = readFileSync(join(root, 'electron/preload.ts'), 'utf-8')
    const invokeChannels = extractChannels(preloadSrc, /ipcRenderer\.invoke\('([^']+)'/g)

    const handlerFiles = [
      'electron/ipc/schedule.ipc.ts',
      'electron/ipc/logs.ipc.ts',
      'electron/ipc/settings.ipc.ts',
      'electron/ipc/contacts.ipc.ts',
      'electron/ipc/reminders.ipc.ts'
    ]

    const handlerSrc = handlerFiles
      .map(f => readFileSync(join(root, f), 'utf-8'))
      .join('\n')

    const handledChannels = extractChannels(handlerSrc, /ipcMain\.handle\('([^']+)'/g)

    for (const channel of handledChannels) {
      expect(
        invokeChannels,
        `Handler channel "${channel}" has no preload invoke call`
      ).toContain(channel)
    }
  })

  it('preload listener channels have matching main process senders', () => {
    const preloadSrc = readFileSync(join(root, 'electron/preload.ts'), 'utf-8')
    const listenerChannels = extractChannels(preloadSrc, /ipcRenderer\.on\('([^']+)'/g)

    const mainSrc = readFileSync(join(root, 'electron/main.ts'), 'utf-8')
    const sendChannels = extractChannels(mainSrc, /\.send\('([^']+)'/g)

    for (const channel of listenerChannels) {
      expect(
        sendChannels,
        `Preload listener "${channel}" has no main process sender`
      ).toContain(channel)
    }
  })
})
