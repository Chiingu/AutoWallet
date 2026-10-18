// Keep timeouts consistent while allowing callers to cancel on navigation.
// A timeout does not confirm whether a write reached the server.
export function apiFetch(input: RequestInfo | URL, options: RequestInit = {}, timeoutMs: number | null = 30000) {
  // Persistent streams use an idle watchdog instead of a total request limit.
  if (timeoutMs === null) return fetch(input, options)
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(input, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  })
}
