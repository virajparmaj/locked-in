import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ReminderForm } from '@/components/ReminderForm'
import type { Contact, CreateReminderInput, Reminder } from '../../shared/types'

interface ReminderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reminder?: Reminder | null
  contacts: Contact[]
  onSubmit: (data: CreateReminderInput) => Promise<void>
}

export function ReminderModal({ open, onOpenChange, reminder, contacts, onSubmit }: ReminderModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{reminder ? 'Edit Reminder' : 'New Reminder'}</DialogTitle>
      </DialogHeader>
      <ReminderForm
        initial={reminder}
        contacts={contacts}
        onSubmit={async (data) => {
          await onSubmit(data)
          onOpenChange(false)
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  )
}
