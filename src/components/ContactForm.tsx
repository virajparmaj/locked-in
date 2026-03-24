import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { extractSlug } from '@/lib/utils'
import { normalizeLinkedInProfileUrl } from '@shared/linkedin'
import type { Contact, CreateContactInput } from '../../shared/types'

interface ContactFormProps {
  initial?: Contact | null
  onSubmit: (data: CreateContactInput) => Promise<void>
  onCancel: () => void
}

function getContactFormState(initial?: Contact | null) {
  return {
    name: initial?.name ?? '',
    linkedinUrl: initial?.linkedinUrl ?? '',
    company: initial?.company ?? '',
    notes: initial?.notes ?? '',
    tags: initial?.tags.join(', ') ?? '',
    slug: initial?.linkedinSlug ?? ''
  }
}

export function ContactForm({ initial, onSubmit, onCancel }: ContactFormProps) {
  const [name, setName] = useState(() => getContactFormState(initial).name)
  const [linkedinUrl, setLinkedinUrl] = useState(() => getContactFormState(initial).linkedinUrl)
  const [company, setCompany] = useState(() => getContactFormState(initial).company)
  const [notes, setNotes] = useState(() => getContactFormState(initial).notes)
  const [tags, setTags] = useState(() => getContactFormState(initial).tags)
  const [slug, setSlug] = useState(() => getContactFormState(initial).slug)
  const normalizedUrlPreview = normalizeLinkedInProfileUrl(linkedinUrl)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const next = getContactFormState(initial)
    setName(next.name)
    setLinkedinUrl(next.linkedinUrl)
    setCompany(next.company)
    setNotes(next.notes)
    setTags(next.tags)
    setSlug(next.slug)
    setSubmitting(false)
    setErrors({})
  }, [initial?.id])

  // Live slug extraction
  useEffect(() => {
    setSlug(extractSlug(linkedinUrl))
  }, [linkedinUrl])

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Name is required'
    if (!linkedinUrl.trim()) {
      errs.linkedinUrl = 'LinkedIn URL is required'
    } else if (!slug) {
      errs.linkedinUrl = 'Invalid LinkedIn URL (expected: linkedin.com/in/username)'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        linkedinUrl: linkedinUrl.trim(),
        company: company.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="url">LinkedIn Profile URL</Label>
        <Input
          id="url"
          placeholder="https://www.linkedin.com/in/john-doe/"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
        />
        {slug && (
          <p className="text-xs text-muted-foreground">
            Profile detected: <span className="font-mono text-primary">{normalizedUrlPreview}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          LockedIn opens this profile in your browser, clicks <span className="font-medium">Message</span>, then continues from the compose box.
        </p>
        {errors.linkedinUrl && <p className="text-xs text-destructive">{errors.linkedinUrl}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="company">Company (optional)</Label>
        <Input id="company" placeholder="Acme Inc." value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags (comma-separated, optional)</Label>
        <Input id="tags" placeholder="investor, mentor, recruiter" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" placeholder="Met at..." rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : initial ? 'Update' : 'Add Contact'}
        </Button>
      </div>
    </form>
  )
}
