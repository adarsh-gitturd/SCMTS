import { Navigate, Route, Routes } from 'react-router-dom'
import AdminFleetPage from './admin/AdminFleetPage.jsx'
import AdminHome from './admin/AdminHome.jsx'
import AdminRoutesPage from './admin/AdminRoutesPage.jsx'
import AdminStopsPage from './admin/AdminStopsPage.jsx'
import RequireAdmin from './admin/RequireAdmin.jsx'
import { RedirectIfAuthed, RequireAuth } from './auth/guards.jsx'
import DriverPage from './driver/DriverPage.jsx'
import HistoryPage from './history/HistoryPage.jsx'
import HomePage from './pages/HomePage.jsx'
import LoginPage from './pages/LoginPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/driver"
        element={
          <RequireAuth>
            <DriverPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminHome />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/stops"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminStopsPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/routes"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminRoutesPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/fleet"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminFleetPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route path="*"element={<Navigate to="/" replace />} />
    </Routes>
  )
}
