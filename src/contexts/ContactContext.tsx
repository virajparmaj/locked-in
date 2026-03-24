import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/ipc'
import type { Contact, CreateContactInput, UpdateContactInput } from '../../shared/types'

const CONTACTS_CHANGED_EVENT = 'lockedin:contacts-changed'

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

  const notifyContactsChanged = useCallback((type: 'created' | 'updated' | 'deleted', id: string) => {
    window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT, {
      detail: { type, id }
    }))
  }, [])

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
    notifyContactsChanged('created', contact.id)
    await refresh()
    return contact
  }, [notifyContactsChanged, refresh])

  const update = useCallback(async (id: string, data: UpdateContactInput): Promise<Contact> => {
    const contact = await api.updateContact(id, data)
    notifyContactsChanged('updated', id)
    await refresh()
    return contact
  }, [notifyContactsChanged, refresh])

  const remove = useCallback(async (id: string): Promise<void> => {
    await api.deleteContact(id)
    notifyContactsChanged('deleted', id)
    await refresh()
  }, [notifyContactsChanged, refresh])

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
