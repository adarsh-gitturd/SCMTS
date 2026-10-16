import { createContext, useContext } from 'react'

// Value: { token, user: {id, name, role} | null, login(email, password), logout() }
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
