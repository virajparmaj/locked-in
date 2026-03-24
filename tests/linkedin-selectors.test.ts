import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  areSameLinkedInProfileUrls,
  extractLinkedInSlug,
  isLinkedInProfileUrl,
  normalizeLinkedInProfileUrl,
  normalizeLinkedInRecipientText
} from '@shared/linkedin'

function readLinkedInServiceSource(): string {
  return readFileSync(join(__dirname, '..', 'electron/services/linkedin.service.ts'), 'utf-8')
}

describe('LinkedIn slug extraction', () => {
  it('extracts slugs from canonical and share-tracked profile URLs', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe')).toBe('john-doe')
    expect(extractLinkedInSlug('https://linkedin.com/in/john-doe?utm_source=share')).toBe('john-doe')
    expect(extractLinkedInSlug('https://www.linkedin.com/in/john-doe/#about')).toBe('john-doe')
  })

  it('decodes encoded slugs and rejects non-profile pages', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/jane%20doe/')).toBe('jane doe')
    expect(extractLinkedInSlug('https://www.linkedin.com/company/acme')).toBe('')
    expect(extractLinkedInSlug('https://example.com/profile/john')).toBe('')
  })
})

describe('LinkedIn profile URL normalization', () => {
  it('normalizes profile URLs into the canonical www form', () => {
    expect(normalizeLinkedInProfileUrl('https://linkedin.com/in/john-doe?trk=public_profile'))
      .toBe('https://www.linkedin.com/in/john-doe/')
    expect(normalizeLinkedInProfileUrl('linkedin.com/in/jane-doe-123abc'))
      .toBe('https://www.linkedin.com/in/jane-doe-123abc/')
  })

  it('preserves encoded slug content and rejects non-profile URLs', () => {
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/in/jane%20doe/'))
      .toBe('https://www.linkedin.com/in/jane%20doe/')
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/acme')).toBe('')
    expect(isLinkedInProfileUrl('https://www.linkedin.com/company/acme')).toBe(false)
  })

  it('treats equivalent profile URLs as the same automation target', () => {
    expect(areSameLinkedInProfileUrls(
      'https://linkedin.com/in/john-doe?trk=public_profile',
      'https://www.linkedin.com/in/john-doe/#recent-activity'
    )).toBe(true)
  })

  it('detects different profile URLs as different automation targets', () => {
    expect(areSameLinkedInProfileUrls(
      'https://www.linkedin.com/in/john-doe/',
      'https://www.linkedin.com/in/jane-doe/'
    )).toBe(false)
  })
})

describe('LinkedIn recipient text normalization', () => {
  it('normalizes recipient text for overlay matching', () => {
    expect(normalizeLinkedInRecipientText('Messaging with Jane Doe')).toBe('jane doe')
  })

  it('strips punctuation and repeated whitespace from recipient text', () => {
    expect(normalizeLinkedInRecipientText('  Jane   Doe,  ')).toBe('jane doe')
  })
})

describe('LinkedIn service contracts', () => {
  it('exports the selector contract used for the compose flow', () => {
    const src = readLinkedInServiceSource()

    expect(src).toContain('LINKEDIN_SELECTORS')
    expect(src).toContain('PROFILE_ROOT')
    expect(src).toContain('MESSAGE_INPUT')
    expect(src).toContain('SEND_BUTTON')
    expect(src).toContain('OVERLAY_CONTAINER')
  })

  it('serializes LinkedIn browser automation globally', () => {
    const src = readLinkedInServiceSource()

    expect(src).toContain('automationQueue')
    expect(src).toContain('withAutomationLock')
  })

  it('targets a deterministic browser context by explicit window and tab identity', () => {
    const src = readLinkedInServiceSource()

    expect(src).toContain('AUTOMATION_WINDOW_NAME')
    expect(src).toContain('windowId')
    expect(src).toContain('tabId')
    expect(src).not.toContain('active tab of first window')
  })

  it('verifies profile and overlay context before typing', () => {
    const src = readLinkedInServiceSource()

    expect(src).toContain('areSameLinkedInProfileUrls')
    expect(src).toContain('waitForMatchingOverlay')
    expect(src).toContain('overlay_mismatch')
  })

  it('requires post-click send confirmation instead of treating click as success', () => {
    const src = readLinkedInServiceSource()

    expect(src).toContain('waitForSendConfirmation')
    expect(src).toContain('send_confirmation_missing')
  })

  it('keeps class-based selectors for compose automation', () => {
    const src = readLinkedInServiceSource()

    expect(src).toMatch(/msg-form__contenteditable/)
    expect(src).toMatch(/msg-form__send-button/)
    expect(src).toMatch(/msg-overlay-bubble/)
  })
})
