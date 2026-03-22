import { useState, useMemo } from 'react'
import { useContactContext } from '@/contexts/ContactContext'
import { useToast } from '@/components/ui/toast'
import { ContactModal } from '@/components/ContactModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Users, Search, ExternalLink } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import type { Contact, CreateContactInput } from '../../shared/types'

export function Contacts() {
  const { contacts, loading, error, create, update, remove, refresh } = useContactContext()
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return contacts
    const q = searchQuery.toLowerCase()
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q)) ||
        c.linkedinSlug.toLowerCase().includes(q)
    )
  }, [contacts, searchQuery])

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleEdit(c: Contact) {
    setEditing(c)
    setModalOpen(true)
  }

  async function handleSubmit(data: CreateContactInput) {
    if (editing) {
      await update(editing.id, data)
      toast({ title: 'Contact updated' })
    } else {
      await create(data)
      toast({ title: 'Contact added' })
    }
  }

  async function handleDelete(id: string) {
    await remove(id)
    setConfirmDelete(null)
    toast({ title: 'Contact deleted' })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Contacts</h2>
          <p className="text-sm text-muted-foreground">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Contact
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, company, tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Contact list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-lg border bg-card p-4 animate-pulse">
              <div className="h-4 w-40 rounded bg-muted mb-2" />
              <div className="h-3 w-60 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorAlert error={error} onRetry={refresh} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No contacts yet</p>
          <p className="text-sm">Add LinkedIn contacts to start scheduling messages</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center gap-4 rounded-lg border bg-card p-4 card-hover">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary font-semibold text-sm">
                  {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{c.name}</span>
                  {c.company && (
                    <span className="text-xs text-muted-foreground truncate">{c.company}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground truncate">{c.linkedinSlug}</span>
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {c.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} title="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(c.id)} title="Delete" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <h3 className="font-semibold">Delete Contact?</h3>
            <p className="text-sm text-muted-foreground">This will also delete all schedules and reminders for this contact.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      <ContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contact={editing}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
