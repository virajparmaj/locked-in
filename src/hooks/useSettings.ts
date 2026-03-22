import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/ipc'
import type { AppSettings } from '../../shared/types'

const defaultSettings: AppSettings = {
  globalDryRun: false,
  sendDelayMs: 5000,
  pageLoadDelayMs: 4000,
  browserApp: 'Google Chrome',
  openAtLogin: false,
  maxRetries: 2,
  theme: 'system',
  defaultMessageTemplate: '',
  minIntervalBetweenSends: 60000
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getSettings()
      setSettings(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to load settings:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const updateSetting = async (key: string, value: string): Promise<void> => {
    await api.updateSetting(key, value)
    await refresh()
  }

  return { settings, loading, error, refresh, updateSetting }
}
