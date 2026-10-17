import { Navigate } from 'react-router-dom'
import { homePathFor } from '../auth/homePath.js'
import { useAuth } from '../auth/useAuth.js'
import DriverRoute from './DriverRoute.jsx'

export default function DriverPage() {
  const { user, logout } = useAuth()

  // Drivers only; anyone else goes to their own home. Checked before DriverRoute
  // mounts, so non-drivers never call /driver/route.
  if (user?.role !== 'driver') return <Navigate to={homePathFor(user?.role)} replace />

  return (
    <main className="app driver-page">
      <header className="app-header">
        <h1>
          Hello, {user.name} ({user.role})
        </h1>
        <div className="app-header__actions">
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>
      <DriverRoute />
    </main>
  )
}
