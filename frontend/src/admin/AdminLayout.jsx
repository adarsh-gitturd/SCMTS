import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'

// Shared admin header + nav. NavLink sets aria-current="page" on the current link.
export default function AdminLayout({ title, children }) {
  const { user, logout } = useAuth()

  return (
    <main className="app admin">
      <header className="app-header">
        <div className="admin-header__titles">
          <h1>{title}</h1>
          <p className="admin-header__hello">Hello, {user?.name} (admin)</p>
        </div>
        <div className="app-header__actions">
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>
      <nav className="admin-nav" aria-label="Admin">
        <NavLink to="/admin/stops">Stops</NavLink>
        <NavLink to="/admin/routes">Routes</NavLink>
        <NavLink to="/admin/fleet">Fleet</NavLink>
        <NavLink to="/admin" end>
          Admin home
        </NavLink>
      </nav>
      <div className="admin-body">{children}</div>
    </main>
  )
}
