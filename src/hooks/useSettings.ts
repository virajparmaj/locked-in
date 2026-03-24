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
  const [saveError, setSaveError] = useState<string | null>(null)

  const clearSaveError = useCallback(() => {
    setSaveError(null)
  }, [])

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
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

  const updateSetting = useCallback(async (key: string, value: string): Promise<boolean> => {
    setSaveError(null)
    try {
      await api.updateSetting(key, value)
      await refresh(false)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to update setting:', msg)
      setSaveError(msg)
      return false
    }
  }, [refresh])

  return { settings, loading, error, saveError, refresh, updateSetting, clearSaveError }
}
