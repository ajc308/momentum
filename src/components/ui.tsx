'use client'

import { useEffect, useRef } from 'react'
import { Activity, Bike, Dumbbell, Flame, Footprints, Sparkles, Watch, X, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DISCIPLINES, disciplineOf, type Discipline, type DisciplineInput } from '@/lib/disciplines'

export const DISCIPLINE_ICONS: Record<Discipline, LucideIcon> = {
  strength: Dumbbell, cycling: Bike, walk: Footprints, run: Zap, cardio: Flame, stretch: Sparkles, other: Activity,
}

export function Section({
  title, eyebrow, action, children, className, id,
}: {
  title: string
  eyebrow?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  id?: string
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section aria-labelledby={headingId} className={cn('card animate-rise p-5 sm:p-6', className)}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 id={headingId} className="font-display text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-ink-800/80', className)} aria-hidden="true" />
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="btn-ghost h-8 px-3 text-xs">Retry</button>}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-fg-subtle">{children}</p>
}

export function DisciplineIcon({ workout, size = 'md' }: { workout: DisciplineInput; size?: 'sm' | 'md' }) {
  const discipline = disciplineOf(workout)
  const Icon = DISCIPLINE_ICONS[discipline]
  const { color, label } = DISCIPLINES[discipline]
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-2xl', size === 'md' ? 'h-11 w-11' : 'h-8 w-8 rounded-xl')}
      style={{ backgroundColor: `${color}1F`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
      title={label}
    >
      <Icon className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
    </span>
  )
}

export function DisciplineTag({ workout }: { workout: DisciplineInput }) {
  const { color, label } = DISCIPLINES[disciplineOf(workout)]
  return (
    <span className="chip" style={{ backgroundColor: `${color}1A`, color }}>
      {label}
    </span>
  )
}

export function SourceBadge({ source }: { source: string }) {
  if (source === 'Peloton') {
    return <span className="chip bg-ink-800 text-fg-muted ring-1 ring-inset ring-ink-600">Peloton</span>
  }
  if (source === 'Apple Watch') {
    return (
      <span className="chip bg-ink-800 text-fg-muted ring-1 ring-inset ring-ink-600">
        <Watch className="h-3 w-3" aria-hidden="true" /> Watch
      </span>
    )
  }
  return <span className="chip bg-ink-800 text-fg-subtle ring-1 ring-inset ring-ink-700">{source}</span>
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-ink-700 bg-ink-850 p-0.5">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
            value === option.value ? 'bg-fg text-white' : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Modal dialog with focus trap, Escape to close and a backdrop. Sheet-style on phones. */
export function Dialog({
  title, onClose, children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])

  useEffect(() => {
    const node = panel.current
    if (!node) return
    const previous = document.activeElement as HTMLElement | null
    node.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return }
      if (e.key !== 'Tab') return
      const focusable = node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-3xl border border-ink-700 bg-ink-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-card outline-none sm:rounded-3xl sm:p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="dialog-title" className="font-display text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="icon-btn">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
