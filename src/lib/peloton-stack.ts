// Peloton "Stack" (the queue of classes on the bike/tread/app), via the
// unofficial GraphQL gateway the Peloton web app uses. Community-documented
// (e.g. rlasker3/peloton-mcp); if Peloton renames these operations, find
// the new names in DevTools on members.onepeloton.com.
//
// Stack mutations take `pelotonClassId` as a base64 JSON join token built
// from the class's ride id. Only on-demand classes can be stacked, max 10.

import { integrationFetch } from '@/lib/integration-fetch'
import { PELOTON_API_BASE } from '@/lib/peloton'
import { AUTH_ERROR, AuthRejected, withCredential } from '@/lib/peloton-request'
import prisma from '@/lib/prisma'
import { buildPlan, type PlanDay } from '@/lib/planner'
import { withCatalogClasses } from '@/lib/plan-classes'
import { workoutDay } from '@/lib/calendar'

const GQL_URL = 'https://gql-graphql-gateway.prod.k8s.onepeloton.com/graphql'
export const STACK_LIMIT = 10

export interface StackedClass {
  classId: string
  title: string
  minutes: number | null
  instructor: string | null
}

export interface PelotonStack {
  numClasses: number
  totalMinutes: number
  classes: StackedClass[]
}

export class PelotonStackError extends Error {}

/** A Peloton class (ride) id: 32 hex characters. */
const RIDE_ID = /^[0-9a-f]{32}$/i

/** Accepts a bare class id or a Peloton class link (…?classId=<id> or …/classes/…/<id>). */
export function parseClassId(input: string): string | null {
  const value = input.trim()
  if (RIDE_ID.test(value)) return value.toLowerCase()
  try {
    const url = new URL(value)
    const fromQuery = url.searchParams.get('classId') ?? url.searchParams.get('class_id')
    if (fromQuery && RIDE_ID.test(fromQuery)) return fromQuery.toLowerCase()
    const fromPath = url.pathname.split('/').find(part => RIDE_ID.test(part))
    return fromPath ? fromPath.toLowerCase() : null
  } catch {
    return null
  }
}

/** The join token Stack mutations expect for an on-demand class. */
export function joinToken(rideId: string): string {
  const payload = JSON.stringify({ home_peloton_id: null, ride_id: rideId, studio_peloton_id: null, type: 'on_demand' })
  return Buffer.from(payload, 'utf8').toString('base64')
}

async function gql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  return withCredential(
    headers => integrationFetch(GQL_URL, { method: 'POST', headers, body: JSON.stringify({ operationName, query, variables }) }),
    async res => {
      const body = await res.json().catch(() => null) as { data?: T; errors?: Array<{ message: string }> } | null
      if (body?.errors?.some(e => AUTH_ERROR.test(e.message))) throw new AuthRejected()
      if (!res.ok || !body) throw new PelotonStackError(`Peloton stack request failed (${res.status})`)
      if (body.errors?.length) throw new PelotonStackError(`Peloton stack error: ${body.errors[0].message}`)
      return body.data as T
    },
  )
}

const STACK_FIELDS = `
  numClasses
  totalTime
  ... on StackResponseSuccess {
    userStack {
      stackedClassList {
        playOrder
        pelotonClass {
          classId
          title
          duration
          ... on OnDemandInstructorClass { instructor { name } }
        }
      }
    }
  }
  __typename`

interface RawStack {
  numClasses?: number
  totalTime?: number
  __typename?: string
  userStack?: { stackedClassList?: Array<{ playOrder: number; pelotonClass?: { classId: string; title: string; duration?: number; instructor?: { name?: string } } }> }
}

function toStack(raw: RawStack | undefined): PelotonStack {
  if (!raw || (raw.__typename && raw.__typename !== 'StackResponseSuccess')) {
    throw new PelotonStackError(`Peloton refused the stack request (${raw?.__typename ?? 'no response'})`)
  }
  const classes = [...(raw.userStack?.stackedClassList ?? [])]
    .sort((a, b) => a.playOrder - b.playOrder)
    .filter(item => item.pelotonClass)
    .map(({ pelotonClass: c }) => ({
      classId: c!.classId,
      title: c!.title,
      minutes: c!.duration ? Math.round(c!.duration / 60) : null,
      instructor: c!.instructor?.name ?? null,
    }))
  return { numClasses: raw.numClasses ?? classes.length, totalMinutes: Math.round((raw.totalTime ?? 0) / 60), classes }
}

export async function viewStack(): Promise<PelotonStack> {
  const data = await gql<{ viewUserStack: RawStack }>('ViewUserStack', `query ViewUserStack { viewUserStack { ${STACK_FIELDS} } }`)
  return toStack(data.viewUserStack)
}

async function addOne(rideId: string): Promise<void> {
  const data = await gql<{ addClassToStack: RawStack }>(
    'AddClassToStack',
    `mutation AddClassToStack($input: AddClassToStackInput!) { addClassToStack(input: $input) { ${STACK_FIELDS} } }`,
    { input: { pelotonClassId: joinToken(rideId) } },
  )
  toStack(data.addClassToStack)
}

async function replaceAll(rideIds: string[]): Promise<void> {
  const data = await gql<{ modifyStack: RawStack }>(
    'ModifyStack',
    `mutation ModifyStack($input: ModifyStackInput!) { modifyStack(input: $input) { ${STACK_FIELDS} } }`,
    { input: { pelotonClassIdList: rideIds.map(joinToken) } },
  )
  toStack(data.modifyStack)
}

/** The class (ride) id behind one of your past Peloton workouts. */
export async function rideIdForWorkout(pelotonWorkoutId: string): Promise<string | null> {
  return withCredential(
    headers => integrationFetch(`${PELOTON_API_BASE}/api/workout/${encodeURIComponent(pelotonWorkoutId)}?joins=ride`, { headers }),
    async res => {
      if (!res.ok) return null
      const workout = await res.json().catch(() => null) as { ride_id?: string; ride?: { id?: string } } | null
      const id = workout?.ride?.id ?? workout?.ride_id
      // Free / imported workouts have no real class (all-zero ride id).
      return id && RIDE_ID.test(id) && !/^0+$/.test(id) ? id.toLowerCase() : null
    },
  )
}

export interface StackResult {
  added: string[]
  alreadyStacked: string[]
  skipped: string[]
  stack: PelotonStack
}

/**
 * Put classes on the Stack. "append" (default) adds them after what's
 * there, skipping ones already stacked; "replace" makes them the whole
 * Stack, in order. Never exceeds Peloton's 10-class limit.
 */
export async function stackClasses(rideIds: string[], mode: 'append' | 'replace' = 'append'): Promise<StackResult> {
  const wanted = [...new Set(rideIds.map(id => id.toLowerCase()))]
  if (mode === 'replace') {
    const kept = wanted.slice(0, STACK_LIMIT)
    await replaceAll(kept)
    return { added: kept, alreadyStacked: [], skipped: wanted.slice(STACK_LIMIT), stack: await viewStack() }
  }
  const current = await viewStack()
  const present = new Set(current.classes.map(c => c.classId.toLowerCase()))
  const added: string[] = []
  const alreadyStacked: string[] = []
  const skipped: string[] = []
  for (const id of wanted) {
    if (present.has(id)) alreadyStacked.push(id)
    else if (present.size + added.length >= STACK_LIMIT) skipped.push(id)
    else { await addOne(id); added.push(id) }
  }
  return { added, alreadyStacked, skipped, stack: await viewStack() }
}

export interface PlanStackResult extends StackResult {
  day: PlanDay
  /** Suggested classes that aren't from your Peloton history, so have no class to stack. */
  notStackable: string[]
}

/**
 * Stack the classes suggested for a plan day (default: the next workout),
 * looking up each class from the past Peloton workout it was picked from.
 */
export async function stackPlanDay(day?: string, mode: 'append' | 'replace' = 'append'): Promise<PlanStackResult> {
  const rows = await prisma.workoutSession.findMany({
    where: { deletedAt: null },
    select: { date: true, activity: true, discipline: true, classTitle: true, instructor: true, minutes: true, pelotonWorkoutId: true },
  })
  const plan = await withCatalogClasses(buildPlan(rows, workoutDay(new Date())))
  const target = day ? plan.days.find(d => d.day === day) : plan.nextWorkout
  if (!target) throw new PelotonStackError(day ? `${day} isn't in the next 7 days of the plan.` : 'Nothing is planned in the next 7 days.')
  if (target.suggestions.length === 0) throw new PelotonStackError(`${target.title} on ${target.day} has no classes to stack.`)

  const rideIds: string[] = []
  const notStackable: string[] = []
  for (const s of target.suggestions) {
    const rideId = s.rideId ?? (s.pelotonWorkoutId ? await rideIdForWorkout(s.pelotonWorkoutId) : null)
    if (rideId) rideIds.push(rideId)
    else notStackable.push(s.title)
  }
  if (rideIds.length === 0) throw new PelotonStackError(`None of ${target.day}'s suggested classes could be found on Peloton.`)
  return { day: target, notStackable, ...(await stackClasses(rideIds, mode)) }
}
