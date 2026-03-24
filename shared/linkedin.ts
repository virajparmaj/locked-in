const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/i
const LINKEDIN_PROFILE_PATH_RE = /^\/in\/([^/?#]+)\/?$/i
const LINKEDIN_RECIPIENT_NOISE_RE = /\b(?:message|messaging|with|write|compose|new|chat|active|online|to)\b/gi

function toAbsoluteUrl(rawUrl: string): URL | null {
  const candidate = rawUrl.trim()
  if (!candidate) return null

  try {
    return new URL(candidate)
  } catch {
    try {
      return new URL(`https://${candidate}`)
    } catch {
      return null
    }
  }
}

function isLinkedInHost(hostname: string): boolean {
  return LINKEDIN_HOST_RE.test(hostname)
}

function decodeSlug(rawSlug: string): string {
  try {
    return decodeURIComponent(rawSlug)
  } catch {
    return rawSlug
  }
}

export function extractLinkedInSlug(url: string): string {
  const parsed = toAbsoluteUrl(url)
  if (!parsed || !isLinkedInHost(parsed.hostname)) return ''

  const match = parsed.pathname.match(LINKEDIN_PROFILE_PATH_RE)
  return match ? decodeSlug(match[1]) : ''
}

export function normalizeLinkedInProfileUrl(url: string): string {
  const slug = extractLinkedInSlug(url)
  if (!slug) return ''

  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`
}

export function isLinkedInProfileUrl(url: string): boolean {
  return normalizeLinkedInProfileUrl(url).length > 0
}

export function areSameLinkedInProfileUrls(left: string, right: string): boolean {
  const normalizedLeft = normalizeLinkedInProfileUrl(left)
  const normalizedRight = normalizeLinkedInProfileUrl(right)

  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}

export function normalizeLinkedInRecipientText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(LINKEDIN_RECIPIENT_NOISE_RE, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
