import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/ipc'
import { CalendarDays, AlertTriangle } from 'lucide-react'
import { ExtendedScheduleDialog } from '@/components/ExtendedScheduleDialog'
import type { Schedule, CreateScheduleInput, ScheduleType, Contact } from '../../shared/types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const EXTENDED_TYPES = ['quarterly', 'half_yearly', 'yearly'] as const
type ExtendedType = typeof EXTENDED_TYPES[number]

function isExtendedType(t: string): t is ExtendedType {
  return (EXTENDED_TYPES as readonly string[]).includes(t)
}

function buildSummaryText(
  scheduleType: string,
  timeOfDay: string,
  dayOfMonth: number,
  monthOfYear: number
): string {
  const day = dayOfMonth
  const time = timeOfDay || '09:00'
  if (scheduleType === 'quarterly') {
    const months = [0, 1, 2, 3].map(i => MONTHS[(monthOfYear + i * 3) % 12])
    return `${day}th of ${months.join(', ')} at ${time}`
  }
  if (scheduleType === 'half_yearly') {
    const m2 = (monthOfYear + 6) % 12
    return `${day}th of ${MONTHS[monthOfYear]} and ${MONTHS[m2]} at ${time}`
  }
  if (scheduleType === 'yearly') {
    return `${day}th of ${MONTHS[monthOfYear]} every year at ${time}`
  }
  return ''
}

interface ScheduleFormProps {
  initial?: Schedule | null
  defaultDate?: Date
  contacts: Contact[]
  onSubmit: (data: CreateScheduleInput) => Promise<void>
  onCancel: () => void
}

export function ScheduleForm({ initial, defaultDate, contacts, onSubmit, onCancel }: ScheduleFormProps) {
  function getInitialScheduledAt(): string {
    if (initial?.scheduledAt) return initial.scheduledAt
    if (defaultDate) {
      const d = new Date(defaultDate)
      d.setHours(9, 0, 0, 0)
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
      return local
    }
    return ''
  }

  const [contactId, setContactId] = useState(initial?.contactId || '')
  const [message, setMessage] = useState(initial?.message || '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial?.scheduleType || 'one_time')
  const [scheduledAt, setScheduledAt] = useState(getInitialScheduledAt())
  const [timeOfDay, setTimeOfDay] = useState(initial?.timeOfDay || '09:00')
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 1)
  const [dryRun, setDryRun] = useState(initial?.dryRun || false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Extended schedule state
  const [extDialogOpen, setExtDialogOpen] = useState(false)
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth ?? 15)
  const [monthOfYear, setMonthOfYear] = useState(initial?.monthOfYear ?? 0)
  const [extConfigured, setExtConfigured] = useState(
    !!initial && isExtendedType(initial.scheduleType)
  )

  // Conflict detection
  const [conflicts, setConflicts] = useState<Schedule[]>([])
  const conflictDismissedRef = useRef(false)

  useEffect(() => {
    if (initial?.scheduledAt) {
      try {
        const d = new Date(initial.scheduledAt)
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        setScheduledAt(local)
      } catch {
        setScheduledAt('')
      }
    }
  }, [initial])

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!contactId) {
      errs.contactId = 'Select a contact'
    }
    if (!message.trim()) {
      errs.message = 'Message cannot be empty'
    }
    if (scheduleType === 'one_time' && !scheduledAt) {
      errs.scheduledAt = 'Select a date and time'
    }
    if (scheduleType === 'one_time' && scheduledAt) {
      const d = new Date(scheduledAt)
      if (d <= new Date()) {
        errs.scheduledAt = 'Date must be in the future'
      }
    }
    if (isExtendedType(scheduleType) && !extConfigured) {
      errs.extended = 'Please configure the recurrence schedule'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!validate()) return

    if (!conflictDismissedRef.current) {
      try {
        const found = await api.checkConflicts({
          contactId,
          scheduleType,
          scheduledAt: scheduleType === 'one_time' ? new Date(scheduledAt).toISOString() : null,
          timeOfDay: scheduleType !== 'one_time' ? timeOfDay : null,
          dayOfWeek: scheduleType === 'weekly' ? dayOfWeek : null,
          excludeId: initial?.id
        })
        if (found.length > 0) {
          setConflicts(found)
          return
        }
      } catch {
        // If conflict check fails, proceed
      }
    }

    setSubmitting(true)
    try {
      const data: CreateScheduleInput = {
        contactId,
        message: message.trim(),
        scheduleType,
        dryRun
      }

      if (scheduleType === 'one_time') {
        data.scheduledAt = new Date(scheduledAt).toISOString()
      } else if (scheduleType === 'weekly') {
        data.timeOfDay = timeOfDay
        data.dayOfWeek = dayOfWeek
      } else if (isExtendedType(scheduleType)) {
        data.timeOfDay = timeOfDay
        data.dayOfMonth = dayOfMonth
        data.monthOfYear = monthOfYear
      }

      await onSubmit(data)
    } finally {
      setSubmitting(false)
      setConflicts([])
      conflictDismissedRef.current = false
    }
  }

  const summaryText = isExtendedType(scheduleType)
    ? buildSummaryText(scheduleType, timeOfDay, dayOfMonth, monthOfYear)
    : ''

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Contact */}
        <div className="space-y-2">
          <Label>Contact</Label>
          <Select value={contactId} onValueChange={(v) => setContactId(v)}>
            <option value="">Select a contact...</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.company ? ` (${c.company})` : ''}
              </option>
            ))}
          </Select>
          {errors.contactId && <p className="text-xs text-destructive">{errors.contactId}</p>}
        </div>

        {/* Message */}
        <div className="space-y-2">
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            placeholder="Type your message..."
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            {errors.message && <p className="text-destructive">{errors.message}</p>}
            <span className="ml-auto">{message.length} chars</span>
          </div>
        </div>

        {/* Schedule Type */}
        <div className="space-y-2">
          <Label>Schedule Type</Label>
          <Select
            value={scheduleType}
            onValueChange={(v) => {
              setScheduleType(v as ScheduleType)
              if (!isExtendedType(v)) setExtConfigured(false)
            }}
          >
            <option value="one_time">One-time</option>
            <option value="weekly">Weekly</option>
            <option disabled value="">-- Extended --</option>
            <option value="quarterly">Quarterly</option>
            <option value="half_yearly">Half-yearly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </div>

        {scheduleType === 'one_time' && (
          <div className="space-y-2">
            <Label htmlFor="datetime">Date & Time</Label>
            <Input id="datetime" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            {errors.scheduledAt && <p className="text-xs text-destructive">{errors.scheduledAt}</p>}
          </div>
        )}

        {scheduleType === 'weekly' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Day of Week</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                {DAYS.map((day, i) => (
                  <option key={i} value={String(i)}>{day}</option>
                ))}
              </Select>
            </div>
          </>
        )}

        {/* Extended schedule configure button */}
        {isExtendedType(scheduleType) && (
          <div className="space-y-2">
            {extConfigured ? (
              <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Recurrence configured</p>
                  <p className="text-xs text-muted-foreground">{summaryText}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setExtDialogOpen(true)}>Edit</Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => setExtDialogOpen(true)}>
                <CalendarDays className="h-4 w-4 mr-2" />
                Configure Recurrence
              </Button>
            )}
            {errors.extended && <p className="text-xs text-destructive">{errors.extended}</p>}
          </div>
        )}

        {/* Dry Run */}
        <div className="flex items-center gap-3">
          <Switch checked={dryRun} onCheckedChange={setDryRun} />
          <Label className="cursor-pointer" onClick={() => setDryRun(!dryRun)}>
            Dry run (don't actually send)
          </Label>
        </div>

        {/* Conflict Warning */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-400">
                Possible duplicate - {conflicts.length} existing schedule{conflicts.length > 1 ? 's' : ''} for this contact at the same time
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                onClick={() => {
                  conflictDismissedRef.current = true
                  setConflicts([])
                }}
              >
                Save Anyway
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConflicts([])}>
                Go Back
              </Button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : initial ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>

      {isExtendedType(scheduleType) && (
        <ExtendedScheduleDialog
          open={extDialogOpen}
          scheduleType={scheduleType}
          initialValues={{ timeOfDay, dayOfMonth, monthOfYear }}
          onSave={(values) => {
            setTimeOfDay(values.timeOfDay)
            setDayOfMonth(values.dayOfMonth)
            setMonthOfYear(values.monthOfYear)
            setExtConfigured(true)
            setExtDialogOpen(false)
          }}
          onCancel={() => setExtDialogOpen(false)}
        />
      )}
    </>
  )
}
