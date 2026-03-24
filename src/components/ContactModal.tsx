import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContactForm } from '@/components/ContactForm'
import type { Contact, CreateContactInput } from '../../shared/types'

interface ContactModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: Contact | null
  onSubmit: (data: CreateContactInput) => Promise<void>
}

export function ContactModal({ open, onOpenChange, contact, onSubmit }: ContactModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{contact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
      </DialogHeader>
      <ContactForm
        key={contact?.id ?? 'new'}
        initial={contact}
        onSubmit={async (data) => {
          await onSubmit(data)
          onOpenChange(false)
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  )
}
