'use client'

import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { workoutCalendarDate, workoutDay } from '@/lib/calendar'
import { DISCIPLINES, disciplineOf, workoutTitle, type Discipline } from '@/lib/disciplines'
import { formatHours, formatNumber, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toWorkoutSession, useWorkouts } from '@/hooks/useFitnessData'
import type { WorkoutApiSession, WorkoutSession } from '@/types/workout'
import { useShell } from '../AppShell'
import { WorkoutForm } from '../WorkoutForm'
import { WorkoutRow } from '../WorkoutRow'
import { Dialog, Empty, LoadError, Skeleton } from '../ui'

const PAGE = 60

type NewWorkout = Omit<WorkoutSession, 'id'>

export function WorkoutLog() {
  const { notify } = useShell()
  const { data: workouts, setData: setWorkouts, error, loading, reload } = useWorkouts()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<Discipline | 'all'>('all')
  const [source, setSource] = useState('all')
  const [year, setYear] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<WorkoutSession | null>(null)

  const rows = useMemo(() => workouts ?? [], [workouts])
  const options = useMemo(() => ({
    types: (Object.keys(DISCIPLINES) as Discipline[]).filter(d => rows.some(w => disciplineOf(w) === d)),
    sources: [...new Set(rows.map(w => w.source))].sort(),
    years: [...new Set(rows.map(w => workoutDay(w.date).slice(0, 4)))].sort().reverse(),
  }), [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(w =>
      (type === 'all' || disciplineOf(w) === type) &&
      (source === 'all' || w.source === source) &&
      (year === 'all' || workoutDay(w.date).startsWith(year)) &&
      (!q || [workoutTitle(w), w.instructor, w.activity, w.notes].some(v => v?.toLowerCase().includes(q))))
  }, [rows, query, type, source, year])

  const totals = useMemo(() => ({
    minutes: filtered.reduce((sum, w) => sum + w.minutes, 0),
    calories: filtered.reduce((sum, w) => sum + (w.calories ?? 0), 0),
  }), [filtered])

  const months = useMemo(() => {
    const groups: { key: string; label: string; items: WorkoutSession[]; minutes: number }[] = []
    for (const w of filtered.slice(0, limit)) {
      const key = workoutDay(w.date).slice(0, 7)
      let group = groups[groups.length - 1]
      if (!group || group.key !== key) {
        group = { key, label: format(workoutCalendarDate(w.date), 'MMMM yyyy'), items: [], minutes: 0 }
        groups.push(group)
      }
      group.items.push(w)
      group.minutes += w.minutes
    }
    return groups
  }, [filtered, limit])

  const resetPaging = () => setLimit(PAGE)

  const addWorkout = async (session: NewWorkout, requestId?: string) => {
    const response = await fetch('/api/workouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(requestId ? { 'Idempotency-Key': requestId } : {}),
      },
      body: JSON.stringify({
        date: session.date.toISOString(),
        source: session.source,
        activity: session.activity,
        minutes: session.minutes,
        miles: session.miles,
        weightLifted: session.weightLifted,
        notes: session.notes,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `Failed to create workout: ${response.status}`)
    }
    const created = toWorkoutSession((await response.json()).workout as WorkoutApiSession)
    setWorkouts(prev => [created, ...(prev ?? []).filter(w => w.id !== created.id)]
      .sort((a, b) => b.date.getTime() - a.date.getTime()))
    setAdding(false)
    notify('success', `Logged ${workoutTitle(created)}`)
  }

  const updateWorkout = async (original: WorkoutSession, data: NewWorkout) => {
    // Keep the original timestamp (e.g. a Peloton start time) unless the day changed.
    const date = workoutDay(data.date) === workoutDay(original.date) ? original.date : data.date
    const response = await fetch('/api/workouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: original.id,
        date: date.toISOString(),
        source: data.source,
        activity: data.activity,
        minutes: data.minutes,
        miles: data.miles ?? null,
        weightLifted: data.weightLifted ?? null,
        notes: data.notes ?? null,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `Failed to update workout: ${response.status}`)
    }
    const updated = toWorkoutSession((await response.json()).workout as WorkoutApiSession)
    setWorkouts(prev => (prev ?? []).map(w => (w.id === updated.id ? updated : w))
      .sort((a, b) => b.date.getTime() - a.date.getTime()))
    setEditing(null)
    notify('success', 'Workout updated')
  }

  const deleteWorkout = async (workout: WorkoutSession) => {
    if (!confirm(`Delete “${workoutTitle(workout)}”?`)) return
    try {
      const response = await fetch(`/api/workouts?id=${encodeURIComponent(workout.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setWorkouts(prev => (prev ?? []).filter(w => w.id !== workout.id))
      notify('success', 'Workout deleted')
    } catch (err) {
      notify('error', `Failed to delete workout (${err instanceof Error ? err.message : 'unknown error'}). Please try again.`)
    }
  }

  const closeAdd = useCallback(() => setAdding(false), [])
  const closeEdit = useCallback(() => setEditing(null), [])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Training log</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Workouts</h1>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="btn-volt">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add workout
        </button>
      </div>

      {/* Filters */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search workouts</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={e => { setQuery(e.target.value); resetPaging() }}
              placeholder="Search classes, instructors, notes…"
              className="field pl-9"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <label>
              <span className="sr-only">Source</span>
              <select value={source} onChange={e => { setSource(e.target.value); resetPaging() }} className="field sm:w-40">
                <option value="all">All sources</option>
                {options.sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Year</span>
              <select value={year} onChange={e => { setYear(e.target.value); resetPaging() }} className="field sm:w-32">
                <option value="all">All years</option>
                {options.years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div role="group" aria-label="Workout type" className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1">
          {(['all', ...options.types] as const).map(t => {
            const active = type === t
            const color = t === 'all' ? '#111317' : DISCIPLINES[t].color
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => { setType(t); resetPaging() }}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  active ? 'text-white' : 'border-ink-700 text-fg-muted hover:text-fg',
                )}
                style={active ? { backgroundColor: color, borderColor: color } : undefined}
              >
                {t === 'all' ? 'All' : DISCIPLINES[t].label}
              </button>
            )
          })}
        </div>
      </div>

      {error && !workouts ? (
        <LoadError message={error} onRetry={reload} />
      ) : loading && !workouts ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            <span className="font-semibold text-fg">{plural(filtered.length, 'workout')}</span>
            {' · '}{formatHours(totals.minutes)} h{totals.calories > 0 && ` · ${formatNumber(totals.calories)} kcal`}
          </p>
          {filtered.length === 0 ? (
            <Empty>{rows.length === 0 ? 'No workouts yet. Sync Peloton or add one.' : 'No workouts match these filters.'}</Empty>
          ) : (
            <div className="space-y-5">
              {months.map(month => (
                <section key={month.key} aria-labelledby={`month-${month.key}`} className="card p-2 sm:p-3">
                  <div className="flex items-baseline justify-between px-2 pb-1 pt-2 sm:px-3">
                    <h2 id={`month-${month.key}`} className="font-display text-base font-bold">{month.label}</h2>
                    <p className="text-xs text-fg-subtle">{plural(month.items.length, 'session')} · {formatHours(month.minutes)} h</p>
                  </div>
                  <ul>
                    {month.items.map(w => (
                      <li key={w.id}>
                        <WorkoutRow
                          workout={w}
                          actions={
                            <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row sm:opacity-60 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <button type="button" onClick={() => setEditing(w)} aria-label={`Edit ${workoutTitle(w)}`} className="icon-btn h-8 w-8">
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => deleteWorkout(w)} aria-label={`Delete ${workoutTitle(w)}`} className="icon-btn h-8 w-8 hover:text-danger">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {filtered.length > limit && (
                <div className="flex justify-center">
                  <button type="button" onClick={() => setLimit(l => l + PAGE)} className="btn-ghost">
                    Show more ({formatNumber(filtered.length - limit)} left)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {adding && (
        <Dialog title="Add workout" onClose={closeAdd}>
          <WorkoutForm onSubmit={addWorkout} />
        </Dialog>
      )}
      {editing && (
        <Dialog title="Edit workout" onClose={closeEdit}>
          {editing.classTitle && <p className="-mt-3 mb-4 text-sm text-fg-muted">{editing.classTitle}</p>}
          <WorkoutForm initial={editing} submitLabel="Save changes" onSubmit={data => updateWorkout(editing, data)} />
        </Dialog>
      )}
    </div>
  )
}
