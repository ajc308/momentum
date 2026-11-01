'use client'

import { useMemo, useState } from 'react'
import { isStrength } from '@/lib/disciplines'
import { formatNumber } from '@/lib/format'
import { muscleGroupStats, type MuscleGroupStat } from '@/lib/muscle-groups'
import { cn } from '@/lib/utils'
import type { WorkoutSession } from '@/types/workout'
import { Empty, Section, Segmented } from '../ui'

const WEEKS = 8

function daysLabel(days: number | null) {
  if (days == null) return 'Not in history'
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

/** Fresh (<=3 days), due (4-7), overdue (8+). */
function freshness(days: number | null) {
  if (days == null || days >= 8) return { tone: 'text-discipline-strength', dot: 'bg-discipline-strength', label: 'Overdue' }
  if (days >= 4) return { tone: 'text-discipline-walk', dot: 'bg-discipline-walk', label: 'Due' }
  return { tone: 'text-volt-ink', dot: 'bg-volt', label: 'Fresh' }
}

export function StrengthFocus({ workouts, today }: { workouts: WorkoutSession[]; today: string }) {
  const [range, setRange] = useState<'30' | '90'>('30')
  const stats = useMemo(() => muscleGroupStats(workouts, today, WEEKS), [workouts, today])
  const hasStrength = useMemo(() => workouts.some(isStrength), [workouts])
  const count = (s: MuscleGroupStat) => (range === '30' ? s.count30 : s.count90)
  const maxCount = Math.max(1, ...stats.map(count))
  const maxWeekly = Math.max(1, ...stats.flatMap(s => s.weekly))

  return (
    <Section
      id="strength"
      title="Strength focus"
      eyebrow="Muscle groups from your class titles"
      action={<Segmented label="Window" value={range} onChange={setRange} options={[{ value: '30', label: '30d' }, { value: '90', label: '90d' }]} />}
    >
      {!hasStrength ? (
        <Empty>No strength classes yet. Once Peloton strength classes sync, this shows which muscles are due.</Empty>
      ) : (
        <>
          {/* Per-group recency, rhythm and balance */}
          <div className="mb-2 hidden grid-cols-[7.5rem_1fr_6.5rem_5rem] gap-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle sm:grid">
            <span>Group</span>
            <span>Last {WEEKS} weeks + this week</span>
            <span className="text-right">Rhythm</span>
            <span className="text-right">{range} days</span>
          </div>
          <ul className="space-y-1.5">
            {stats.map(s => {
              const fresh = freshness(s.daysSince)
              return (
                <li key={s.group} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-2xl bg-ink-850/60 px-3 py-2.5 sm:grid-cols-[7.5rem_1fr_6.5rem_5rem] sm:px-1 sm:py-2 sm:bg-transparent">
                  <div className="min-w-0 sm:pl-2">
                    <p className="truncate text-sm font-semibold">{s.label}</p>
                    <p className={cn('flex items-center gap-1.5 text-xs', fresh.tone)}>
                      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', fresh.dot)} />
                      {daysLabel(s.daysSince)}
                      <span className="sr-only">({fresh.label})</span>
                    </p>
                  </div>
                  {/* Weekly rhythm bars */}
                  <div className="order-3 col-span-2 flex h-6 items-end sm:h-8 gap-1 sm:order-none sm:col-span-1" aria-hidden="true">
                    {s.weekly.map((n, i) => {
                      const current = i === s.weekly.length - 1
                      return (
                        <span
                          key={i}
                          className={cn('flex-1 rounded-sm', current ? 'bg-volt' : 'bg-discipline-strength', n === 0 && 'bg-ink-700')}
                          style={{ height: n === 0 ? 3 : `${Math.max(20, (n / maxWeekly) * 100)}%`, opacity: n === 0 ? 1 : current ? 0.95 : 0.4 + 0.6 * (n / maxWeekly) }}
                        />
                      )
                    })}
                  </div>
                  <p className="text-right text-sm sm:order-none">
                    <span className="stat-num text-base">{formatNumber(s.perWeek, 1)}</span>
                    <span className="text-xs text-fg-subtle">/wk</span>
                  </p>
                  <div className="hidden items-center justify-end gap-2 sm:flex">
                    <span className="h-1.5 w-10 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
                      <span className="block h-full rounded-full bg-discipline-strength" style={{ width: `${(count(s) / maxCount) * 100}%` }} />
                    </span>
                    <span className="stat-num w-6 text-right text-sm">{count(s)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-fg-subtle">
            Rhythm is the average sessions per week over the last {WEEKS} full weeks; the bright bar is this week.
            Full-body classes count toward rhythm and totals; days since only counts classes that name the group. Your 7-day plan builds on this.{' '}
            <span className="sm:hidden">
              {range}-day sessions: {stats.map(s => `${s.label} ${count(s)}`).join(', ')}.
            </span>
          </p>
        </>
      )}
    </Section>
  )
}
