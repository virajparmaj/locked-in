import { useState, useMemo } from 'react'
import { useScheduleContext } from '@/contexts/ScheduleContext'
import { useContactContext } from '@/contexts/ContactContext'
import { useReminderContext } from '@/contexts/ReminderContext'
import { ScheduleModal } from '@/components/ScheduleModal'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, formatScheduleType } from '@/lib/utils'
import type { CreateScheduleInput } from '../../shared/types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarPage() {
  const { schedules, fireTimes, create } = useScheduleContext()
  const { contacts } = useContactContext()
  const { reminders } = useReminderContext()
  const { toast } = useToast()

  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const today = new Date()
  const firstDay = new Date(year, month, 1)
  const startDay = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Map dates to events
  const dateEvents = useMemo(() => {
    const map = new Map<string, { schedules: string[]; reminders: string[] }>()

    for (const s of schedules) {
      const nextFire = fireTimes[s.id]
      if (!nextFire) continue
      const d = new Date(nextFire)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = String(d.getDate())
        if (!map.has(key)) map.set(key, { schedules: [], reminders: [] })
        map.get(key)!.schedules.push(s.contactName || formatScheduleType(s.scheduleType))
      }
    }

    for (const r of reminders) {
      if (!r.enabled) continue
      const d = new Date(r.nextReminderAt)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = String(d.getDate())
        if (!map.has(key)) map.set(key, { schedules: [], reminders: [] })
        map.get(key)!.reminders.push(r.contactName)
      }
    }

    return map
  }, [schedules, fireTimes, reminders, year, month])

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  function handleDayClick(day: number) {
    setSelectedDate(new Date(year, month, day))
    setModalOpen(true)
  }

  async function handleSubmit(data: CreateScheduleInput) {
    await create(data)
    toast({ title: 'Schedule created' })
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Calendar</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-36 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px border rounded-lg overflow-hidden">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={i} className="h-24 bg-muted/20" />
          }
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          const events = dateEvents.get(String(day))
          return (
            <button
              key={i}
              onClick={() => handleDayClick(day)}
              className={cn(
                'h-24 p-1.5 text-left bg-card hover:bg-accent/50 transition-colors flex flex-col',
                isToday && 'ring-2 ring-primary ring-inset'
              )}
            >
              <span className={cn(
                'text-xs font-medium',
                isToday ? 'text-primary font-bold' : 'text-foreground'
              )}>
                {day}
              </span>
              {events && (
                <div className="mt-1 space-y-0.5 overflow-hidden flex-1">
                  {events.schedules.slice(0, 2).map((name, j) => (
                    <Badge key={`s-${j}`} variant="default" className="text-[9px] px-1 py-0 block truncate">
                      {name}
                    </Badge>
                  ))}
                  {events.reminders.slice(0, 2).map((name, j) => (
                    <Badge key={`r-${j}`} variant="warning" className="text-[9px] px-1 py-0 block truncate">
                      {name}
                    </Badge>
                  ))}
                  {(events.schedules.length + events.reminders.length) > 4 && (
                    <span className="text-[9px] text-muted-foreground">
                      +{events.schedules.length + events.reminders.length - 4} more
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary" />
          Scheduled messages
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          Reminders
        </div>
      </div>

      <ScheduleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contacts={contacts}
        onSubmit={handleSubmit}
        defaultDate={selectedDate || undefined}
      />
    </div>
  )
}
