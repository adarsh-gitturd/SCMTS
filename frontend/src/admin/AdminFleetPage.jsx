import AdminLayout from './AdminLayout.jsx'
import FleetBusCard from './FleetBusCard.jsx'
import FleetSummary from './FleetSummary.jsx'
import { useFleet } from './useFleet.js'

// Read-only fleet overview (reads D2). Cards, not a table: they stack on a phone
// and keep each label next to its value.
export default function AdminFleetPage() {
  const { state, retry } = useFleet()
  const { phase, buses } = state

  return (
    <AdminLayout title="Fleet">
      <div className="admin-page admin-page--wide">
        {/* Only the refresh failure / recovery is announced; its text does not change
            while polls keep failing, so it is announced once. */}
        <div className="admin-live" aria-live="polite">
          {state.refreshFailed && (
            <p className="admin-notice admin-notice--error">
              Could not refresh. Showing data from {state.lastOkAt}.
            </p>
          )}
          {!state.refreshFailed && state.recovered && <p className="visually-hidden">Data refreshed.</p>}
        </div>

        {phase === 'loading' && <p>Loading buses…</p>}

        {phase === 'error' && (
          <>
            <p className="admin-notice admin-notice--error">{state.error}</p>
            {state.canRetry && (
              <div className="admin-actions">
                <button type="button" onClick={retry}>
                  Retry
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'ready' && (
          <>
            <section className="admin-section">
              <h2>Summary</h2>
              <FleetSummary buses={buses} />
            </section>

            <section className="admin-section">
              <h2>Buses ({buses.length})</h2>
              {buses.length === 0 ? (
                <p>No buses yet.</p>
              ) : (
                <ul className="fleet-cards">
                  {buses.map((bus) => (
                    <FleetBusCard key={bus.bus_id} bus={bus} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
