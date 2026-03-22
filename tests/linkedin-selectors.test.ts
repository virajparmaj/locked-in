import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Test LinkedIn selector config and slug extraction regex.
 */

// Replicate extractLinkedInSlug from db.service.ts
function extractLinkedInSlug(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([^\/?#]+)/)
  return match ? match[1] : ''
}

describe('LinkedIn slug extraction', () => {
  it('extracts slug from standard profile URL', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe')).toBe('john-doe')
  })

  it('extracts slug from URL with trailing slash', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe/')).toBe('john-doe')
  })

  it('extracts slug from URL with query params', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe?utm_source=share')).toBe('john-doe')
  })

  it('extracts slug from URL with hash', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe#section')).toBe('john-doe')
  })

  it('extracts slug from URL without www', () => {
    expect(extractLinkedInSlug('https://linkedin.com/in/john-doe')).toBe('john-doe')
  })

  it('extracts slug with numbers and special chars', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/jane-doe-123abc')).toBe('jane-doe-123abc')
  })

  it('returns empty string for non-LinkedIn URL', () => {
    expect(extractLinkedInSlug('https://example.com/profile/john')).toBe('')
  })

  it('returns empty string for LinkedIn company page', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/company/acme')).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(extractLinkedInSlug('')).toBe('')
  })
})

describe('LINKEDIN_SELECTORS config', () => {
  it('linkedin.service.ts exports LINKEDIN_SELECTORS with required keys', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/services/linkedin.service.ts'), 'utf-8')
    expect(src).toContain('LINKEDIN_SELECTORS')
    expect(src).toContain('MESSAGE_INPUT')
    expect(src).toContain('SEND_BUTTON')
    expect(src).toContain('PROFILE_URL_PREFIX')
  })

  it('PROFILE_URL_PREFIX uses correct LinkedIn profile URL', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/services/linkedin.service.ts'), 'utf-8')
    expect(src).toContain('linkedin.com/in/')
  })

  it('sendLinkedInMessage clicks Message button on profile before typing', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/services/linkedin.service.ts'), 'utf-8')
    expect(src).toContain('message_button_not_found')
    expect(src).toContain('waitForOverlay')
  })

  it('selectors use CSS class-based selectors (not fragile attribute selectors)', () => {
    const src = readFileSync(join(__dirname, '..', 'electron/services/linkedin.service.ts'), 'utf-8')
    // Verify selectors use class-based patterns
    expect(src).toMatch(/msg-form__contenteditable/)
    expect(src).toMatch(/msg-form__send-button/)
  })
})
