import { Navigate, Route, Routes } from 'react-router-dom'
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
      <Route path="*"element={<Navigate to="/" replace />} />
    </Routes>
  )
}
