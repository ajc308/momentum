/** Bound both the upstream request and reading its response body. */
export function integrationFetch(input: string, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(15_000)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}
