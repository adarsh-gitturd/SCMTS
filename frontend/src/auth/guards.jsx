import { Navigate } from 'react-router-dom'
import { homePathFor } from './homePath.js'
import { useAuth } from './useAuth.js'

// Logged-out users go to /login.
export function RequireAuth({ children }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return children
}

// Logged-in users skip /login.
export function RedirectIfAuthed({ children }) {
  const { token, user } = useAuth()
  if (token) return <Navigate to={homePathFor(user?.role)} replace />
  return children
}
