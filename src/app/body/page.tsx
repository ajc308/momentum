import type { Metadata } from 'next'
import { BodyDashboard } from '@/components/body/BodyDashboard'

// See src/app/page.tsx for why this is force-dynamic.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Body · Momentum' }

export default function BodyPage() {
  return <BodyDashboard />
}
