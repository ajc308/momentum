// Hosts OAuth clients may redirect back to after consent. Shared by the
// OAuth server (src/lib/oauth.ts) and the CSP form-action list in
// next.config.ts — the consent form's redirect is subject to form-action,
// so the two must match. Dependency-free so next.config.ts can import it.
export const DEFAULT_REDIRECT_HOSTS = 'claude.ai,claude.com,chatgpt.com,localhost,127.0.0.1'

export const LOCAL_HOSTS = ['localhost', '127.0.0.1']

export function oauthRedirectHosts(env: string | undefined = process.env.OAUTH_REDIRECT_HOSTS): string[] {
  return (env || DEFAULT_REDIRECT_HOSTS).split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
}

/** CSP sources for those hosts: https everywhere, any port over http for local apps (Codex, Claude Code). */
export function oauthRedirectCspSources(env?: string): string[] {
  return oauthRedirectHosts(env).flatMap(host =>
    LOCAL_HOSTS.includes(host) ? [`http://${host}:*`, `https://${host}:*`] : [`https://${host}`])
}
