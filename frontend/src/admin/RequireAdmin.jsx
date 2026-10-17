import { Navigate } from 'react-router-dom'
import { homePathFor } from '../auth/homePath.js'
import { useAuth } from '../auth/useAuth.js'

// Admins only; anyone else goes to their own home (one hop, no loop).
// Checked before the page mounts, so non-admins never call /admin endpoints.
export default function RequireAdmin({ children }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to={homePathFor(user?.role)} replace />
  return children
}
