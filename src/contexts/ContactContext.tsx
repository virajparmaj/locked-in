import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/ipc'
import type { Contact, CreateContactInput, UpdateContactInput } from '../../shared/types'

interface ContactContextValue {
  contacts: Contact[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (data: CreateContactInput) => Promise<Contact>
  update: (id: string, data: UpdateContactInput) => Promise<Contact>
  remove: (id: string) => Promise<void>
  search: (query: string) => Promise<Contact[]>
}

const ContactContext = createContext<ContactContextValue | null>(null)

export function ContactProvider({ children }: { children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const data = await api.getContacts()
      setContacts(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Failed to load contacts:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (data: CreateContactInput): Promise<Contact> => {
    const contact = await api.createContact(data)
    await refresh()
    return contact
  }, [refresh])

  const update = useCallback(async (id: string, data: UpdateContactInput): Promise<Contact> => {
    const contact = await api.updateContact(id, data)
    await refresh()
    return contact
  }, [refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await api.deleteContact(id)
    await refresh()
  }, [refresh])

  const search = useCallback(async (query: string): Promise<Contact[]> => {
    return api.searchContacts(query)
  }, [])

  return (
    <ContactContext.Provider value={{
      contacts, loading, error, refresh,
      create, update, remove, search
    }}>
      {children}
    </ContactContext.Provider>
  )
}

export function useContactContext(): ContactContextValue {
  const ctx = useContext(ContactContext)
  if (!ctx) throw new Error('useContactContext must be used within ContactProvider')
  return ctx
}
