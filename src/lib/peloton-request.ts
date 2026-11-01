// Authenticated calls to Peloton's unofficial APIs (REST and the GraphQL
// gateway) using the login stored by the sync. Shared by the Stack and
// class-catalog code.

import { pelotonHeaders, refreshPelotonCredential } from '@/lib/peloton'
import { getValidCredential } from '@/lib/peloton-sync'

export class AuthRejected extends Error {}
export const AUTH_ERROR = /unauthori[sz]ed|unauthenticated|forbidden|permission denied|insufficient scope/i

/**
 * Run a Peloton request with the stored login. Tokens issued before the
 * stack scope was requested get refused (401/403, or an auth error in a
 * GraphQL 200), so on that we log in again once and retry.
 */
export async function withCredential<T>(call: (headers: Record<string, string>) => Promise<Response>, read: (res: Response) => Promise<T>): Promise<T> {
  const attempt = async (sessionId: string) => {
    const res = await call({ ...pelotonHeaders(sessionId), 'Peloton-Platform': 'web' })
    if (res.status === 401 || res.status === 403) throw new AuthRejected()
    return read(res)
  }
  try {
    return await attempt((await getValidCredential()).sessionId)
  } catch (error) {
    if (!(error instanceof AuthRejected)) throw error
    return attempt((await refreshPelotonCredential()).sessionId)
  }
}
