import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/ipc'
import type { Schedule, CreateScheduleInput, UpdateScheduleInput, SendResult } from '../../shared/types'

interface ScheduleContextValue {
  schedules: Schedule[]
  fireTimes: Record<string, string | null>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (data: CreateScheduleInput) => Promise<Schedule>
  update: (id: string, data: UpdateScheduleInput) => Promise<Schedule>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  testSend: (id: string) => Promise<SendResult>
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null)

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [fireTimes, setFireTimes] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [data, times] = await Promise.all([
        api.getSchedules(),
        api.getNextFireTimes()
      ])
      setSchedules(data)
      setFireTimes(times)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to load schedules:', msg)
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

  const create = useCallback(async (data: CreateScheduleInput): Promise<Schedule> => {
    const schedule = await api.createSchedule(data)
    await refresh()
    return schedule
  }, [refresh])

  const update = useCallback(async (id: string, data: UpdateScheduleInput): Promise<Schedule> => {
    const schedule = await api.updateSchedule(id, data)
    await refresh()
    return schedule
  }, [refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await api.deleteSchedule(id)
    await refresh()
  }, [refresh])

  const toggle = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    await api.toggleSchedule(id, enabled)
    await refresh()
  }, [refresh])

  const testSend = useCallback(async (id: string): Promise<SendResult> => {
    const result = await api.testSend(id)
    await refresh()
    return result
  }, [refresh])

  return (
    <ScheduleContext.Provider value={{
      schedules, fireTimes, loading, error, refresh,
      create, update, remove, toggle, testSend
    }}>
      {children}
    </ScheduleContext.Provider>
  )
}

export function useScheduleContext(): ScheduleContextValue {
  const ctx = useContext(ScheduleContext)
  if (!ctx) throw new Error('useScheduleContext must be used within ScheduleProvider')
  return ctx
}
