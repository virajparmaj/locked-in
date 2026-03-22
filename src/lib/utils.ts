import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { differenceInDays } from 'date-fns'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const absDiffMs = Math.abs(diffMs)
  const isFuture = diffMs > 0
  const prefix = isFuture ? 'in ' : ''
  const suffix = isFuture ? '' : ' ago'

  const mins = Math.round(absDiffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${prefix}${mins}m${suffix}`

  const hours = Math.round(mins / 60)
  if (hours < 24) return `${prefix}${hours}h${suffix}`

  const days = Math.round(hours / 24)
  if (days < 7) return `${prefix}${days}d${suffix}`
  if (days < 30) {
    const weeks = Math.round(days / 7)
    return `${prefix}${weeks}w${suffix}`
  }
  if (days < 365) {
    const months = Math.round(days / 30)
    return `${prefix}${months}mo${suffix}`
  }

  return date.toLocaleDateString()
}

// Timeline grouping
export type TimelineBucket = 'upcoming' | 'quarterly' | 'half_yearly' | 'yearly' | 'beyond'

export const BUCKET_LABELS: Record<TimelineBucket, string> = {
  upcoming: 'Upcoming (Next 30 days)',
  quarterly: 'Quarterly (1-3 months)',
  half_yearly: 'Half Yearly (3-6 months)',
  yearly: 'Yearly (6-12 months)',
  beyond: 'Beyond (12+ months)'
}

export function getTimelineBucket(nextRunAt: string | null | undefined): TimelineBucket {
  if (!nextRunAt) return 'beyond'
  const days = differenceInDays(new Date(nextRunAt), new Date())
  if (days <= 30) return 'upcoming'
  if (days <= 90) return 'quarterly'
  if (days <= 180) return 'half_yearly'
  if (days <= 365) return 'yearly'
  return 'beyond'
}

/** Extract LinkedIn slug from a profile URL */
export function extractSlug(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([^\/?#]+)/)
  return match ? match[1] : ''
}

/** Format schedule type for display */
export function formatScheduleType(type: string): string {
  switch (type) {
    case 'one_time': return 'One-time'
    case 'weekly': return 'Weekly'
    case 'quarterly': return 'Quarterly'
    case 'half_yearly': return 'Half Yearly'
    case 'yearly': return 'Yearly'
    default: return type
  }
}
