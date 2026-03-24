import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/ipc'
import type { Reminder, CreateReminderInput, UpdateReminderInput } from '../../shared/types'

const CONTACTS_CHANGED_EVENT = 'lockedin:contacts-changed'

interface ReminderContextValue {
  reminders: Reminder[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (data: CreateReminderInput) => Promise<Reminder>
  update: (id: string, data: UpdateReminderInput) => Promise<Reminder>
  remove: (id: string) => Promise<void>
  snooze: (id: string, until: string) => Promise<void>
  openCompose: (contactId: string) => Promise<void>
}

const ReminderContext = createContext<ReminderContextValue | null>(null)

export function ReminderProvider({ children }: { children: ReactNode }) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const data = await api.getReminders()
      setReminders(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to load reminders:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh when a reminder triggers
  useEffect(() => {
    const unsub = api.onReminderTriggered(() => { refresh() })
    return unsub
  }, [refresh])

  useEffect(() => {
    const handleContactsChanged = () => { refresh() }
    window.addEventListener(CONTACTS_CHANGED_EVENT, handleContactsChanged)
    return () => window.removeEventListener(CONTACTS_CHANGED_EVENT, handleContactsChanged)
  }, [refresh])

  const create = useCallback(async (data: CreateReminderInput): Promise<Reminder> => {
    const reminder = await api.createReminder(data)
    await refresh()
    return reminder
  }, [refresh])

  const update = useCallback(async (id: string, data: UpdateReminderInput): Promise<Reminder> => {
    const reminder = await api.updateReminder(id, data)
    await refresh()
    return reminder
  }, [refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await api.deleteReminder(id)
    await refresh()
  }, [refresh])

  const snooze = useCallback(async (id: string, until: string): Promise<void> => {
    await api.snoozeReminder(id, until)
    await refresh()
  }, [refresh])

  const openCompose = useCallback(async (contactId: string): Promise<void> => {
    await api.openMessageCompose(contactId)
  }, [])

  return (
    <ReminderContext.Provider value={{
      reminders, loading, error, refresh,
      create, update, remove, snooze, openCompose
    }}>
      {children}
    </ReminderContext.Provider>
  )
}

export function useReminderContext(): ReminderContextValue {
  const ctx = useContext(ReminderContext)
  if (!ctx) throw new Error('useReminderContext must be used within ReminderProvider')
  return ctx
}
