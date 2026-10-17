// Single place for fetch calls. Paths go through the Vite dev proxy (/auth, /api).

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status // 0 = network error, backend not reachable
  }
}

let authToken = null
let onUnauthorized = null

export function setAuthToken(token) {
  authToken = token
}

// Called on a 401 from /api (expired or invalid token). Not used for /auth/login,
// where 401 just means wrong credentials.
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authToken) headers.Authorization = `Bearer ${authToken}`

  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network error')
  }

  // Backend error shape: { "error": "message" }. Body may be empty (204) or not JSON (proxy error).
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/api/') && onUnauthorized) {
      onUnauthorized()
    }
    const message = typeof data?.error === 'string' ? data.error : `request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return data
}

export function login(email, password) {
  return request('POST', '/auth/login', { email, password })
}

export const api = {
  get: (path) => request('GET', `/api${path}`),
  post: (path, body) => request('POST', `/api${path}`, body),
  patch: (path, body) => request('PATCH', `/api${path}`, body),
  put: (path, body) => request('PUT', `/api${path}`, body),
  // 204 has no body: resolves to null.
  delete: (path) => request('DELETE', `/api${path}`),
}
