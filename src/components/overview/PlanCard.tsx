'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Check, Dumbbell, Footprints, ListPlus, Moon, RefreshCcw } from 'lucide-react'
import { civilDate } from '@/lib/calendar'
import { buildPlan, type ClassSuggestion, type PlanDay, type TrainingPlan } from '@/lib/planner'
import { cn } from '@/lib/utils'
import type { WorkoutSession } from '@/types/workout'
import { useShell } from '../AppShell'
import { Section } from '../ui'

const STYLES: Record<PlanDay['status'], { icon: typeof Dumbbell; badge: string; chip: string }> = {
  done: { icon: Check, badge: 'bg-volt text-fg', chip: 'bg-volt/30 text-volt-ink' },
  strength: { icon: Dumbbell, badge: 'bg-discipline-strength text-white', chip: 'bg-discipline-strength/10 text-discipline-strength' },
  walk: { icon: Footprints, badge: 'bg-discipline-walk text-white', chip: 'bg-discipline-walk/10 text-discipline-walk' },
  rest: { icon: Moon, badge: 'bg-ink-800 text-fg-muted', chip: 'bg-ink-800 text-fg-muted' },
}

/** "20 min Glutes & Legs Strength" -> "20 min Glutes & Legs" (the card already says it's strength). */
function shortTitle(title: string) {
  return title.replace(/\s+Strength$/i, '')
}

function Suggestion({ s, first }: { s: ClassSuggestion; first: boolean }) {
  const label = <>{first ? '' : '+ '}{shortTitle(s.title)}</>
  return (
    <li className="break-words text-xs leading-snug" title={`${s.title}${s.instructor ? ` · ${s.instructor}` : ''}`}>
      {s.url
        ? <a href={s.url} target="_blank" rel="noreferrer" className={cn('hover:underline', first ? 'font-semibold text-fg' : 'text-fg-muted')}>{label}</a>
        : <span className={first ? 'font-semibold text-fg' : 'text-fg-muted'}>{label}</span>}
      {s.instructor && <span className="block text-[11px] text-fg-subtle">{s.instructor}</span>}
    </li>
  )
}

function StackButton({ day }: { day: string }) {
  const { notify } = useShell()
  const [busy, setBusy] = useState(false)
  const stack = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/peloton/stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { notify('error', data.error ?? `Couldn't stack (HTTP ${res.status})`); return }
      const added = data.added?.length ?? 0
      const already = data.alreadyStacked?.length ?? 0
      notify('success', added
        ? `Added ${added} ${added === 1 ? 'class' : 'classes'} to your Peloton stack${already ? ` (${already} already there)` : ''}.`
        : 'Already in your Peloton stack.')
    } catch (error) {
      notify('error', `Couldn't stack: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={stack} disabled={busy}
      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-fg transition hover:border-fg/40 disabled:opacity-50">
      <ListPlus className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Stacking…' : 'Stack on Peloton'}
    </button>
  )
}

/** Server plan with classes from Peloton's library; null until loaded or if it fails. */
function useCatalogPlan(today: string, workoutCount: number) {
  const [plan, setPlan] = useState<TrainingPlan | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/plan', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data?.today === today) setPlan(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [today, workoutCount])
  return plan
}

/** The next 7 days, rebuilt from history on every load so missed days roll forward. */
export function PlanCard({ workouts, today }: { workouts: WorkoutSession[]; today: string }) {
  const localPlan = useMemo(() => buildPlan(workouts, today), [workouts, today])
  // Show the local plan instantly, then the same plan with real Peloton classes.
  const plan = useCatalogPlan(today, workouts.length) ?? localPlan

  return (
    <Section
      id="plan"
      eyebrow={`${plan.prefs.strengthDaysPerWeek} strength days · ~${plan.prefs.sessionMinutes} min · adapts when you miss a day`}
      title="Your next 7 days"
    >
      {plan.adapted && (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-discipline-walk/30 bg-discipline-walk/10 px-4 py-3 text-sm text-fg">
          <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0 text-discipline-walk" aria-hidden="true" />
          <span><span className="font-semibold">Plan adjusted.</span> {plan.adapted}</span>
        </p>
      )}
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {plan.days.map(day => {
          const style = STYLES[day.status]
          const Icon = style.icon
          const quiet = day.status === 'rest'
          return (
            <li
              key={day.day}
              title={day.reason}
              className={cn(
                'flex min-w-0 flex-col gap-2 rounded-2xl border p-3',
                day.isToday ? 'border-fg/70 bg-ink-900 shadow-card' : 'border-ink-700',
                quiet && !day.isToday ? 'bg-transparent' : !day.isToday && 'bg-ink-850/60',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', style.badge)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-fg-subtle">
                  {day.isToday ? 'Today' : format(civilDate(day.day), 'EEE')}
                  <span className="block font-medium normal-case tracking-normal">{format(civilDate(day.day), 'MMM d')}</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className={cn('font-display font-bold leading-tight', quiet ? 'text-sm text-fg-muted' : 'text-[15px]')}>{day.title}</p>
                {!quiet && <span className={cn('chip mt-1', style.chip)}>{day.detail}</span>}
              </div>
              {day.suggestions.length > 0 && (
                <ul className="space-y-0.5" aria-label="Suggested classes">
                  {day.suggestions.map((s, i) => <Suggestion key={s.title} s={s} first={i === 0} />)}
                </ul>
              )}
              {day.completed.length > 0 && (
                <ul className="space-y-0.5" aria-label="Completed today">
                  {day.completed.map((title, i) => (
                    <li key={`${title}-${i}`} className="flex items-start gap-1 text-xs leading-snug text-fg-muted" title={title}>
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-volt-ink" aria-hidden="true" />
                      <span className="break-words">{shortTitle(title)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {day.suggestions.some(s => s.rideId) && <StackButton day={day.day} />}
              <span className="sr-only">{day.reason}</span>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
