import { OverviewDashboard } from '@/components/overview/OverviewDashboard'

/**
 * Force this route to be rendered dynamically on every request rather
 * than statically prerendered. Without this, Next.js was serving a
 * cached HTML shell to anyone hitting `/`, including users without a
 * valid session — they would see the dashboard chrome, then the
 * client-side fetch('/api/workouts') would 401 and the UI would
 * render empty charts with no indication of "you are not logged in".
 *
 * Middleware redirects unauthenticated users to /login, but only when
 * Vercel actually invokes the function. Prerendered output bypasses
 * middleware. `force-dynamic` ensures the function runs every time so
 * middleware always gets a turn.
 */
export const dynamic = 'force-dynamic'

export default function Home() {
  return <OverviewDashboard />
}
