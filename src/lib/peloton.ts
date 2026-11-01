import { integrationFetch } from '@/lib/integration-fetch'
// Peloton API client (community-reverse-engineered, no official docs)
// Covers: Peloton classes (all disciplines) and outdoor workouts tracked in the Peloton app

import prisma from '@/lib/prisma'
import { encryptSecret } from '@/lib/crypto'

export const PELOTON_API_BASE = 'https://api.onepeloton.com'

interface PelotonAuthResponse {
  session_id: string
  user_id: string
  access_token?: string   // present when OAuth flow succeeds
  refresh_token?: string  // present when OAuth flow succeeds
  expires_in?: number     // seconds until access_token expires
}

interface PelotonWorkout {
  id: string
  fitness_discipline: string  // "cycling", "strength", "running", "outdoor", etc.
  name: string
  title: string
  start_time: number   // Unix timestamp
  end_time: number
  status: string       // "COMPLETE"
  metrics_type: string
  ride?: {
    title: string
    description: string
    duration: number  // seconds
    instructor?: {
      name: string
    }
  }
  overall_summary?: {
    distance?: number       // miles
    calories?: number
    total_output?: number   // kJ
    avg_cadence?: number
    avg_resistance?: number
    avg_speed?: number
    avg_heart_rate?: number
    max_heart_rate?: number
  }
  is_outdoor: boolean
}

interface PelotonWorkoutsResponse {
  data: PelotonWorkout[]
  total: number
  page: number
  limit: number
  count: number
  page_count: number
  sort_by: string
}

/**
 * Build auth headers that work for both OAuth Bearer tokens and legacy
 * session cookies.  If the sessionId contains dots it is likely a JWT /
 * OAuth access-token, so we send it as a Bearer token; otherwise we fall
 * back to the old `peloton_session_id` cookie.
 */
export function pelotonHeaders(sessionId: string): Record<string, string> {
  if (sessionId.includes('.')) {
    return {
      Authorization: `Bearer ${sessionId}`,
      'Content-Type': 'application/json',
    }
  }
  return {
    Cookie: `peloton_session_id=${sessionId}`,
    'Content-Type': 'application/json',
  }
}

export async function authenticatePeloton(
  email: string,
  password: string,
): Promise<PelotonAuthResponse> {
  // ── 1. Try OAuth2 token endpoint first ────────────────────────────
  try {
    const oauthRes = await integrationFetch('https://auth.onepeloton.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        client_id: 'mgsmWCD0A8Qn6uz6mmqI6qeBNHH9IPwS',
        username: email,
        password: password,
        // The members API audience/scope is what the GraphQL gateway needs
        // for Stack mutations (src/lib/peloton-stack.ts); REST sync works either way.
        audience: 'https://api.onepeloton.com/',
        scope: 'openid profile email peloton-api.members:default offline_access',
      }),
    })

    if (oauthRes.ok) {
      const oauthData = await oauthRes.json()

      // Use the access token to resolve the Peloton user-id
      const meRes = await integrationFetch(`${PELOTON_API_BASE}/api/me`, {
        headers: {
          Authorization: `Bearer ${oauthData.access_token}`,
        },
      })

      if (meRes.ok) {
        const me = await meRes.json()
        return {
          session_id: oauthData.access_token,  // treat access token as session
          user_id: me.id,
          access_token: oauthData.access_token,
          refresh_token: oauthData.refresh_token,
          expires_in: oauthData.expires_in,
        }
      }
    }
  } catch (err) {
    // OAuth endpoint unreachable / errored – fall through to legacy flow
    console.warn('Peloton OAuth attempt failed, trying legacy auth:', err)
  }

  // ── 2. Fallback: legacy session auth with mobile user-agent ───────
  const res = await integrationFetch(`${PELOTON_API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'peloton-iOS/36.0.0',
      'Peloton-Platform': 'iOS',
    },
    body: JSON.stringify({
      username_or_email: email,
      password: password,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Peloton auth failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function fetchPelotonWorkouts(
  sessionId: string,
  userId: string,
  page: number = 0,
  limit: number = 50,
): Promise<PelotonWorkoutsResponse> {
  const res = await integrationFetch(
    `${PELOTON_API_BASE}/api/user/${userId}/workouts?joins=ride,ride.instructor&limit=${limit}&page=${page}&sort_by=-created`,
    { headers: pelotonHeaders(sessionId) },
  )

  if (!res.ok) {
    throw new Error(`Peloton workouts fetch failed (${res.status})`)
  }

  return res.json()
}

export async function fetchPelotonWorkoutSummary(
  sessionId: string,
  workoutId: string,
): Promise<PelotonWorkout['overall_summary']> {
  // The old /summary endpoint now returns 404.
  // Use /performance_graph instead and extract metrics from the summaries array.
  const res = await integrationFetch(
    `${PELOTON_API_BASE}/api/workout/${workoutId}/performance_graph?every_n=900`,
    { headers: pelotonHeaders(sessionId) },
  )

  if (!res.ok) {
    throw new Error(`Peloton performance_graph fetch failed (${res.status})`)
  }

  const pg = await res.json()
  const summaries: Array<{ slug: string; value: number }> = pg.summaries ?? []
  // Heart rate (when a monitor was paired) is reported as a time-series
  // metric with its own average/max, not as a summary.
  const metrics: Array<{ slug: string; average_value?: number; max_value?: number }> = pg.metrics ?? []
  const heartRate = metrics.find(m => m.slug === 'heart_rate')

  const val = (slug: string) => summaries.find(s => s.slug === slug)?.value

  return {
    distance: val('distance'),
    calories: val('calories'),
    total_output: val('total_output'),
    avg_cadence: val('avg_cadence'),
    avg_resistance: val('avg_resistance'),
    avg_speed: val('avg_speed'),
    avg_heart_rate: heartRate?.average_value ?? val('avg_heart_rate'),
    max_heart_rate: heartRate?.max_value ?? val('max_heart_rate'),
  }
}

const roundOrNull = (n: number | undefined) => (n != null && Number.isFinite(n) ? Math.round(n) : null)

/**
 * Classes without an instructor (just rides, outdoor runs, free mode)
 * come back with the class title as the instructor name; drop those.
 */
function pelotonInstructor(workout: PelotonWorkout): string | null {
  const name = workout.ride?.instructor?.name?.trim()
  const title = (workout.ride?.title || workout.name || '').trim()
  return name && name.toLowerCase() !== title.toLowerCase() ? name : null
}

/**
 * The Peloton app imports Apple Watch workouts into Peloton history with
 * titles like "10 min 47 sec Outdoor Running" or "25 min Cardio: Surfing
 * Sports" and no instructor. Returns a clean title for those
 * ("Outdoor Running", "Surfing Sports"), or null for real Peloton
 * classes — including Peloton's own "Just Run" (instructor "JUST RUN")
 * and scenic rides ("30 min Snow Canyon Ride").
 */
export function appleWatchImportTitle(title: string | null | undefined, instructor: string | null): string | null {
  if (instructor) return null
  const match = /^\d+ min( \d+ sec)? (.+)$/.exec(title ?? '')
  if (!match) return null
  const [, seconds, rest] = match
  if (!seconds && !/^(Cardio: |Outdoor )/.test(rest)) return null
  const name = rest.replace(/^Cardio: /, '')
  return name === 'Other' ? 'Workout' : name
}

/** Peloton class details stored alongside each synced workout. */
export function pelotonClassDetails(workout: PelotonWorkout) {
  const summary = workout.overall_summary
  const instructor = pelotonInstructor(workout)
  const rawTitle = workout.ride?.title || workout.name || null
  return {
    discipline: workout.fitness_discipline || null,
    classTitle: appleWatchImportTitle(rawTitle, instructor) ?? rawTitle,
    instructor,
    calories: roundOrNull(summary?.calories),
    avgHeartRate: roundOrNull(summary?.avg_heart_rate),
    maxHeartRate: roundOrNull(summary?.max_heart_rate),
    totalOutputKj: roundOrNull(summary?.total_output),
  }
}

// Map Peloton fitness_discipline to our source/activity taxonomy
export function mapPelotonWorkout(workout: PelotonWorkout) {
  const imported = appleWatchImportTitle(workout.ride?.title || workout.name, pelotonInstructor(workout))
  const source = imported ? 'Apple Watch' : 'Peloton'
  let activity: string

  if (workout.fitness_discipline === 'outdoor') {
    activity = 'Cycling'
  } else if (workout.fitness_discipline === 'strength') {
    activity = 'Weight Lifting'
  } else if (workout.fitness_discipline) {
    // e.g. "cycling" -> "Cycling", "bike_bootcamp" -> "Bike bootcamp"
    const words = workout.fitness_discipline.replace(/_/g, ' ')
    activity = words.charAt(0).toUpperCase() + words.slice(1)
  } else {
    activity = 'Other'
  }

  const durationSeconds = workout.ride?.duration || (workout.end_time - workout.start_time)
  const minutes = Math.round(durationSeconds / 60)
  const miles = workout.overall_summary?.distance || undefined
  const instructorName = pelotonInstructor(workout)
  const title = workout.ride?.title || workout.name

  return {
    source,
    activity,
    date: new Date(workout.start_time * 1000),
    minutes,
    miles: miles ? Math.round(miles * 100) / 100 : undefined,
    notes: imported ? undefined : [title, instructorName ? `w/ ${instructorName}` : null]
      .filter(Boolean)
      .join(' — ') || undefined,
    pelotonWorkoutId: workout.id,
    ...pelotonClassDetails(workout),
  }
}

/**
 * Re-authenticate with Peloton via OAuth2 and persist the new credential.
 * Used by auth route and by sync route on 401 / token expiry.
 */
export async function refreshPelotonCredential(): Promise<{ sessionId: string; userId: string }> {
  const email = process.env.PELOTON_EMAIL?.trim()
  const password = process.env.PELOTON_PASSWORD?.trim()

  if (!email || !password) {
    throw new Error('PELOTON_EMAIL and PELOTON_PASSWORD must be set in environment')
  }

  const auth = await authenticatePeloton(email, password)

  const expiresAt = auth.expires_in
    ? Math.floor(Date.now() / 1000) + auth.expires_in
    : null

  await prisma.pelotonCredential.upsert({
    where: { userId: auth.user_id },
    update: {
      sessionId: encryptSecret(auth.session_id),
      accessToken: encryptSecret(auth.access_token ?? null),
      refreshToken: encryptSecret(auth.refresh_token ?? null),
      expiresAt,
    },
    create: {
      userId: auth.user_id,
      sessionId: encryptSecret(auth.session_id),
      accessToken: encryptSecret(auth.access_token ?? null),
      refreshToken: encryptSecret(auth.refresh_token ?? null),
      expiresAt,
    },
  })

  return { sessionId: auth.session_id, userId: auth.user_id }
}
