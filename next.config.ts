import type { NextConfig } from "next"
import { oauthRedirectCspSources } from "./src/lib/oauth-hosts"

const isProd = process.env.NODE_ENV === 'production'

/**
 * Content Security Policy (F-10).
 *
 * - default-src 'self': nothing loads cross-origin by default.
 * - script-src: inline scripts are needed by Next.js (hydration). Next
 *   App Router doesn't expose a nonce hook for this config layer
 *   without per-request middleware rewriting, so we accept
 *   'unsafe-inline' for now and rely on framework-level escaping.
 * - style-src 'unsafe-inline': Tailwind injects inline <style>.
 * - img-src includes data: for inline SVG/data URLs from Recharts.
 * - connect-src includes the Peloton API origin we call from the
 *   server (no impact on the browser, but documents the surface).
 * - frame-ancestors 'none': defence-in-depth alongside X-Frame-Options.
 * - form-action also lists the OAuth redirect hosts: approving on the
 *   consent page POSTs here and then redirects to the MCP client, and
 *   browsers apply form-action to that redirect too.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "worker-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' https://api.onepeloton.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' https://accounts.google.com ${oauthRedirectCspSources().join(' ')}`,
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // F-10: HSTS — 2 years, include subdomains, preload-eligible.
          // Only emitted in production so localhost over http still works.
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
          // F-10: baseline CSP. Report-only on first deploy if you want
          // to verify nothing breaks; switch the key name back to
          // 'Content-Security-Policy' once green.
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
