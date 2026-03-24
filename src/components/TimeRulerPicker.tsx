import type { ReactNode } from 'react'
import { ChevronDown, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
  QUARTER_HOUR_MINUTES,
  formatTimeLabel,
  fromTimePickerParts,
  toTimePickerParts,
  type Meridiem
} from '@/lib/schedule-picker'

interface TimeRulerPickerProps {
  value: string
  onChange: (value: string) => void
  id?: string
  className?: string
}

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const MERIDIEMS: Meridiem[] = ['AM', 'PM']
const QUICK_TIMES = [
  { value: '09:00', label: '9 AM' },
  { value: '12:00', label: '12 PM' },
  { value: '15:00', label: '3 PM' },
  { value: '18:00', label: '6 PM' }
] as const

function PickerSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</Label>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-xl border border-border/70 bg-background/80 px-3 pr-10 text-base font-medium tabular-nums text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  )
}

export function TimeRulerPicker({ value, onChange, id, className }: TimeRulerPickerProps) {
  const parts = toTimePickerParts(value)
  const safeValue = fromTimePickerParts(parts)

  function updatePart(key: 'hour12' | 'minute' | 'meridiem', nextValue: string) {
    onChange(fromTimePickerParts({
      ...parts,
      [key]: nextValue
    }))
  }

  return (
    <div
      id={id}
      className={cn(
        'rounded-2xl border border-border/70 bg-card/70 px-3 py-3 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]',
        className
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Clock3 className="h-4 w-4" />
        <span className="font-medium tabular-nums">{formatTimeLabel(safeValue)}</span>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        {QUICK_TIMES.map((time) => {
          const active = safeValue === time.value
          return (
            <Button
              key={time.value}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              className={cn(
                'h-9 rounded-xl px-2 text-xs font-medium tabular-nums',
                !active && 'border-border/70 bg-background/60'
              )}
              onClick={() => onChange(time.value)}
            >
              {time.label}
            </Button>
          )
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_92px] gap-2">
        <PickerSelect label="Hour" value={parts.hour12} onChange={(nextValue) => updatePart('hour12', nextValue)}>
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>{hour}</option>
          ))}
        </PickerSelect>

        <PickerSelect label="Minute" value={parts.minute} onChange={(nextValue) => updatePart('minute', nextValue)}>
          {QUARTER_HOUR_MINUTES.map((minute) => (
            <option key={minute} value={minute}>{minute}</option>
          ))}
        </PickerSelect>

        <PickerSelect label="AM/PM" value={parts.meridiem} onChange={(nextValue) => updatePart('meridiem', nextValue)}>
          {MERIDIEMS.map((meridiem) => (
            <option key={meridiem} value={meridiem}>{meridiem}</option>
          ))}
        </PickerSelect>
      </div>
    </div>
  )
}
