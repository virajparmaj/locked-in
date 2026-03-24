export interface CalendarDayCell {
  key: string
  date: Date
  dayOfMonth: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
}

export type Meridiem = 'AM' | 'PM'

export interface TimePickerParts {
  hour12: string
  minute: string
  meridiem: Meridiem
}

export const QUARTER_HOUR_MINUTES = ['00', '15', '30', '45'] as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatLocalDateTimeValue(date: Date): string {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join('T')
}

export function parseLocalDateTimeValue(value: string): Date | null {
  if (!value) return null

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null

  const [, year, month, day, hour, minute] = match
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0
  )

  return isValidDate(parsed) ? parsed : null
}

export function isoToLocalDateTimeValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (!isValidDate(parsed)) return ''
  return formatLocalDateTimeValue(parsed)
}

export function localDateTimeValueToIso(value: string): string | null {
  const parsed = parseLocalDateTimeValue(value)
  return parsed ? parsed.toISOString() : null
}

export function normalizeTimeValue(value: string, fallback = '09:00'): string {
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return fallback

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback

  return `${pad(hour)}:${pad(minute)}`
}

export function roundMinuteToQuarter(minute: number): string {
  const safeMinute = Math.max(0, Math.min(59, minute))
  const quarter = Math.round(safeMinute / 15) * 15
  const normalized = quarter === 60 ? 45 : quarter
  return pad(normalized)
}

export function toTimePickerParts(value: string): TimePickerParts {
  const normalized = normalizeTimeValue(value)
  const [hour24, minute] = normalized.split(':').map(Number)
  const meridiem: Meridiem = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12

  return {
    hour12: String(hour12),
    minute: QUARTER_HOUR_MINUTES.includes(pad(minute) as typeof QUARTER_HOUR_MINUTES[number])
      ? pad(minute)
      : roundMinuteToQuarter(minute),
    meridiem
  }
}

export function fromTimePickerParts(parts: TimePickerParts): string {
  const hourValue = Math.max(1, Math.min(12, Number(parts.hour12) || 12))
  const minuteValue = QUARTER_HOUR_MINUTES.includes(parts.minute as typeof QUARTER_HOUR_MINUTES[number])
    ? parts.minute
    : '00'

  let hour24 = hourValue % 12
  if (parts.meridiem === 'PM') {
    hour24 += 12
  }

  return `${pad(hour24)}:${minuteValue}`
}

export function getTimeFromLocalDateTime(value: string, fallback = '09:00'): string {
  const parsed = parseLocalDateTimeValue(value)
  if (!parsed) return normalizeTimeValue(fallback, '09:00')
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function replaceDateInLocalDateTime(
  currentValue: string,
  date: Date,
  fallbackTime = '09:00'
): string {
  const timeValue = getTimeFromLocalDateTime(currentValue, fallbackTime)
  const [hour, minute] = timeValue.split(':').map(Number)
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  )
  return formatLocalDateTimeValue(next)
}

export function replaceTimeInLocalDateTime(
  currentValue: string,
  timeValue: string,
  fallbackDate = new Date()
): string {
  const safeTime = normalizeTimeValue(timeValue)
  const currentDate = parseLocalDateTimeValue(currentValue)
  const baseDate = currentDate ?? startOfDay(fallbackDate)
  const [hour, minute] = safeTime.split(':').map(Number)
  const next = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    0,
    0
  )
  return formatLocalDateTimeValue(next)
}

export function formatDatePickerLabel(value: string): string {
  const parsed = parseLocalDateTimeValue(value)
  if (!parsed) return 'Select a date'
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export function formatTimeLabel(value: string): string {
  const normalized = normalizeTimeValue(value)
  const [hour, minute] = normalized.split(':').map(Number)
  const date = new Date(2025, 0, 1, hour, minute)
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

export function buildCalendarDays(viewDate: Date, selectedValue: string): CalendarDayCell[] {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - monthStart.getDay())

  const selectedDate = parseLocalDateTimeValue(selectedValue)
  const today = startOfDay(new Date())
  const days: CalendarDayCell[] = []

  for (let i = 0; i < 42; i += 1) {
    const current = new Date(gridStart)
    current.setDate(gridStart.getDate() + i)

    days.push({
      key: formatLocalDateTimeValue(new Date(current.getFullYear(), current.getMonth(), current.getDate(), 12, 0, 0, 0)),
      date: current,
      dayOfMonth: current.getDate(),
      inMonth: current.getMonth() === viewDate.getMonth(),
      isToday: isSameDay(current, today),
      isSelected: selectedDate ? isSameDay(current, selectedDate) : false
    })
  }

  return days
}

export function shiftDate(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

export function shiftMonth(value: Date, months: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + months, 1)
}
