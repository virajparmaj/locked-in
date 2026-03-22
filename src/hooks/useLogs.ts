import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/ipc'
import type { RunLog } from '../../shared/types'

export function useLogs() {
  const [logs, setLogs] = useState<RunLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getLogs(200)
      setLogs(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to load logs:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const unsub = api.onScheduleExecuted(() => { refresh() })
    return unsub
  }, [refresh])

  const clearLogs = async (olderThanDays?: number): Promise<void> => {
    await api.clearLogs(olderThanDays)
    await refresh()
  }

  return { logs, loading, error, refresh, clearLogs }
}
