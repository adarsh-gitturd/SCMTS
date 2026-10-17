import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './admin/AdminLayout.jsx'
import AdminLoading from './admin/AdminLoading.jsx'
import ChunkErrorBoundary from './admin/ChunkErrorBoundary.jsx'
import RequireAdmin from './admin/RequireAdmin.jsx'
import { RedirectIfAuthed, RequireAuth } from './auth/guards.jsx'
import DriverPage from './driver/DriverPage.jsx'
import HistoryPage from './history/HistoryPage.jsx'
import HomePage from './pages/HomePage.jsx'
import LoginPage from './pages/LoginPage.jsx'

// Admin pages are split into their own chunks. The import only starts when the page
// renders, i.e. after RequireAdmin passed, so non-admins never download them.
// A failed import is renamed ChunkLoadError so ChunkErrorBoundary can tell it apart.
function lazyPage(load) {
  return lazy(() =>
    load().catch((cause) => {
      const error = new Error('Could not load page chunk', { cause })
      error.name = 'ChunkLoadError'
      throw error
    }),
  )
}

const AdminHome = lazyPage(() => import('./admin/AdminHome.jsx'))
const AdminStopsPage = lazyPage(() => import('./admin/AdminStopsPage.jsx'))
const AdminRoutesPage = lazyPage(() => import('./admin/AdminRoutesPage.jsx'))
const AdminFleetPage = lazyPage(() => import('./admin/AdminFleetPage.jsx'))
const AdminAnalyticsPage = lazyPage(() => import('./admin/AdminAnalyticsPage.jsx'))

// Loading and error states keep the admin header + nav visible.
// NOTE: `title` must match the title the page passes to its own AdminLayout,
// otherwise the header text changes when the page arrives.
function AdminPage({ title, children }) {
  return (
    <ChunkErrorBoundary title={title}>
      <Suspense
        fallback={
          <AdminLayout title={title}>
            <AdminLoading />
          </AdminLayout>
        }
      >
        {children}
      </Suspense>
    </ChunkErrorBoundary>
  )
}

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
              <AdminPage key="/admin" title="Admin">
                <AdminHome />
              </AdminPage>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/stops"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage key="/admin/stops" title="Stops">
                <AdminStopsPage />
              </AdminPage>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/routes"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage key="/admin/routes" title="Routes">
                <AdminRoutesPage />
              </AdminPage>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/fleet"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage key="/admin/fleet" title="Fleet">
                <AdminFleetPage />
              </AdminPage>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/analytics"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage key="/admin/analytics" title="Analytics">
                <AdminAnalyticsPage />
              </AdminPage>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
