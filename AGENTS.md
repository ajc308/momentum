You are an experienced, pragmatic software engineering AI agent. Do not over-engineer a solution when a simple one is possible. Keep edits minimal. If you want an exception to ANY rule, you MUST stop and get permission first.

# Fitness Tracker

Personal fitness tracking application with a Next.js web dashboard. Collects Peloton classes, Apple Watch workouts / Apple Health metrics and manual weigh-ins, and exposes them to AI assistants via MCP.

## Technology Stack

- **Web**: Next.js 16 (App Router), React 18, TypeScript
- **Database**: PostgreSQL via Prisma ORM (Vercel Postgres)
- **Authentication**: NextAuth.js v5 (Auth.js) with Google OAuth
- **Styling**: Tailwind CSS
- **Forms**: react-hook-form with Zod validation
- **Charts**: Recharts
- **External APIs**: Peloton API (class sync); Apple Health data is pushed to us by the Health Auto Export iOS app

## Project Structure

```
src/
├── app/           # Next.js App Router pages and API routes
│   └── api/       # REST endpoints: /goals, /workouts, /body-measurements, /peloton/*, /health/ingest, /cron/*, /oauth/*, /mcp/*
├── components/    # React components (dialogs, charts, forms)
├── lib/           # Utilities and shared code (peloton, apple-health, body-weight, oauth, types)
├── types/         # TypeScript type definitions
├── utils/         # Helper functions (calculations, formatting)
└── data/          # Data layer (currently empty - data in database)
prisma/            # Database schema and migrations
scripts/           # Data import utilities
```

## Key Files

- `prisma/schema.prisma` - Database models: `WorkoutSession`, `Goal`, `BodyMeasurement`, `HealthMetric`, `PelotonCredential`, `OAuthClient`/`OAuthCode`/`OAuthToken`, `AuditLog`
- `src/app/api/*/route.ts` - API endpoints
- `src/components/overview/OverviewDashboard.tsx` - Main dashboard (`/`); `/workouts` and `/body` live in `src/components/workouts` and `src/components/body`
- `src/lib/peloton.ts` - Peloton API integration (session-cookie auth)
- `src/lib/peloton-sync.ts` - Peloton sync orchestration (also run nightly by `src/app/api/cron/peloton-sync/route.ts`, scheduled in `vercel.json`)
- `src/lib/apple-health.ts` - Apple Health ingest (Health Auto Export JSON) behind `src/app/api/health/ingest/route.ts`
- `src/lib/body-weight.ts` - Manual weigh-in validation and upsert (REST + MCP)
- `src/lib/oauth.ts` - OAuth 2.1 server for remote MCP clients (claude.ai, ChatGPT)
- `src/app/api/mcp/[transport]/route.ts` - MCP server for AI agents (Claude, Codex, OpenClaw, ...)
- `src/lib/api-auth.ts` - Bearer-token helpers for `MCP_API_TOKEN`

## Essential Commands

```bash
# Web (root directory)
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run lint         # ESLint check
npm run start        # Start production server

# Database
npx prisma generate  # Generate Prisma client (runs on postinstall)
npx prisma migrate dev --name <name>  # Create migration
npx prisma db push   # Push schema changes without migration

# Integrations
# Set environment variables: PELOTON_EMAIL, PELOTON_PASSWORD, CRON_SECRET, HEALTH_INGEST_TOKEN
```

## Patterns

### Path Aliases
Use `@/*` for imports from `src/`:
```typescript
import { cn } from "@/lib/utils";
import { WorkoutSession } from "@/types/workout";
```

### API Routes
API routes use Next.js App Router conventions in `src/app/api/`:
```typescript
// src/app/api/workouts/route.ts
export async function GET() { ... }
export async function POST(request: Request) { ... }
```

### Database Access
Use Prisma client from `@/lib/db` or instantiate directly:
```typescript
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
```

## Commit Guidelines

- Run `npm run lint` and `npm run build` before committing
- Commit format: `type: message` (e.g., `feat: Add workout editing`)
- Common types: `feat`, `fix`, `style`, `refactor`, `docs`

## Authentication

### Overview
The app uses NextAuth.js v5 (Auth.js) with Google OAuth for authentication. All routes are protected by default except `/api/auth/*` and `/login`.

### Setup Instructions

#### 1. Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API** (or **Google Identity**)
4. Go to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth 2.0 Client ID**
6. Configure the consent screen:
   - User Type: External (for personal use)
   - Add your email as a test user
   - Scopes: `email`, `profile`, `openid` (default)
7. Application type: **Web application**
8. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://yourdomain.com/api/auth/callback/google`
9. Copy the **Client ID** and **Client Secret**

#### 2. Configure Environment Variables

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in the required values:
   ```bash
   # Generate a secret key (required for production)
   openssl rand -base64 32
   ```

3. Required variables:
   ```env
   NEXTAUTH_SECRET="your-generated-secret"
   NEXTAUTH_URL="http://localhost:3000"  # or your production URL
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   ```

4. Optional - Restrict to single user:
   ```env
   ALLOWED_EMAIL="your-email@example.com"
   ```
   If set, only this email can sign in. Leave empty to allow any Google account.

#### 3. Test Authentication

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://localhost:3000`
3. You should be redirected to `/login`
4. Click "Sign in with Google"
5. Complete the OAuth flow
6. You should be redirected back to the dashboard

### Authentication Flow

1. **Middleware** (`middleware.ts`) checks authentication status on every request
2. Unauthenticated users are redirected to `/login`
3. `/login` page provides Google sign-in button
4. OAuth handled by NextAuth.js at `/api/auth/[...nextauth]`
5. Session stored as JWT (serverless-friendly)
6. User info displayed in header with sign-out button

### Key Files

- `auth.ts` - NextAuth.js configuration
- `middleware.ts` - Route protection
- `src/app/api/auth/[...nextauth]/route.ts` - Auth API handlers
- `src/app/login/page.tsx` - Custom sign-in page
- `src/components/AppShell.tsx` - Header, mobile tab bar, account menu (sign-out) and Sync Peloton
- `.env.example` - Environment variable template

### Security Notes

- All routes except `/api/auth/*`, `/api/mcp/*`, `/api/cron/*`, `/api/health/ingest`, `/api/oauth/*`, `/.well-known/*`, and `/login` require authentication
- `/api/cron/*` routes are called by Vercel Cron (`vercel.json`) and check `Authorization: Bearer $CRON_SECRET` themselves
- `/api/health/ingest` checks `Authorization: Bearer $HEALTH_INGEST_TOKEN` itself (write-only token for the phone app)
- `/api/oauth/*` and `/.well-known/*` are the public OAuth endpoints; `/api/oauth/authorize` (consent POST) requires a real session itself
- API routes additionally accept `Authorization: Bearer $MCP_API_TOKEN` as a session-cookie alternative
- Static files (images, fonts, etc.) are excluded from authentication checks
- Sessions use JWT strategy for serverless deployment compatibility
- Optional email restriction for single-user applications
- NEXTAUTH_SECRET must be set in production

## MCP Server (Agent Access)

The app ships an MCP server at `/api/mcp/mcp` (streamable HTTP transport) so agents can read workouts, weight and Apple Health metrics, log workouts and weight, and trigger Peloton syncs.

### Auth

Two ways in, both as `Authorization: Bearer <token>`:

- `MCP_API_TOKEN` (`openssl rand -hex 32`, must be >= 16 chars) for clients that support custom headers (Claude Code, Claude Desktop, scripts).
- OAuth 2.1 access tokens (`src/lib/oauth.ts`) for clients that only speak OAuth (claude.ai custom connectors, ChatGPT). 401s carry `WWW-Authenticate: ... resource_metadata=".../.well-known/oauth-protected-resource/api/mcp/mcp"` so clients can discover the flow: dynamic registration (`/api/oauth/register`), consent (`/oauth/authorize`, requires Google login), token exchange (`/api/oauth/token`).

The same token also unlocks the existing REST routes (`/api/workouts`, `/api/goals`, `/api/body-measurements`, `/api/peloton/*`) so scripts and agents can use them without a NextAuth session cookie. The middleware (`middleware.ts`) accepts either a session OR the bearer token for `/api/*` paths.

### Files

- `src/app/api/mcp/[transport]/route.ts` - tool definitions + `withMcpAuth` wrapper
- `src/lib/api-auth.ts` - `extractBearerToken`, `isValidApiToken`, `hasBearerSecret` (timing-safe compare)
- `src/lib/oauth.ts` + `src/app/.well-known/*`, `src/app/api/oauth/*`, `src/app/oauth/authorize/page.tsx` - OAuth server
- `middleware.ts` - lets `/api/mcp` through (route polices itself) and accepts bearer tokens for `/api/*`

### Design Choices

- **Raw rows, no precomputed aggregates.** Tools return database rows so the agent can do its own analysis. Add aggregating tools only if a specific agent struggles with the raw-data path.
- **Sync tools call the sync library directly** (`runPelotonSync`), not the REST route, so no token is forwarded in an outbound request.
- **Streamable HTTP only**, SSE transport disabled (`disableSse: true`) because we do not run Redis. The streamable HTTP transport is stateless and works on Vercel without external state.
- **Token length floor of 16 chars** enforced in `hasBearerSecret` so an empty / unset env never passes.
- **OAuth redirect URIs are allow-listed by host** (`OAUTH_REDIRECT_HOSTS`, default claude.ai, claude.com, chatgpt.com, localhost) so a stranger can't register a client that receives your authorization code.
