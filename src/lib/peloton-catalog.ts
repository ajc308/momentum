// Find Peloton on-demand classes for the plan, straight from Peloton's
// class library (unofficial /api/v2/ride/archived): newest first, favorite
// instructor first, matching the day's focus and length.

import { integrationFetch } from '@/lib/integration-fetch'
import { PELOTON_API_BASE } from '@/lib/peloton'
import { withCredential } from '@/lib/peloton-request'
import { directMuscleGroups } from '@/lib/muscle-groups'
import { classFocus, type Focus } from '@/lib/planner'

export type ClassTarget = Focus | 'core'

export interface CatalogClass {
  rideId: string
  title: string
  instructor: string | null
  minutes: number
  airedAt: string | null // ISO
  url: string
}

// Andrew's preference: Jermaine Johnson first, then anyone.
export const FAVORITE_INSTRUCTOR = 'Jermaine Johnson'
const CACHE_MS = 30 * 60_000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

async function pelotonGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  return withCredential(
    headers => integrationFetch(`${PELOTON_API_BASE}${path}?${query}`, { headers }),
    async res => {
      if (!res.ok) throw new Error(`Peloton catalog request failed (${res.status})`)
      return res.json() as Promise<T>
    },
  )
}

async function instructorId(name: string): Promise<string | null> {
  return cached(`instructor:${name}`, async () => {
    const res = await pelotonGet<{ data?: Array<{ id: string; name: string }> }>('/api/instructor', { limit: 200, page: 0 })
    return res.data?.find(i => i.name.toLowerCase() === name.toLowerCase())?.id ?? null
  })
}

interface RawRide {
  id: string
  title: string
  duration: number
  instructor_id?: string
  original_air_time?: number
  is_archived?: boolean
}

async function newestStrength(minutes: number, instructor: string | null): Promise<{ rides: RawRide[]; names: Map<string, string> }> {
  return cached(`rides:${minutes}:${instructor ?? 'any'}`, async () => {
    const res = await pelotonGet<{ data?: RawRide[]; instructors?: Array<{ id: string; name: string }> }>('/api/v2/ride/archived', {
      browse_category: 'strength',
      content_format: 'audio,video',
      duration: minutes * 60,
      sort_by: 'original_air_time',
      desc: 'true',
      limit: 100,
      page: 0,
      ...(instructor ? { instructor_id: instructor } : {}),
    })
    return { rides: res.data ?? [], names: new Map((res.instructors ?? []).map(i => [i.id, i.name])) }
  })
}

/** Does a class title fit the target? Core means core-only classes. */
export function titleFits(title: string, target: ClassTarget): boolean {
  if (/warm[\s-]?up|cool[\s-]?down/i.test(title)) return false
  if (target === 'core') return directMuscleGroups(title).includes('core') && classFocus(title) == null
  return classFocus(title) === target
}

const classUrl = (rideId: string) => `https://members.onepeloton.com/classes/strength?modal=classDetailsModal&classId=${rideId}`

/**
 * Up to `count` matching classes, newest first: favorite instructor at the
 * exact length, then anyone at that length, then nearby lengths.
 */
export async function findClasses(target: ClassTarget, minutes: number, count = 3, exclude: Set<string> = new Set()): Promise<CatalogClass[]> {
  const favorite = await instructorId(FAVORITE_INSTRUCTOR).catch(() => null)
  const lengths = [minutes, ...[5, 10, 15, 20, 30].filter(m => m !== minutes).sort((a, b) => Math.abs(a - minutes) - Math.abs(b - minutes))]
  const attempts: Array<[number, string | null]> = [
    ...(favorite ? [[minutes, favorite] as [number, string]] : []),
    [minutes, null],
    ...lengths.slice(1, 3).flatMap(m => [...(favorite ? [[m, favorite] as [number, string]] : []), [m, null] as [number, null]]),
  ]
  const found: CatalogClass[] = []
  const seen = new Set(exclude)
  for (const [length, instructor] of attempts) {
    const { rides, names } = await newestStrength(length, instructor)
    for (const ride of rides) {
      if (found.length >= count) return found
      if (seen.has(ride.id) || !titleFits(ride.title, target)) continue
      seen.add(ride.id)
      found.push({
        rideId: ride.id,
        title: ride.title,
        instructor: (ride.instructor_id && names.get(ride.instructor_id)) || null,
        minutes: Math.round(ride.duration / 60),
        airedAt: ride.original_air_time ? new Date(ride.original_air_time * 1000).toISOString() : null,
        url: classUrl(ride.id),
      })
    }
    if (found.length >= count) break
  }
  return found
}
