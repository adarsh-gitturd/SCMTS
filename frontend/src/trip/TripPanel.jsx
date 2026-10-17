import { useMemo } from 'react'
import { sortStopsByName } from './tripLogic.js'

function buttonText(state) {
  switch (state.phase) {
    case 'locating':
      return 'Finding your location...'
    case 'submitting':
      return 'Finding buses...'
    case 'success':
      return `Trip #${state.result.trip_id} started`
    default:
      return 'Find my bus'
  }
}

// Destination picker. The result is shown by AdvisorCard (a sibling).
// destId, originId and the trip hook live in LiveMap so the map and the sibling panels can use them.
export default function TripPanel({ stops, destId, onDestinationChange, originId, onOriginChange, trip }) {
  const { state, submit, reset, retryLocation } = trip
  const sorted = useMemo(() => sortStopsByName(stops), [stops])
  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])

  const manual = state.originMode === 'manual'
  const busy = state.phase === 'locating' || state.phase === 'submitting'
  const originStop = manual && originId !== null ? (byId.get(originId) ?? null) : null
  const sameStop = manual && originId !== null && originId === destId
  const canSubmit = destId !== null && !busy && state.phase !== 'success' && (!manual || (originStop !== null && !sameStop))

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    submit(destId, originStop)
  }

  function handleOriginChange(e) {
    onOriginChange(e.target.value === '' ? null : Number(e.target.value))
    reset()
  }

  const options = sorted.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  ))

  return (
    <form className="trip-panel" onSubmit={handleSubmit}>
      <label>
        Where to?
        <select
          value={destId === null ? '' : String(destId)}
          onChange={(e) => onDestinationChange(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Choose a stop</option>
          {options}
        </select>
      </label>

      {manual && (
        <>
          {state.notice && <p className="trip-panel__notice">{state.notice}</p>}
          <label>
            I&apos;m at
            <select value={originId === null ? '' : String(originId)} onChange={handleOriginChange}>
              <option value="">Choose your stop</option>
              {options}
            </select>
          </label>
          {sameStop && <p className="error">You are already at that stop. Choose a different destination.</p>}
          <button type="button" className="link-button" onClick={retryLocation} disabled={busy}>
            Use my location instead
          </button>
        </>
      )}

      <button type="submit" disabled={!canSubmit}>
        {buttonText(state)}
      </button>

      {state.phase === 'error' && state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}
