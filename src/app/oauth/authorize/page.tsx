import { OAuthRequestError, validateAuthorizeRequest } from '@/lib/oauth'
import { LogoMark, Wordmark } from '@/components/Logo'

export const dynamic = 'force-dynamic'

/**
 * OAuth consent screen. Middleware only lets signed-in users (i.e.
 * ALLOWED_EMAIL) reach this page; approving posts to /api/oauth/authorize.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  )

  let clientName: string
  try {
    clientName = (await validateAuthorizeRequest(params)).name
  } catch (error) {
    const message = error instanceof OAuthRequestError ? error.message : 'Invalid authorization request'
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold">Can&apos;t connect</h1>
        <p className="text-sm text-danger">{message}</p>
      </Shell>
    )
  }

  const redirectHost = new URL(params.redirect_uri!).host
  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold">Connect {clientName}?</h1>
      <p className="text-sm text-fg-muted">
        <strong>{clientName}</strong> (returning to <strong>{redirectHost}</strong>) is asking for access to
        your fitness data: workouts, weigh-ins and Apple Health metrics. It will be able to read them, log
        workouts and weight, and trigger Peloton syncs.
      </p>
      <p className="text-xs text-fg-subtle">
        Only approve if you just started connecting this app yourself.
      </p>
      <form method="post" action="/api/oauth/authorize" className="flex gap-3 pt-2">
        <input type="hidden" name="client_id" value={params.client_id} />
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        <input type="hidden" name="response_type" value={params.response_type} />
        <input type="hidden" name="code_challenge" value={params.code_challenge} />
        <input type="hidden" name="code_challenge_method" value={params.code_challenge_method} />
        {params.state != null && <input type="hidden" name="state" value={params.state} />}
        <button
          type="submit"
          name="decision"
          value="approve"
          className="btn-volt"
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="btn-ghost"
        >
          Deny
        </button>
      </form>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-md space-y-4 p-8">
        <div className="flex items-center gap-2.5 pb-2">
          <LogoMark className="h-8 w-8" />
          <Wordmark className="text-base" />
        </div>
        {children}
      </div>
    </div>
  )
}
