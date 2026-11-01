# Momentum (fitness-tracker)

Personal fitness dashboard that collects Peloton classes, Apple Watch workouts and Apple Health metrics, plus manual weigh-ins, and exposes all of it to AI assistants (Claude, ChatGPT) through an MCP server.

## Features

- 🚴 **Peloton sync** - Every class (strength, cycling, running, …) with class title, instructor, calories, heart rate and output. Runs nightly via Vercel Cron, or on demand.
- ⌚ **Apple Health** - Apple Watch workouts and daily metrics (resting heart rate, HRV, steps, …) pushed from the iPhone by the Health Auto Export app.
- ⚖️ **Weight** - Log weigh-ins on the Body page or by asking your AI assistant.
- 📊 **Dashboard** - Streak, Apple Watch activity rings, a two-week split view, strength focus by muscle group (parsed from class titles), a training calendar heatmap, heart trends and personal bests. `/workouts` is the searchable log; `/body` has weight and recovery trends.
- 🤖 **MCP server** - Read and log data from Claude (desktop, web, mobile, Code) or ChatGPT.
- 🔒 **Single user** - Google login restricted to one email.

## Tech Stack

- Next.js 16 (App Router), React 18, TypeScript, Tailwind CSS
- PostgreSQL via Prisma (Neon on Vercel)
- NextAuth.js v5 with Google OAuth
- `mcp-handler` (streamable HTTP MCP) with a built-in OAuth 2.1 server

## Setup

```bash
npm ci
cp .env.example .env.local   # fill in values
npm run db:migrate
npm run dev                  # http://localhost:3000
```

Environment variables (see `.env.example` for details):

| Variable | Purpose |
|---|---|
| `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | Database (set automatically by the Vercel Neon integration) |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Session signing and the public URL |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `ALLOWED_EMAIL` | The only account allowed to sign in (unset = nobody) |
| `CREDENTIAL_ENC_KEY` | AES-256-GCM key for the stored Peloton token (64 hex chars) |
| `PELOTON_EMAIL`, `PELOTON_PASSWORD` | Peloton login used by the sync |
| `CRON_SECRET` | Lets Vercel Cron call the nightly sync |
| `MCP_API_TOKEN` | Static bearer token for MCP clients that support custom headers |
| `HEALTH_INGEST_TOKEN` | Bearer token for the Apple Health webhook (write-only) |
| `APP_BASE_URL` | Public URL; used as the OAuth issuer and for MCP CORS |
| `OAUTH_REDIRECT_HOSTS` | Optional override of allowed OAuth redirect hosts (default `claude.ai,claude.com,chatgpt.com,localhost,127.0.0.1`) |

Generate secrets with `openssl rand -hex 32`.

## Peloton

The sync logs in with `PELOTON_EMAIL` / `PELOTON_PASSWORD` (Peloton's unofficial API), stores the session token encrypted, and re-authenticates when it expires. `vercel.json` schedules `/api/cron/peloton-sync` nightly at 04:00 UTC; the dashboard's **Sync Peloton** button and the `sync_peloton` MCP tool run it on demand. Each run inspects the 200 most recent workouts and skips ones already stored. Workouts synced before class details existed are backfilled once.

## Apple Health

Apple Health has no web API, so the iPhone pushes data with [Health Auto Export](https://www.healthyapps.dev/) (paid app, "REST API" automation):

- **URL:** `https://<your-app>/api/health/ingest`
- **Header:** `Authorization: Bearer <HEALTH_INGEST_TOKEN>`
- **Format:** JSON v2, batch requests on. Use two automations (the app exports one data type each): Health Metrics and Workouts (route data off)

Workouts become rows with source "Apple Watch". A watch workout that overlaps a synced Peloton class (Peloton writes its classes into Health) is not duplicated; its heart rate is copied onto the Peloton row if Peloton had none. Every metric point is stored as sent (any granularity, any metric — unrecognized ones are kept raw for later) and each touched day is re-summarized, so "since last sync" pushes, batched uploads and overlapping re-sends all give correct daily totals. Weigh-ins from Health are stored unless you already logged one manually that day.

## AI assistants (MCP)

Endpoint: `https://<your-app>/api/mcp/mcp` (streamable HTTP).

- **claude.ai / Claude mobile / ChatGPT:** add a custom connector with just the URL. The client discovers OAuth, registers itself, and sends you to a consent page that requires your Google login. Approve and you're connected.
- **Claude Code:** `claude mcp add --transport http fitness https://<your-app>/api/mcp/mcp --header "Authorization: Bearer $MCP_API_TOKEN"`
- **Claude Desktop / other clients with header support:** use the URL plus the `Authorization: Bearer <MCP_API_TOKEN>` header, or OAuth if the client supports it.

Tools (raw rows, no precomputed aggregates):

- `list_workouts` (filters: year, source, activity, discipline, since, limit), `get_workout`, `create_workout`, `update_workout`, `delete_workout`
- `list_weight`, `log_weight`
- `list_health_metrics` (filters: name, since)
- `get_training_plan` — the adaptive 7-day plan from the dashboard (3 strength days/week, ~30 min, rotating Chest & Back / Arms & Shoulders / Glutes & Legs by what's most overdue; skipped days roll forward). Preferences live in `PLAN_PREFS` in `src/lib/planner.ts`.
- `find_peloton_classes` — search Peloton's strength library by focus and length (newest first, Jermaine Johnson preferred); `get_training_plan` uses the same picks
- `get_peloton_stack`, `stack_peloton_classes` — view the Peloton Stack; stack class ids/links, or a plan day's classes (append or replace, max 10)
- `list_goals`
- `peloton_status`, `sync_peloton`

`MCP_API_TOKEN` also works as a bearer token for the REST routes (`/api/workouts`, `/api/goals`, `/api/body-measurements`, `/api/peloton/*`).

## Development

```bash
npm run dev           # dev server
npm test              # unit tests
npm run lint
npm run build
npm run db:migrate:dev -- --name <name>   # create a migration
```

Builds don't touch the database. On Vercel the build command is `prisma migrate deploy && npm run build`, so migrations apply on deploy. CI also runs `npm run test:postgres` against a disposable PostgreSQL (`TEST_POSTGRES_URL`) to check the sync advisory locks.

## Security

### Auth model

- `/api/*` accepts a NextAuth session cookie or `Authorization: Bearer $MCP_API_TOKEN`. Middleware is the first gate; route handlers re-check with `requireAuth(request)`.
- Routes that police themselves and are skipped by middleware: `/api/auth/*`, `/api/mcp/*` (static token or OAuth access token), `/api/cron/*` (`CRON_SECRET`), `/api/health/ingest` (`HEALTH_INGEST_TOKEN`), `/api/oauth/*` and `/.well-known/*` (public OAuth endpoints; the approve step requires a session).
- Single-purpose secrets (`CRON_SECRET`, `HEALTH_INGEST_TOKEN`) can only trigger a sync or write health data, so a leaked phone or cron credential can't read anything.

### OAuth server

- Authorization code flow with mandatory PKCE (S256), public clients, dynamic client registration.
- Redirect URIs must be https on an allow-listed host, so nobody can register a client that sends your code to their own server.
- The consent page requires your Google session; the approve POST rejects cross-origin requests and bearer-only callers.
- Codes are single-use and expire in 5 minutes. Access tokens last 1 hour; refresh tokens last 90 days and rotate on every use. Only SHA-256 hashes are stored.

### `MCP_API_TOKEN` is an admin credential

The app is single-tenant, so the token unlocks everything. Store it only in Vercel env vars and your MCP client config. To rotate: set a new value in Vercel, update clients, redeploy. Every bearer-authed mutation writes an `audit_log` row.

### Data at rest and transport

- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` and `__Secure-` prefixed in production.
- Peloton tokens are encrypted with AES-256-GCM (`CREDENTIAL_ENC_KEY`); production writes fail without a valid key. Keep the key when upgrading; a new key can't decrypt old rows. `npm run credentials:encrypt` (dry run, then `-- --apply`) encrypts legacy plaintext rows.
- Workout deletion is a soft delete (`deletedAt`), so syncs never recreate deleted workouts.
- HSTS, CSP, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive permissions policy are set in `next.config.ts`.
- Rate limits are in-memory token buckets per instance: 60/min for mutations, 10/min for syncs, 5/min for Peloton login, 120/min for MCP, and a 300-request burst (10/s) for health ingest so history backfills go through.

Report security issues via a private GitHub advisory.

## License

MIT — see [LICENSE](LICENSE). Started as a fork of [carryologist/fitness-tracker](https://github.com/carryologist/fitness-tracker).
