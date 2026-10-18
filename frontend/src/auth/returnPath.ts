export function safeReturnPath(requestedPath: string | null): string {
  if (!requestedPath?.startsWith('/') || requestedPath.startsWith('//') || requestedPath.includes('\\')) {
    return '/dashboard'
  }
  try {
    const url = new URL(requestedPath, window.location.origin)
    if (url.origin !== window.location.origin) return '/dashboard'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/dashboard'
  }
}

export function loginPath(returnTo: string | null): string {
  return `/login?redirect=${encodeURIComponent(safeReturnPath(returnTo))}`
}

const googleReturnKey = 'autowallet_google_return'
const googleReturnLifetime = 10 * 60 * 1000

export function rememberGoogleReturnPath(returnTo: string | null) {
  try {
    sessionStorage.setItem(googleReturnKey, JSON.stringify({ path: safeReturnPath(returnTo), createdAt: Date.now() }))
  } catch { /* Sign-in still works when browser storage is unavailable. */ }
}

export function clearGoogleReturnPath() {
  try { sessionStorage.removeItem(googleReturnKey) } catch { /* Browser storage may be unavailable. */ }
}

export function readGoogleReturnPath(): string {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(googleReturnKey) ?? 'null')
    if (saved && typeof saved === 'object' && 'path' in saved && typeof saved.path === 'string' &&
        'createdAt' in saved && typeof saved.createdAt === 'number' &&
        Date.now() >= saved.createdAt && Date.now() - saved.createdAt <= googleReturnLifetime) {
      return safeReturnPath(saved.path)
    }
  } catch { /* Ignore expired or malformed return destinations. */ }
  clearGoogleReturnPath()
  return '/dashboard'
}
