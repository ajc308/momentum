import { workoutDay, yearRange } from '@/lib/calendar'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { isValidApiToken } from '@/lib/api-auth'
import { runPelotonSync } from '@/lib/peloton-sync'
import { limitMcp, limitSync, limitMutation } from '@/lib/rate-limit'
import { parseWorkoutDate } from '@/lib/workout-date'
import { logAudit } from '@/lib/audit-log'
import { logWeight, weightEntrySchema } from '@/lib/body-weight'
import { verifyAccessToken } from '@/lib/oauth'
import { buildPlan } from '@/lib/planner'
import { parseClassId, PelotonStackError, stackClasses, stackPlanDay, viewStack } from '@/lib/peloton-stack'
import { withCatalogClasses } from '@/lib/plan-classes'
import { findClasses, FAVORITE_INSTRUCTOR } from '@/lib/peloton-catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Allow-list for CORS (F-09). The MCP endpoint is consumed by native
 * clients (Claude Desktop, Codex, Cursor), so a browser will only show
 * up here in development. We allow the production app origin (so the
 * admin UI can call its own /api/mcp without dropping the bearer token
 * to a third-party origin) plus localhost for dev. ANY other origin
 * gets no CORS headers, which the browser will then treat as a denied
 * cross-origin call.
 */
function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  const allow = new Set<string>()
  if (process.env.APP_BASE_URL) allow.add(process.env.APP_BASE_URL.replace(/\/$/, ''))
  if (process.env.VERCEL_URL) allow.add(`https://${process.env.VERCEL_URL}`)
  if (process.env.NODE_ENV !== 'production') {
    allow.add('http://localhost:3000')
    allow.add('http://127.0.0.1:3000')
  }
  return allow.has(origin) ? origin : null
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req)
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

// YYYY-MM-DD that is a real calendar day (rejects e.g. 2026-02-30).
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => parseWorkoutDate(v) != null, 'Invalid date')

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_workouts',
      {
        description: 'List workout sessions as raw rows from the database. ' +
          'Supports optional filters by year, source (e.g. "Peloton", "Apple Watch"), activity, a ' +
          'since-date (ISO-8601), and limit. Default order is most recent first. ' +
          'Peloton rows include discipline, classTitle, instructor, calories, avgHeartRate, ' +
          'maxHeartRate and totalOutputKj. Returns raw row shape — no aggregation, no derived fields.',
        inputSchema: z.object({
          year: z.number().int().min(2020).max(2100).optional()
            .describe('Calendar year filter (e.g. 2025).'),
          source: z.string().optional()
            .describe('Workout source, e.g. "Peloton", "Apple Watch", "Gym".'),
          activity: z.string().optional()
            .describe('Activity name, e.g. "Cycling", "Weight Lifting", "Running".'),
          discipline: z.string().optional()
            .describe('Peloton discipline, e.g. "strength", "cycling", "stretching".'),
          since: z.string().datetime({ offset: true }).optional()
            .describe('ISO-8601 timestamp — only return workouts on or after this date.'),
          limit: z.number().int().min(1).max(1000).default(100)
            .describe('Max rows to return (1-1000). Default 100.'),
        }),
      },
      async ({ year, source, activity, discipline, since, limit }) => {
        const where: {
          date?: { gte?: Date; lt?: Date }
          source?: string
          activity?: string
          discipline?: string
          deletedAt: null
        } = { deletedAt: null }

        if (year !== undefined) {
          where.date = yearRange(year)
        }
        if (since) {
          const sinceDate = new Date(since)
          where.date = { ...(where.date ?? {}), gte: where.date?.gte && where.date.gte > sinceDate ? where.date.gte : sinceDate }
        }
        if (source) where.source = source
        if (activity) where.activity = activity
        if (discipline) where.discipline = discipline

        const rows = await prisma.workoutSession.findMany({
          where,
          orderBy: { date: 'desc' },
          take: limit,
        })

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: rows.length,
              filters: { year, source, activity, discipline, since, limit },
              workouts: rows,
            }, null, 2),
          }],
        }
      },
    )

    server.registerTool(
      'get_workout',
      {
        description: 'Fetch a single workout session by its database ID.',
        inputSchema: z.object({ id: z.string().min(1).describe('Workout session ID (cuid).') }),
      },
      async ({ id }) => {
        const row = await prisma.workoutSession.findUnique({ where: { id } })
        if (!row || row.deletedAt) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'not_found', id }) }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] }
      },
    )

    server.registerTool(
      'create_workout',
      {
        description: 'Create a new workout session. Use this for manual entries; for Peloton use sync_peloton.',
        inputSchema: z.object({
          date: z.string().describe('Workout date. ISO-8601 date or full timestamp.'),
          source: z.string().min(1).describe('e.g. "Peloton", "Apple Watch", "Gym", "Other".'),
          activity: z.string().min(1).describe('e.g. "Cycling", "Running", "Weight Lifting", "Yoga".'),
          minutes: z.number().int().min(0).max(1440),
          miles: z.number().min(0).max(500).optional(),
          weightLifted: z.number().min(0).max(200000).optional(),
          notes: z.string().max(2000).optional(),
        }),
      },
      async ({ date, source, activity, minutes, miles, weightLifted, notes }, extra) => {
        const req = extra.http?.req
        if (req && limitMutation(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }

        const workoutDate = parseWorkoutDate(date)
        if (!workoutDate) return { content: [{ type: 'text', text: 'Invalid workout date' }], isError: true }
        const created = await prisma.workoutSession.create({
          data: {
            date: workoutDate,
            source,
            activity,
            minutes,
            miles: miles ?? null,
            weightLifted: weightLifted ?? null,
            notes: notes ?? null,
          },
        })
        if (req) await logAudit(req, null, 'mcp.create_workout', { id: created.id, source, activity })
        return { content: [{ type: 'text', text: JSON.stringify({ workout: created }, null, 2) }] }
      },
    )

    server.registerTool(
      'update_workout',
      {
        description: 'Update fields on an existing workout. Only provided fields are changed.',
        inputSchema: z.object({
          id: z.string().min(1),
          date: z.string().optional(),
          source: z.string().optional(),
          activity: z.string().optional(),
          minutes: z.number().int().min(0).max(1440).optional(),
          miles: z.number().min(0).max(500).nullable().optional(),
          weightLifted: z.number().min(0).max(200000).nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
        }),
      },
      async ({ id, date, source, activity, minutes, miles, weightLifted, notes }, extra) => {
        const req = extra.http?.req
        if (req && limitMutation(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }

        const data: Record<string, unknown> = {}
        if (date !== undefined) {
          const parsed = parseWorkoutDate(date)
          if (!parsed) return { content: [{ type: 'text', text: 'Invalid workout date' }], isError: true }
          data.date = parsed
        }
        if (source !== undefined) data.source = source
        if (activity !== undefined) data.activity = activity
        if (minutes !== undefined) data.minutes = minutes
        if (miles !== undefined) data.miles = miles
        if (weightLifted !== undefined) data.weightLifted = weightLifted
        if (notes !== undefined) data.notes = notes

        const updated = await prisma.workoutSession.update({ where: { id, deletedAt: null }, data })
        if (req) await logAudit(req, null, 'mcp.update_workout', { id, fields: Object.keys(data) })
        return { content: [{ type: 'text', text: JSON.stringify({ workout: updated }, null, 2) }] }
      },
    )

    server.registerTool(
      'delete_workout',
      {
        description: 'Soft-delete a workout session by ID. Sets deletedAt; row remains for audit.',
        inputSchema: z.object({ id: z.string().min(1) }),
      },
      async ({ id }, extra) => {
        const req = extra.http?.req
        if (req && limitMutation(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }

        // F-06: soft-delete instead of hard-delete so a runaway agent
        // cannot destroy data irreversibly.
        await prisma.workoutSession.update({
          where: { id },
          data: { deletedAt: new Date() },
        })
        if (req) await logAudit(req, null, 'mcp.delete_workout', { id })
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id, soft: true }) }] }
      },
    )

    server.registerTool(
      'list_weight',
      {
        description: 'List body weight entries (one per day, manually logged) as raw rows, oldest first. ' +
          'Optional since-date filter (YYYY-MM-DD).',
        inputSchema: z.object({
          since: calendarDay.optional()
            .describe('Only return entries on or after this date (YYYY-MM-DD).'),
        }),
      },
      async ({ since }) => {
        const rows = await prisma.bodyMeasurement.findMany({
          where: since ? { date: { gte: new Date(`${since}T00:00:00Z`) } } : {},
          orderBy: { date: 'asc' },
          select: { id: true, date: true, weightLbs: true, bodyFatPct: true, neckIn: true, waistIn: true, heightIn: true, source: true },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: rows.length, entries: rows }, null, 2) }] }
      },
    )

    server.registerTool(
      'list_health_metrics',
      {
        description: 'List daily Apple Health metrics pushed from the iPhone (one row per metric per day): ' +
          'resting_heart_rate, heart_rate (min/avg/max), heart_rate_variability, walking_heart_rate_average, ' +
          'vo2_max, step_count, active_energy, apple_exercise_time, apple_move_time, apple_stand_hour, ' +
          'apple_stand_time, walking_running_distance. ' +
          'Apple Watch workouts are in list_workouts (source "Apple Watch").',
        inputSchema: z.object({
          name: z.string().optional().describe('Metric name filter, e.g. "resting_heart_rate".'),
          since: calendarDay.optional()
            .describe('Only return days on or after this date (YYYY-MM-DD).'),
          limit: z.number().int().min(1).max(2000).default(400),
        }),
      },
      async ({ name, since, limit }) => {
        const rows = await prisma.healthMetric.findMany({
          where: {
            ...(name ? { name } : {}),
            ...(since ? { date: { gte: new Date(`${since}T00:00:00Z`) } } : {}),
          },
          orderBy: [{ date: 'desc' }, { name: 'asc' }],
          take: limit,
          select: { name: true, date: true, units: true, qty: true, min: true, avg: true, max: true },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: rows.length, metrics: rows }, null, 2) }] }
      },
    )

    server.registerTool(
      'log_weight',
      {
        description: 'Log a body weight weigh-in for a calendar day, optionally with neck and waist tape measurements (inches), from which body fat % is calculated (US Navy method, male equation; height defaults to the last one logged). Logging again for the same day replaces it.',
        inputSchema: weightEntrySchema,
      },
      async (entry, extra) => {
        const req = extra.http?.req
        if (req && limitMutation(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }
        const row = await logWeight(entry)
        if (req) await logAudit(req, null, 'mcp.log_weight', { date: entry.date })
        return { content: [{ type: 'text', text: JSON.stringify({ logged: row }, null, 2) }] }
      },
    )

    server.registerTool(
      'get_training_plan',
      {
        description: 'The adaptive 7-day training plan shown in the app, rebuilt from workout history on every ' +
          'call (skipped days roll forward; `adapted` explains any change). First block: one plain-English line per ' +
          'day. Then JSON: `nextWorkout` is the next day with something to do; each day has `status` (strength | ' +
          'walk | rest | done), `title` (e.g. "Glutes & Legs + Core"), and `suggestions` — separate Peloton classes ' +
          'to do in order, picked from Peloton\'s library (newest first, Jermaine Johnson preferred), each with ' +
          '`role` ("main" focus class or stacked "core" class), `title`, `instructor`, `minutes`, `airedAt`, ' +
          '`rideId` and `url`. To queue a day\'s classes on Peloton, call stack_peloton_classes with that `day`. ' +
          'Days are in US Eastern time.',
        inputSchema: z.object({}),
      },
      async () => {
        const rows = await prisma.workoutSession.findMany({
          where: { deletedAt: null },
          select: { date: true, activity: true, discipline: true, classTitle: true, instructor: true, minutes: true, pelotonWorkoutId: true },
        })
        const plan = await withCatalogClasses(buildPlan(rows, workoutDay(new Date())))
        const lines = [
          ...(plan.adapted ? [`Plan adjusted: ${plan.adapted}`] : []),
          plan.nextWorkout ? `Next workout: ${plan.nextWorkout.summary}` : 'Next workout: none scheduled this week.',
          '',
          ...plan.days.map(d => d.summary),
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }, { type: 'text', text: JSON.stringify(plan, null, 2) }] }
      },
    )

    server.registerTool(
      'find_peloton_classes',
      {
        description: `Search Peloton's on-demand strength library for classes by focus and length, newest first, ` +
          `preferring ${FAVORITE_INSTRUCTOR}. Returns class ids and links that stack_peloton_classes accepts.`,
        inputSchema: z.object({
          focus: z.enum(['legs', 'chest_back', 'arms_shoulders', 'core'])
            .describe('legs = Glutes & Legs, chest_back = Chest & Back, arms_shoulders = Arms & Shoulders, core = Core.'),
          minutes: z.number().int().min(5).max(60).default(20),
          count: z.number().int().min(1).max(10).default(5),
        }),
      },
      async ({ focus, minutes, count }) => {
        try {
          const classes = await findClasses(focus, minutes, count)
          return { content: [{ type: 'text', text: JSON.stringify({ count: classes.length, classes }, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : 'search_failed' }) }], isError: true }
        }
      },
    )

    server.registerTool(
      'get_peloton_stack',
      {
        description: 'Show the classes currently in the user\'s Peloton Stack (the queue that appears on their ' +
          'Peloton bike/tread/app), in play order.',
        inputSchema: z.object({}),
      },
      async () => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await viewStack(), null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : 'stack_failed' }) }], isError: true }
        }
      },
    )

    server.registerTool(
      'stack_peloton_classes',
      {
        description: 'Put Peloton classes on the user\'s Peloton Stack so they are ready to play on the bike/tread/app. ' +
          'Either give `classes` (Peloton class ids or class links such as ' +
          'https://members.onepeloton.com/classes/strength?modal=classDetailsModal&classId=<id>), or omit it to ' +
          'stack the suggested classes for a plan day from get_training_plan (`day`, default: the next workout). ' +
          '`mode` "append" (default) adds after what is already stacked and skips duplicates; "replace" makes these ' +
          'the whole Stack in the given order. Only on-demand classes can be stacked; max 10.',
        inputSchema: z.object({
          classes: z.array(z.string().min(1)).max(10).optional()
            .describe('Peloton class ids or class URLs, in play order.'),
          day: calendarDay.optional().describe('Plan day (YYYY-MM-DD) to stack when `classes` is omitted.'),
          mode: z.enum(['append', 'replace']).default('append'),
        }),
      },
      async ({ classes, day, mode }, extra) => {
        const req = extra.http?.req
        if (req && limitMutation(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }
        try {
          if (classes?.length) {
            const ids = classes.map(parseClassId)
            const bad = classes.filter((_, i) => !ids[i])
            if (bad.length) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'unrecognized_class', classes: bad }) }], isError: true }
            }
            const result = await stackClasses(ids as string[], mode)
            if (req) await logAudit(req, null, 'mcp.stack_peloton_classes', { count: ids.length, mode })
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
          }
          const result = await stackPlanDay(day, mode)
          if (req) await logAudit(req, null, 'mcp.stack_peloton_classes', { day: result.day.day, mode })
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (err) {
          const message = err instanceof PelotonStackError || err instanceof Error ? err.message : 'stack_failed'
          return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
        }
      },
    )

    server.registerTool(
      'list_goals',
      {
        description: 'List all configured goals (annual targets + derived weekly/quarterly values).',
        inputSchema: z.object({}),
      },
      async () => {
        const goals = await prisma.goal.findMany({ orderBy: { year: 'desc' } })
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: goals.length, goals }, null, 2) }],
        }
      },
    )

    server.registerTool(
      'peloton_status',
      {
        description: 'Check whether the app has valid Peloton credentials stored.',
        inputSchema: z.object({}),
      },
      async () => {
        const cred = await prisma.pelotonCredential.findFirst()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ connected: !!cred, userId: cred?.userId ?? null }),
          }],
        }
      },
    )

    server.registerTool(
      'sync_peloton',
      {
        description: 'Trigger a Peloton sync — pulls new workouts from the Peloton API into the database. ' +
          'Returns counts of synced / updated / skipped / total inspected.',
        inputSchema: z.object({
          limit: z.number().int().min(50).max(2000).default(200)
            .describe('Max workouts to inspect from Peloton (50-2000, default 200).'),
        }),
      },
      async ({ limit }, extra) => {
        const req = extra.http?.req
        if (req && limitSync(req)) return { content: [{ type: 'text', text: 'Too many requests' }], isError: true }
        try {
          // F-04: call the sync lib directly — no self-fetch, no token
          // in an outbound request that could be redirected.
          const result = await runPelotonSync(limit)
          if (req) await logAudit(req, null, 'mcp.sync_peloton', { limit, result })
          return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'sync_failed'
          return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
        }
      },
    )
  },
  {
    serverInfo: { name: 'fitness-tracker', version: '0.3.0' },
    verboseLogs: false,
  },
)

const authed = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined
    // Static personal token (Claude Desktop / Code, scripts)...
    if (isValidApiToken(bearerToken)) {
      return {
        token: 'redacted',
        clientId: 'fitness-tracker-pat',
        scopes: ['workouts:read', 'workouts:write', 'sync:run'],
      }
    }
    // ...or an OAuth access token (claude.ai / ChatGPT connectors).
    const oauth = await verifyAccessToken(bearerToken)
    if (!oauth) return undefined
    return {
      token: 'redacted',
      clientId: oauth.clientId,
      scopes: ['workouts:read', 'workouts:write', 'sync:run'],
      expiresAt: oauth.expiresAt,
    }
  },
  // 401s point clients at the path-suffixed RFC 9728 metadata for this URL.
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp/mcp' },
)

/**
 * Wrap the authed handler with rate limiting (F-06) and CORS headers
 * (F-09). OPTIONS pre-flight is handled explicitly so browser clients
 * from allow-listed origins succeed.
 */
async function withGuards(req: Request): Promise<Response> {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  // Rate-limit MCP requests (separate bucket for sync tools could be added
  // by inspecting the JSON-RPC body, but that requires consuming the
  // stream; the global cap below covers the worst case).
  const limited = limitMcp(req)
  if (limited) {
    const headers = new Headers(limited.headers)
    for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v)
    return new Response(limited.body, { status: 429, headers })
  }

  const res = await authed(req)
  // Merge CORS headers onto the MCP handler's response.
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

export {
  withGuards as GET,
  withGuards as POST,
  withGuards as DELETE,
  withGuards as OPTIONS,
}
