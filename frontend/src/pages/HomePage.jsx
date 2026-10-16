import { useAuth } from '../auth/useAuth.js'

export default function HomePage() {
  const { user, logout } = useAuth()

  return (
    <main className="page">
      <div className="card">
        <h1>
          Hello, {user.name} ({user.role})
        </h1>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
    </main>
  )
}
