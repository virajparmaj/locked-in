import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildCalendarDays,
  formatDatePickerLabel,
  parseLocalDateTimeValue,
  replaceDateInLocalDateTime,
  shiftDate,
  shiftMonth
} from '@/lib/schedule-picker'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface DatePickerPopoverProps {
  value: string
  onChange: (value: string) => void
  id?: string
  className?: string
}

function formatMonthHeading(value: Date): string {
  return value.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function DatePickerPopover({ value, onChange, id, className }: DatePickerPopoverProps) {
  const selectedDate = parseLocalDateTimeValue(value)
  const initialView = selectedDate ?? new Date()
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(new Date(initialView.getFullYear(), initialView.getMonth(), 1))
  const [focusedDate, setFocusedDate] = useState(selectedDate ?? new Date())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const nextSelected = parseLocalDateTimeValue(value) ?? new Date()
    setViewDate(new Date(nextSelected.getFullYear(), nextSelected.getMonth(), 1))
    setFocusedDate(nextSelected)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    dayRefs.current[dateKey(focusedDate)]?.focus()
  }, [focusedDate, open])

  const days = useMemo(() => buildCalendarDays(viewDate, value), [viewDate, value])

  function selectDate(date: Date) {
    onChange(replaceDateInLocalDateTime(value, date))
    setOpen(false)
  }

  function setQuickDate(offsetDays: number) {
    const base = new Date()
    base.setDate(base.getDate() + offsetDays)
    selectDate(base)
  }

  function moveFocus(daysToShift: number) {
    const next = shiftDate(focusedDate, daysToShift)
    setFocusedDate(next)
    setViewDate(new Date(next.getFullYear(), next.getMonth(), 1))
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="flex items-stretch gap-2">
        <div
          id={id}
          className="flex h-12 flex-1 items-center rounded-2xl border border-border/70 bg-card/70 px-4 text-base shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]"
          aria-live="polite"
        >
          <span className={selectedDate ? 'text-foreground' : 'text-muted-foreground'}>
            {formatDatePickerLabel(value)}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-2xl border-border/70 bg-card/70 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]"
          onClick={() => setOpen((current) => !current)}
          aria-label="Open calendar"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <CalendarDays className="h-4 w-4" />
        </Button>
      </div>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+0.75rem)] z-50 w-[22rem] rounded-2xl border border-border/80 bg-background p-4 shadow-2xl"
          role="dialog"
          aria-label="Choose a date"
        >
          <div className="mb-4 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" onClick={() => setViewDate((current) => shiftMonth(current, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">{formatMonthHeading(viewDate)}</div>
            <Button type="button" variant="ghost" size="icon" onClick={() => setViewDate((current) => shiftMonth(current, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-1 py-2 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const active = day.isSelected
              const focused = dateKey(day.date) === dateKey(focusedDate)

              return (
                <button
                  key={day.key}
                  ref={(node) => { dayRefs.current[dateKey(day.date)] = node }}
                  type="button"
                  onClick={() => selectDate(day.date)}
                  onFocus={() => setFocusedDate(day.date)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      moveFocus(1)
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault()
                      moveFocus(-1)
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveFocus(7)
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveFocus(-7)
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      selectDate(day.date)
                    }
                  }}
                  className={cn(
                    'h-10 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : day.inMonth
                        ? 'text-foreground hover:bg-accent'
                        : 'text-muted-foreground/60 hover:bg-accent/50',
                    day.isToday && !active && 'border border-primary/50',
                    focused && !active && 'bg-accent'
                  )}
                  aria-pressed={active}
                  aria-label={day.date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                >
                  {day.dayOfMonth}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setQuickDate(0)}>Today</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setQuickDate(1)}>Tomorrow</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  )
}
