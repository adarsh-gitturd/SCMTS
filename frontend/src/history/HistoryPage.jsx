import { Link, Navigate } from 'react-router-dom'
import { homePathFor } from '../auth/homePath.js'
import { useAuth } from '../auth/useAuth.js'
import TripCard from './TripCard.jsx'
import { useTripHistory } from './useTripHistory.js'

export default function HistoryPage() {
  const { user, logout } = useAuth()
  const { state, submitRating, retry } = useTripHistory()

  // Students only; anyone else goes straight to their own home (one hop, no loop).
  if (user?.role !== 'student') return <Navigate to={homePathFor(user?.role)} replace />

  const { phase, error, trips, routesById, stopsById, atLimit } = state

  return (
    <main className="app">
      <header className="app-header">
        <h1>Trip history</h1>
        <div className="app-header__actions">
          <Link to="/" className="nav-link">
            Back to map
          </Link>
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <section className="history">
        {phase === 'loading' && <p>Loading your trips…</p>}

        {phase === 'error' && (
          <div className="history-error">
            <p className="error" aria-live="polite">
              {error}
            </p>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        )}

        {phase === 'ready' && trips.length === 0 && (
          <p className="history-empty">No trips yet. Find a bus on the map first.</p>
        )}

        {phase === 'ready' && trips.length > 0 && (
          <>
            {atLimit && <p className="history-note">Showing your latest 50 trips</p>}
            <ol className="trip-list">
              {trips.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  routesById={routesById}
                  stopsById={stopsById}
                  onRate={submitRating}
                />
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  )
}
