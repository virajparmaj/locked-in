import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScheduleForm } from '@/components/ScheduleForm'
import type { Schedule, CreateScheduleInput, Contact } from '../../shared/types'

interface ScheduleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule?: Schedule | null
  contacts: Contact[]
  onSubmit: (data: CreateScheduleInput) => Promise<void>
  defaultDate?: Date
}

export function ScheduleModal({ open, onOpenChange, schedule, contacts, onSubmit, defaultDate }: ScheduleModalProps) {
  const formKey = schedule?.id ?? defaultDate?.toISOString() ?? 'new'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-lg">
      <DialogHeader>
        <DialogTitle>{schedule ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
      </DialogHeader>
      <ScheduleForm
        key={formKey}
        initial={schedule}
        defaultDate={defaultDate}
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
