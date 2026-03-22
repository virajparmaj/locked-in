import { useState, useMemo, useEffect } from 'react'
import { useScheduleContext } from '@/contexts/ScheduleContext'
import { useContactContext } from '@/contexts/ContactContext'
import { useToast } from '@/components/ui/toast'
import { ScheduleModal } from '@/components/ScheduleModal'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Plus, Pencil, Trash2, Play, Copy, CalendarClock, Clock, Search } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { truncate, formatDateTime, formatRelativeTime, formatScheduleType, getTimelineBucket, BUCKET_LABELS, type TimelineBucket } from '@/lib/utils'
import type { Schedule, CreateScheduleInput } from '../../shared/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function scheduleLabel(s: Schedule): string {
  if (s.scheduleType === 'one_time') return `Once: ${formatDateTime(s.scheduledAt)}`
  if (s.scheduleType === 'weekly') return `Every ${DAYS[s.dayOfWeek ?? 0]} at ${s.timeOfDay}`
  if (s.scheduleType === 'quarterly') {
    const m = s.monthOfYear ?? 0
    const months = [0, 1, 2, 3].map(i => MONTHS_SHORT[(m + i * 3) % 12]).join(', ')
    return `Quarterly (${months}) · ${s.dayOfMonth}th · ${s.timeOfDay}`
  }
  if (s.scheduleType === 'half_yearly') {
    const m = s.monthOfYear ?? 0
    return `Half-yearly (${MONTHS_SHORT[m]} & ${MONTHS_SHORT[(m + 6) % 12]}) · ${s.dayOfMonth}th · ${s.timeOfDay}`
  }
  if (s.scheduleType === 'yearly') {
    return `Yearly (${MONTHS_SHORT[s.monthOfYear ?? 0]} ${s.dayOfMonth}) · ${s.timeOfDay}`
  }
  return s.scheduleType
}

function SkeletonCard() {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4 animate-pulse">
      <div className="h-5 w-9 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-36 rounded bg-muted" />
        <div className="h-3 w-52 rounded bg-muted" />
        <div className="h-3 w-28 rounded bg-muted" />
      </div>
      <div className="flex gap-1">
        <div className="h-8 w-8 rounded bg-muted" />
        <div className="h-8 w-8 rounded bg-muted" />
      </div>
    </div>
  )
}

const BUCKET_ORDER: TimelineBucket[] = ['upcoming', 'quarterly', 'half_yearly', 'yearly', 'beyond']

export function Dashboard() {
  const { schedules, fireTimes, loading, error, create, update, remove, toggle, testSend, refresh } = useScheduleContext()
  const { contacts } = useContactContext()
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmTestSend, setConfirmTestSend] = useState<string | null>(null)

  useEffect(() => {
    const handler = () => handleNew()
    window.addEventListener('app:new-schedule', handler)
    return () => window.removeEventListener('app:new-schedule', handler)
  }, [])

  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'next_fire' | 'contact_az' | 'created' | 'updated'>('next_fire')

  const filteredSchedules = useMemo(() => {
    if (!searchQuery.trim()) return schedules
    const q = searchQuery.toLowerCase()
    return schedules.filter(
      (s) =>
        s.contactName.toLowerCase().includes(q) ||
        s.message.toLowerCase().includes(q)
    )
  }, [schedules, searchQuery])

  const sortedSchedules = useMemo(() => {
    const arr = [...filteredSchedules]
    switch (sortBy) {
      case 'next_fire':
        return arr.sort((a, b) => {
          const ta = fireTimes[a.id] || '9999'
          const tb = fireTimes[b.id] || '9999'
          return ta.localeCompare(tb)
        })
      case 'contact_az':
        return arr.sort((a, b) => a.contactName.localeCompare(b.contactName))
      case 'created':
        return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      case 'updated':
        return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      default:
        return arr
    }
  }, [filteredSchedules, fireTimes, sortBy])

  const grouped = useMemo(() => {
    const map = new Map<TimelineBucket, Schedule[]>()
    for (const s of sortedSchedules) {
      const bucket = getTimelineBucket(fireTimes[s.id])
      if (!map.has(bucket)) map.set(bucket, [])
      map.get(bucket)!.push(s)
    }
    return map
  }, [sortedSchedules, fireTimes])

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleEdit(s: Schedule) {
    setEditing(s)
    setModalOpen(true)
  }

  async function handleSubmit(data: CreateScheduleInput) {
    if (editing) {
      await update(editing.id, data)
      toast({ title: 'Schedule updated' })
    } else {
      await create(data)
      toast({ title: 'Schedule created' })
    }
  }

  async function handleDuplicate(s: Schedule) {
    const data: CreateScheduleInput = {
      contactId: s.contactId,
      message: s.message,
      scheduleType: s.scheduleType,
      scheduledAt: s.scheduledAt || undefined,
      timeOfDay: s.timeOfDay || undefined,
      dayOfWeek: s.dayOfWeek ?? undefined,
      dayOfMonth: s.dayOfMonth ?? undefined,
      monthOfYear: s.monthOfYear ?? undefined,
      dryRun: s.dryRun
    }
    await create(data)
    toast({ title: 'Schedule duplicated' })
  }

  async function handleDelete(id: string) {
    await remove(id)
    setConfirmDelete(null)
    toast({ title: 'Schedule deleted' })
  }

  async function handleTestSend(id: string) {
    setConfirmTestSend(null)
    const result = await testSend(id)
    if (result.dryRun) {
      toast({ title: 'Dry run complete' })
    } else if (result.success) {
      toast({ title: 'Message sent' })
    } else {
      toast({ title: 'Send failed', description: result.error, variant: 'destructive' })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Scheduled Messages</h2>
          <p className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {/* Search + Sort */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by contact, message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <option value="next_fire">Sort: Next fire</option>
          <option value="contact_az">Sort: Contact A-Z</option>
          <option value="created">Sort: Newest</option>
          <option value="updated">Sort: Recently updated</option>
        </Select>
      </div>

      {/* Schedule list */}
      {loading ? (
        <div className="space-y-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : error ? (
        <ErrorAlert error={error} onRetry={refresh} />
      ) : sortedSchedules.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarClock className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No schedules yet</p>
          <p className="text-sm">Click "New Schedule" to get started</p>
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKET_ORDER.map((bucket) => {
            const items = grouped.get(bucket)
            if (!items || items.length === 0) return null
            return (
              <div key={bucket}>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {BUCKET_LABELS[bucket]} ({items.length})
                </h3>
                <div className="space-y-2">
                  {items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-4 rounded-lg border bg-card p-4 card-hover"
                    >
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(checked) => toggle(s.id, checked)}
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{s.contactName || 'Unknown'}</span>
                          <StatusBadge status={s.enabled ? 'active' : 'paused'} />
                          {s.dryRun && <StatusBadge status="dry_run" />}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{truncate(s.message, 60)}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {scheduleLabel(s)}
                          </span>
                          {fireTimes[s.id] && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Next: {formatRelativeTime(fireTimes[s.id])}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setConfirmTestSend(s.id)} title="Test send">
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDuplicate(s)} title="Duplicate">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(s)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(s.id)} title="Delete" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <h3 className="font-semibold">Delete Schedule?</h3>
            <p className="text-sm text-muted-foreground">This will permanently delete this schedule and its run history.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm test send */}
      {confirmTestSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <h3 className="font-semibold">Test Send?</h3>
            <p className="text-sm text-muted-foreground">This will send the message now (or perform a dry run if enabled).</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmTestSend(null)}>Cancel</Button>
              <Button onClick={() => handleTestSend(confirmTestSend)}>Send Now</Button>
            </div>
          </div>
        </div>
      )}

      <ScheduleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        schedule={editing}
        contacts={contacts}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
