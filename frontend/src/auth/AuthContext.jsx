import { useCallback, useEffect, useMemo, useState } from 'react'
import { login as apiLogin, setAuthToken, setUnauthorizedHandler } from '../api/client.js'
import { clearAuth, isTokenValid, loadAuth, saveAuth } from './storage.js'
import { AuthContext } from './useAuth.js'

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const saved = loadAuth() // drops expired tokens on startup
    setAuthToken(saved?.token ?? null)
    return saved
  })

  const logout = useCallback(() => {
    clearAuth()
    setAuthToken(null)
    setAuth(null)
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password)
    const u = data?.user
    if (!isTokenValid(data?.token) || !u || typeof u.name !== 'string' || typeof u.role !== 'string') {
      throw new Error('unexpected login response')
    }
    const next = { token: data.token, user: { id: u.id, name: u.name, role: u.role } }
    saveAuth(next)
    setAuthToken(next.token)
    setAuth(next)
    return next.user
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const value = useMemo(
    () => ({ token: auth?.token ?? null, user: auth?.user ?? null, login, logout }),
    [auth, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
