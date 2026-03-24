import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { Contact, CreateReminderInput, ReminderFrequency, Reminder } from '../../shared/types'

interface ReminderFormProps {
  initial?: Reminder | null
  contacts: Contact[]
  onSubmit: (data: CreateReminderInput) => Promise<void>
  onCancel: () => void
}

function getReminderFormState(initial?: Reminder | null) {
  return {
    contactId: initial?.contactId ?? '',
    frequency: initial?.frequency ?? 'quarterly',
    message: initial?.message ?? ''
  } satisfies {
    contactId: string
    frequency: ReminderFrequency
    message: string
  }
}

export function ReminderForm({ initial, contacts, onSubmit, onCancel }: ReminderFormProps) {
  const [contactId, setContactId] = useState(() => getReminderFormState(initial).contactId)
  const [frequency, setFrequency] = useState<ReminderFrequency>(() => getReminderFormState(initial).frequency)
  const [message, setMessage] = useState(() => getReminderFormState(initial).message)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const next = getReminderFormState(initial)
    setContactId(next.contactId)
    setFrequency(next.frequency)
    setMessage(next.message)
    setSubmitting(false)
    setErrors({})
  }, [initial?.id])

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!contactId) errs.contactId = 'Select a contact'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    try {
      await onSubmit({
        contactId,
        frequency,
        message: message.trim()
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Contact</Label>
        <Select value={contactId} onValueChange={setContactId}>
          <option value="">Select a contact...</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.company ? ` (${c.company})` : ''}
            </option>
          ))}
        </Select>
        {errors.contactId && <p className="text-xs text-destructive">{errors.contactId}</p>}
      </div>

      <div className="space-y-2">
        <Label>Frequency</Label>
        <Select value={frequency} onValueChange={(v) => setFrequency(v as ReminderFrequency)}>
          <option value="weekly">Weekly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reminder-message">Reminder Note (optional)</Label>
        <Textarea
          id="reminder-message"
          placeholder="e.g., Follow up on coffee chat..."
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : initial ? 'Update' : 'Create Reminder'}
        </Button>
      </div>
    </form>
  )
}
