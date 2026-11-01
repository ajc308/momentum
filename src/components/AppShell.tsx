'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Check, Gauge, ListChecks, LogOut, RefreshCw, User, X } from 'lucide-react'
import { LogoMark, Wordmark } from './Logo'
import { cn } from '@/lib/utils'

type Toast = { id: number; kind: 'success' | 'error'; message: string }

interface ShellContextValue {
  /** Bumps after a sync that changed data, so pages refetch. */
  version: number
  syncing: boolean
  syncPeloton: () => Promise<void>
  notify: (kind: Toast['kind'], message: string) => void
}

const ShellContext = createContext<ShellContextValue>({
  version: 0, syncing: false, syncPeloton: async () => {}, notify: () => {},
})

export function useShell() {
  return useContext(ShellContext)
}

const TABS = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/workouts', label: 'Workouts', icon: ListChecks },
  { href: '/body', label: 'Body', icon: Activity },
]

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const [version, setVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToast = useRef(0)

  const dismiss = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), [])
  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++nextToast.current
    setToasts(list => [...list.slice(-2), { id, kind, message }])
    if (kind === 'success') setTimeout(() => dismiss(id), 6000)
  }, [dismiss])

  const syncPeloton = useCallback(async () => {
    setSyncing(true)
    try {
      // Ensure connected (auth first)
      const statusRes = await fetch('/api/peloton/sync')
      const statusData = await statusRes.json().catch(() => ({}))
      if (!statusData.connected) {
        const authRes = await fetch('/api/peloton/auth', { method: 'POST' })
        if (!authRes.ok) {
          const err = await authRes.json().catch(() => ({ error: 'Auth failed' }))
          notify('error', `Peloton auth failed: ${err.error || authRes.status}`)
          return
        }
      }
      const res = await fetch('/api/peloton/sync', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify('error', `Peloton sync failed: ${data.error || res.status}`)
        return
      }
      if (data.synced > 0 || data.updated > 0) setVersion(v => v + 1)
      const parts: string[] = []
      if (data.synced > 0) parts.push(`${data.synced} new`)
      if (data.updated > 0) parts.push(`${data.updated} updated`)
      if (data.skipped > 0) parts.push(`${data.skipped} already synced`)
      notify('success', `Peloton sync: ${parts.length > 0 ? parts.join(', ') : 'up to date'}`)
    } catch (error) {
      notify('error', `Peloton sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSyncing(false)
    }
  }, [notify])

  const value = useMemo(() => ({ version, syncing, syncPeloton, notify }), [version, syncing, syncPeloton, notify])

  // Sign-in and OAuth consent pages render without app chrome.
  if (pathname.startsWith('/login') || pathname.startsWith('/oauth')) return <>{children}</>

  return (
    <ShellContext.Provider value={value}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-volt focus:px-4 focus:py-2 focus:text-fg">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-xl" aria-label="Momentum home">
            <LogoMark className="h-8 w-8 sm:h-9 sm:w-9" />
            <Wordmark className="text-base sm:text-lg" />
          </Link>

          <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
            {TABS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
                  isActive(pathname, href) ? 'bg-ink-800 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={syncPeloton}
              disabled={syncing}
              aria-label={syncing ? 'Syncing Peloton' : 'Sync Peloton'}
              className="btn-ghost h-9 px-3 sm:px-4"
            >
              <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync Peloton'}</span>
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-8 md:pb-16">
        {children}
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-ink-700/60 bg-ink-950/90 backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-3">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors',
                  active ? 'text-volt-ink' : 'text-fg-subtle hover:text-fg',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map(toast => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md animate-rise items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-card backdrop-blur-xl',
              toast.kind === 'success' ? 'border-volt/30 bg-ink-850/95 text-fg' : 'border-danger/40 bg-ink-850/95 text-fg',
            )}
          >
            {toast.kind === 'success'
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-volt-ink" aria-hidden="true" />
              : <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />}
            <span className="flex-1">{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss message" className="text-fg-subtle hover:text-fg">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ShellContext.Provider>
  )
}

function UserMenu() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (status === 'loading') return <div className="h-9 w-9 animate-pulse rounded-full bg-ink-800" />
  if (!session?.user) return null
  const user = session.user

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 transition hover:border-volt/60"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <User className="h-4 w-4 text-fg-muted" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 w-60 animate-rise rounded-2xl border border-ink-700 bg-ink-850 p-1.5 shadow-card">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-fg">{user.name || 'Signed in'}</p>
            {user.email && <p className="truncate text-xs text-fg-subtle">{user.email}</p>}
          </div>
          <div className="my-1 h-px bg-ink-700" />
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-fg-muted hover:bg-ink-800 hover:text-fg"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
