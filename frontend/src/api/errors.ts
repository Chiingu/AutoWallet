// FastAPI uses either a string detail or a structured { message, code } detail.
// Proxies can also return null, HTML, or another shape; retain a useful fallback.
export function apiErrorDetail(payload: unknown, fallback: string): { message: string; code: string | null } {
  const detail: unknown = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null
  if (typeof detail === 'string') return { message: detail || fallback, code: null }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return {
      message: 'message' in detail && typeof detail.message === 'string' && detail.message ? detail.message : fallback,
      code: 'code' in detail && typeof detail.code === 'string' ? detail.code : null,
    }
  }
  return { message: fallback, code: null }
}
