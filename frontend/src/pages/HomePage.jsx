import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import LiveMap from '../map/LiveMap.jsx'

export default function HomePage() {
  const { user, logout } = useAuth()

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
