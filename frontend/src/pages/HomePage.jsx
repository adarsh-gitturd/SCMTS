import { Link, Navigate } from 'react-router-dom'
import { homePathFor } from '../auth/homePath.js'
import { useAuth } from '../auth/useAuth.js'
import LiveMap from '../map/LiveMap.jsx'

export default function HomePage() {
  const { user, logout } = useAuth()

  // Roles with their own home (driver) go there before LiveMap mounts (no WebSocket).
  const home = homePathFor(user?.role)
  if (home !== '/') return <Navigate to={home} replace />

  return (
    <main className="app">
      <header className="app-header">
        <h1>
          Hello, {user.name} ({user.role})
        </h1>
        <div className="app-header__actions">
          {user.role === 'student' && (
            <Link to="/history" className="nav-link">
              Trip history
            </Link>
          )}
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>
      <LiveMap />
    </main>
  )
}
