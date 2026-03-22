import { useState } from 'react'
import { useReminderContext } from '@/contexts/ReminderContext'
import { useContactContext } from '@/contexts/ContactContext'
import { useToast } from '@/components/ui/toast'
import { ReminderModal } from '@/components/ReminderModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Bell, Send, Clock } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { ErrorAlert } from '@/components/ErrorAlert'
import type { Reminder, CreateReminderInput } from '../../shared/types'

export function Reminders() {
  const { reminders, loading, error, create, update, remove, snooze, openCompose, refresh } = useReminderContext()
  const { contacts } = useContactContext()
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleEdit(r: Reminder) {
    setEditing(r)
    setModalOpen(true)
  }

  async function handleSubmit(data: CreateReminderInput) {
    if (editing) {
      await update(editing.id, data)
      toast({ title: 'Reminder updated' })
    } else {
      await create(data)
      toast({ title: 'Reminder created' })
    }
  }

  async function handleDelete(id: string) {
    await remove(id)
    setConfirmDelete(null)
    toast({ title: 'Reminder deleted' })
  }

  async function handleSnooze(id: string, days: number) {
    const until = new Date()
    until.setDate(until.getDate() + days)
    await snooze(id, until.toISOString())
    toast({ title: `Snoozed for ${days} day${days > 1 ? 's' : ''}` })
  }

  async function handleMessageNow(contactId: string) {
    try {
      await openCompose(contactId)
      toast({ title: 'Opening LinkedIn...' })
    } catch (err) {
      toast({ title: 'Failed to open', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
    }
  }

  const frequencyLabel = (f: string) => {
    switch (f) {
      case 'weekly': return 'Weekly'
      case 'quarterly': return 'Quarterly'
      case 'yearly': return 'Yearly'
      default: return f
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Reminders</h2>
          <p className="text-sm text-muted-foreground">
            {reminders.length} reminder{reminders.length !== 1 ? 's' : ''} — these trigger notifications, not auto-sends
          </p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Reminder
        </Button>
      </div>

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
      ) : reminders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No reminders yet</p>
          <p className="text-sm">Create reminders to get nudged about reaching out to contacts</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-4 rounded-lg border bg-card p-4 card-hover">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{r.contactName}</span>
                  <Badge variant="secondary">{frequencyLabel(r.frequency)}</Badge>
                </div>
                {r.message && (
                  <p className="text-xs text-muted-foreground truncate">{r.message}</p>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Next: {formatRelativeTime(r.nextReminderAt)}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleMessageNow(r.contactId)} title="Message now">
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Message
                </Button>
                <div className="relative group">
                  <Button variant="ghost" size="sm" title="Snooze">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Snooze
                  </Button>
                  <div className="hidden group-hover:block absolute right-0 top-full mt-1 rounded-md border bg-background shadow-lg z-10">
                    <button className="block w-full px-3 py-1.5 text-sm hover:bg-accent text-left" onClick={() => handleSnooze(r.id, 1)}>1 day</button>
                    <button className="block w-full px-3 py-1.5 text-sm hover:bg-accent text-left" onClick={() => handleSnooze(r.id, 3)}>3 days</button>
                    <button className="block w-full px-3 py-1.5 text-sm hover:bg-accent text-left" onClick={() => handleSnooze(r.id, 7)}>1 week</button>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleEdit(r)} title="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(r.id)} title="Delete" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <h3 className="font-semibold">Delete Reminder?</h3>
            <p className="text-sm text-muted-foreground">This reminder will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      <ReminderModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        reminder={editing}
        contacts={contacts}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
