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
        <button type="button" onClick={logout}>
          Logout
        </button>
      </header>
      <LiveMap />
    </main>
  )
}
