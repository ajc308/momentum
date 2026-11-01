'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { civilDate } from '@/lib/calendar'
import { DISCIPLINES, disciplineOf, workoutTitle } from '@/lib/disciplines'
import { formatMinutes, plural } from '@/lib/format'
import { groupByDay, shiftDay, weekStart } from '@/lib/training'
import { cn } from '@/lib/utils'
import type { WorkoutSession } from '@/types/workout'
import { Section } from '../ui'

const WEEKS = 53
const LEVELS = [
  { min: 0, label: 'Rest', style: { backgroundColor: '#E9ECE3' } },
  { min: 1, label: 'Under 20 min', style: { backgroundColor: '#DDF3A0' } },
  { min: 20, label: '20–39 min', style: { backgroundColor: '#B6E052' } },
  { min: 40, label: '40–59 min', style: { backgroundColor: '#84BC1C' } },
  { min: 60, label: '60+ min', style: { backgroundColor: '#4F7F07' } },
]

function level(minutes: number) {
  let result = LEVELS[0]
  for (const l of LEVELS) if (minutes >= l.min) result = l
  return result
}

export function TrainingHeatmap({ workouts, today }: { workouts: WorkoutSession[]; today: string }) {
  const byDay = useMemo(() => groupByDay(workouts), [workouts])
  const start = useMemo(() => shiftDay(weekStart(today), -7 * (WEEKS - 1)), [today])
  const columns = useMemo(() => Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => shiftDay(start, w * 7 + d))), [start])

  const [selected, setSelected] = useState(today)
  const scroller = useRef<HTMLDivElement>(null)
  const cells = useRef(new Map<string, HTMLButtonElement>())

  // Start scrolled to the most recent weeks on narrow screens.
  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [])

  const summary = useMemo(() => {
    let sessions = 0, minutes = 0, days = 0
    for (const [day, list] of byDay) {
      if (day < start || day > today) continue
      days++
      sessions += list.length
      minutes += list.reduce((sum, w) => sum + w.minutes, 0)
    }
    return { sessions, minutes, days }
  }, [byDay, start, today])

  const move = (day: string, delta: number) => {
    const target = shiftDay(day, delta)
    if (target < start || target > today) return
    setSelected(target)
    cells.current.get(target)?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, day: string) => {
    const deltas: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
    if (event.key in deltas) {
      event.preventDefault()
      move(day, deltas[event.key])
    }
  }

  const selectedItems = byDay.get(selected) ?? []
  const selectedMinutes = selectedItems.reduce((sum, w) => sum + w.minutes, 0)

  return (
    <Section
      id="heatmap"
      title="Training calendar"
      eyebrow="Last 12 months"
      action={<p className="text-right text-xs text-fg-subtle"><span className="stat-num text-base text-fg">{summary.days}</span> active days</p>}
    >
      <div ref={scroller} className="scrollbar-none -mx-1 overflow-x-auto px-1 pb-1">
        <div
          role="group"
          aria-label="Workout minutes per day. Use arrow keys to move between days."
          className="grid min-w-[44rem] gap-[3px]"
          style={{ gridTemplateColumns: `1.75rem repeat(${WEEKS}, minmax(0, 1fr))` }}
        >
          {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((label, d) => (
            <span key={d} aria-hidden="true" className="flex items-center text-[10px] text-fg-subtle" style={{ gridColumn: 1, gridRow: d + 2 }}>
              {label}
            </span>
          ))}
          {columns.map((week, w) => {
            const monthStart = week.find(day => day.endsWith('-01'))
            const nextHasMonth = columns.slice(w + 1, w + 3).some(col => col.some(day => day.endsWith('-01')))
            const showMonth = monthStart || (w === 0 && !nextHasMonth)
            return [
              <span key={`m-${week[0]}`} aria-hidden="true" className="h-4 whitespace-nowrap text-[10px] leading-4 text-fg-subtle" style={{ gridColumn: w + 2, gridRow: 1 }}>
                {showMonth ? format(civilDate(monthStart ?? week[0]), 'MMM') : ''}
              </span>,
              ...week.map((day, d) => {
                const place = { gridColumn: w + 2, gridRow: d + 2 }
                if (day > today) return <span key={day} aria-hidden="true" style={place} />
                const list = byDay.get(day) ?? []
                const minutes = list.reduce((sum, item) => sum + item.minutes, 0)
                const lvl = level(minutes)
                const isSelected = day === selected
                const names = list.map(workoutTitle).join(', ')
                return (
                  <button
                    key={day}
                    ref={node => { if (node) cells.current.set(day, node); else cells.current.delete(day) }}
                    type="button"
                    tabIndex={isSelected ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-label={`${format(civilDate(day), 'EEE, MMM d, yyyy')}: ${list.length ? `${formatMinutes(minutes)}, ${names}` : 'rest day'}`}
                    title={`${format(civilDate(day), 'EEE, MMM d')} · ${list.length ? `${formatMinutes(minutes)} · ${names}` : 'Rest'}`}
                    onClick={() => setSelected(day)}
                    onKeyDown={event => onKeyDown(event, day)}
                    className={cn(
                      'aspect-square w-full rounded-[3px] transition-transform hover:scale-125 focus-visible:scale-125',
                      isSelected && 'ring-2 ring-fg ring-offset-1 ring-offset-ink-900',
                      day === today && !isSelected && 'ring-1 ring-volt/70',
                    )}
                    style={{ ...lvl.style, ...place }}
                  />
                )
              }),
            ]
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-fg-subtle">
        <p>{plural(summary.sessions, 'session')} · {formatMinutes(summary.minutes)} this past year</p>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span>Less</span>
          {LEVELS.map(l => <span key={l.min} title={l.label} className="h-3 w-3 rounded-[3px]" style={l.style} />)}
          <span>More</span>
        </div>
      </div>

      {/* Selected day detail */}
      <div className="mt-4 rounded-2xl border border-ink-700/70 bg-ink-850/60 p-4" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold">{selected === today ? 'Today' : format(civilDate(selected), 'EEEE, MMMM d, yyyy')}</p>
          <p className="text-xs text-fg-subtle">{selectedItems.length ? formatMinutes(selectedMinutes) : 'Rest day'}</p>
        </div>
        {selectedItems.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {selectedItems.map(w => (
              <li key={w.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DISCIPLINES[disciplineOf(w)].color }} />
                <span className="min-w-0 flex-1 truncate">{workoutTitle(w)}</span>
                {w.instructor && <span className="hidden text-xs text-fg-subtle sm:inline">{w.instructor}</span>}
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatMinutes(w.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
