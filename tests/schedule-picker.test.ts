import { describe, expect, it } from 'vitest'
import {
  buildCalendarDays,
  formatLocalDateTimeValue,
  fromTimePickerParts,
  getTimeFromLocalDateTime,
  localDateTimeValueToIso,
  normalizeTimeValue,
  parseLocalDateTimeValue,
  replaceDateInLocalDateTime,
  replaceTimeInLocalDateTime,
  toTimePickerParts
} from '../src/lib/schedule-picker'

describe('schedule picker helpers', () => {
  it('normalizes time values to zero-padded HH:mm', () => {
    expect(normalizeTimeValue('7:5')).toBe('07:05')
    expect(normalizeTimeValue('23:59')).toBe('23:59')
  })

  it('falls back to default time for invalid input', () => {
    expect(normalizeTimeValue('nope')).toBe('09:00')
    expect(normalizeTimeValue('99:99', '12:30')).toBe('12:30')
  })

  it('preserves the time when changing just the selected date', () => {
    const next = replaceDateInLocalDateTime('2026-03-24T14:45', new Date(2026, 3, 10))
    expect(next).toBe('2026-04-10T14:45')
  })

  it('preserves the date when changing just the selected time', () => {
    const next = replaceTimeInLocalDateTime('2026-03-24T14:45', '07:05')
    expect(next).toBe('2026-03-24T07:05')
  })

  it('parses and formats local datetime values consistently', () => {
    const parsed = parseLocalDateTimeValue('2026-03-24T09:30')
    expect(parsed).not.toBeNull()
    expect(formatLocalDateTimeValue(parsed as Date)).toBe('2026-03-24T09:30')
    expect(getTimeFromLocalDateTime('2026-03-24T09:30')).toBe('09:30')
  })

  it('converts 12-hour time picker parts to 24-hour values', () => {
    expect(fromTimePickerParts({ hour12: '12', minute: '00', meridiem: 'AM' })).toBe('00:00')
    expect(fromTimePickerParts({ hour12: '12', minute: '00', meridiem: 'PM' })).toBe('12:00')
    expect(fromTimePickerParts({ hour12: '1', minute: '15', meridiem: 'PM' })).toBe('13:15')
  })

  it('round-trips 24-hour values into 12-hour picker parts', () => {
    expect(toTimePickerParts('00:00')).toEqual({ hour12: '12', minute: '00', meridiem: 'AM' })
    expect(toTimePickerParts('12:00')).toEqual({ hour12: '12', minute: '00', meridiem: 'PM' })
    expect(toTimePickerParts('13:15')).toEqual({ hour12: '1', minute: '15', meridiem: 'PM' })
  })

  it('snaps legacy minute values to the nearest quarter-hour for picker display', () => {
    expect(toTimePickerParts('09:07')).toEqual({ hour12: '9', minute: '00', meridiem: 'AM' })
    expect(toTimePickerParts('09:38')).toEqual({ hour12: '9', minute: '45', meridiem: 'AM' })
  })

  it('converts local datetime values to ISO strings', () => {
    const iso = localDateTimeValueToIso('2026-03-24T09:30')
    expect(iso).not.toBeNull()
    expect(new Date(iso as string).toISOString()).toBe(iso)
  })

  it('builds a six-week calendar grid with selected state', () => {
    const view = new Date(2026, 2, 1)
    const days = buildCalendarDays(view, '2026-03-24T09:30')

    expect(days).toHaveLength(42)
    expect(days.filter((day) => day.inMonth)).toHaveLength(31)
    expect(days.some((day) => day.isSelected && day.dayOfMonth === 24)).toBe(true)
  })
})
