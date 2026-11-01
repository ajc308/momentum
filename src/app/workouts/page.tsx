import type { Metadata } from 'next'
import { WorkoutLog } from '@/components/workouts/WorkoutLog'

// See src/app/page.tsx for why this is force-dynamic.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Workouts · Momentum' }

export default function WorkoutsPage() {
  return <WorkoutLog />
}
