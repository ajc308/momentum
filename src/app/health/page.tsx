import { redirect } from 'next/navigation'

// The Health page became Body; keep old links and bookmarks working.
export const dynamic = 'force-dynamic'

export default function HealthPage() {
  redirect('/body')
}
