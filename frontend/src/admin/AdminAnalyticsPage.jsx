import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AdminLayout from './AdminLayout.jsx'
import AnalyticsHeatmap from './AnalyticsHeatmap.jsx'
import AnalyticsRangeForm from './AnalyticsRangeForm.jsx'
import AnalyticsRouteList from './AnalyticsRouteList.jsx'
import { buildHeatmap, validateRange } from './analyticsLogic.js'
import { useAnalytics } from './useAnalytics.js'

const EMPTY = { from: '', to: '' }

// Read-only analytics (reads D3): per-route figures and a weekday x hour table.
// The default range comes from the server's response ("from"/"to"), never the PC clock.
export default function AdminAnalyticsPage() {
  const { routes, demand, updating, load, retry, isBusy } = useAnalytics()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const fromRef = useRef(null)
  const toRef = useRef(null)

  // Fill the inputs with the range the server used, unless the admin typed meanwhile.
  const fillIfEmpty = useCallback((range) => {
    if (range) setValues((v) => (v.from === '' && v.to === '' ? { from: range.from, to: range.to } : v))
  }, [])

  useEffect(() => {
    void (async () => {
      fillIfEmpty(await load('', '', { initial: true }))
    })()
  }, [load, fillIfEmpty])

  const handleChange = useCallback((field, value) => {
    setValues((v) => ({ ...v, [field]: value }))
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e))
  }, [])

  async function handleApply(e) {
    e.preventDefault()
    if (isBusy()) return
    // A half-typed date reads as '' in a date input; badInput tells it apart from empty.
    const from = fromRef.current?.validity?.badInput ? '?' : values.from
    const to = toRef.current?.validity?.badInput ? '?' : values.to
    const check = validateRange(from, to)
    setErrors(check.errors)
    if (!check.ok) {
      ;(check.errors.from ? fromRef : toRef).current?.focus()
      return
    }
    fillIfEmpty(await load(from, to))
  }

  async function handleReset() {
    if (isBusy()) return
    setValues(EMPTY)
    setErrors({})
    fillIfEmpty(await load('', ''))
  }

  const heatmap = useMemo(() => buildHeatmap(demand.data?.cells), [demand.data])

  return (
    <AdminLayout title="Analytics">
      <div className="admin-page admin-page--wide">
        <p className="analytics-caveat">
          If synthetic test data is loaded, these numbers describe that data, not real trips.
        </p>

        <section className="admin-section" aria-labelledby="analytics-range-heading">
          <h2 id="analytics-range-heading">Date range</h2>
          <AnalyticsRangeForm
            values={values}
            errors={errors}
            onChange={handleChange}
            onApply={handleApply}
            onReset={handleReset}
            fromRef={fromRef}
            toRef={toRef}
          />
        </section>

        <div className="admin-live" aria-live="polite">
          {updating && <p className="analytics-updating">Updating…</p>}
        </div>

        <section className="admin-section" aria-labelledby="analytics-routes-heading">
          <h2 id="analytics-routes-heading">Routes</h2>
          <p className="analytics-note">
            Delay means actual trip duration minus predicted ETA, measured only on completed trips that had
            a prediction. Trips without a route are not listed here.
          </p>
          <SectionStatus section={routes} what="route figures" onRetry={() => retry('routes')} />
          {routes.data && (
            <>
              <RangeLine data={routes.data} />
              <AnalyticsRouteList routes={routes.data.routes} />
            </>
          )}
        </section>

        <section className="admin-section" aria-labelledby="analytics-demand-heading">
          <h2 id="analytics-demand-heading">Trips by weekday and hour</h2>
          <p className="analytics-note">
            Hours are campus local time (24-hour clock). Days run Monday to Sunday.
          </p>
          <SectionStatus section={demand} what="the demand table" onRetry={() => retry('demand')} />
          {demand.data && (
            <>
              <RangeLine data={demand.data} />
              {demand.data.cells.length === 0 ? (
                <p>No trips with time data in this range.</p>
              ) : (
                <>
                  <AnalyticsHeatmap heatmap={heatmap} />
                  <p className="analytics-total">
                    Total in table: {heatmap.total} {heatmap.total === 1 ? 'trip' : 'trips'}.
                  </p>
                </>
              )}
              {demand.data.tripsWithoutContext > 0 && (
                <p className="admin-notice analytics-gap">
                  {demand.data.tripsWithoutContext === 1
                    ? '1 trip in this range has no time data (recorded before the time columns existed) and is not in this table.'
                    : `${demand.data.tripsWithoutContext} trips in this range have no time data (recorded before the time columns existed) and are not in this table.`}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}

// Loading text, plus the section's load/Apply error in its own live region (always
// rendered so the error is announced) and a Retry button outside it.
function SectionStatus({ section, what, onRetry }) {
  return (
    <>
      <div className="admin-live" aria-live="polite">
        {section.error && (
          <p className="admin-notice admin-notice--error">
            {section.data ? `Could not update this section. ${section.error}` : section.error}
          </p>
        )}
      </div>
      {section.error && section.canRetry && (
        <div className="admin-actions">
          <button type="button" onClick={onRetry}>
            Retry {what}
          </button>
        </div>
      )}
      {section.phase === 'loading' && <p>Loading {what}…</p>}
    </>
  )
}

function RangeLine({ data }) {
  return (
    <p className="analytics-range">
      Showing {data.from} to {data.to} (campus dates).
    </p>
  )
}
