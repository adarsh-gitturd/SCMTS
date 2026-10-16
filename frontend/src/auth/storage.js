// The one place that decides where the login is kept: sessionStorage
// (survives a refresh, cleared when the tab closes).
const KEY = 'scmts.auth'

// Reads the JWT exp claim (seconds). Decoding only; the signature is checked by the backend.
function tokenExpiry(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

export function isTokenValid(token) {
  const exp = typeof token === 'string' ? tokenExpiry(token) : null
  return exp !== null && exp * 1000 > Date.now()
}

// Returns {token, user} or null. Drops malformed or expired logins.
export function loadAuth() {
  let saved
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY))
  } catch {
    saved = null
  }
  const user = saved?.user
  if (!saved || !isTokenValid(saved.token) || !user || typeof user.name !== 'string' || typeof user.role !== 'string') {
    clearAuth()
    return null
  }
  return { token: saved.token, user: { id: user.id, name: user.name, role: user.role } }
}

export function saveAuth(auth) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(auth))
  } catch {
    // Storage unavailable (e.g. private mode quota): stay logged in for this page only.
  }
}

export function clearAuth() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}
