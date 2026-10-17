import { memo, useEffect, useMemo, useState } from 'react'
import { STATUS_INFO } from '../map/busIcons.js'
import { formatDistance, nearbyRows, sameNearby, speedText } from './advisorLogic.js'

const STALE_CHECK_MS = 5000

// Live buses nearest to the reference stop. Re-renders with every live update, but
// the rows are only recomputed in the memo and the list below only re-renders when
// something visible changed (sameNearby).
export default function NearbyBuses({ buses, reference, busRoutes, routeNames, onShowBus }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALE_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  const computed = useMemo(
    () => (reference ? nearbyRows(buses, reference.point, busRoutes, routeNames, now) : null),
    [buses, reference, busRoutes, routeNames, now],
  )

  // Keep the previous object while it looks the same, so NearbyList's memo holds.
  const [shown, setShown] = useState(computed)
  if (shown !== computed && (shown === null || computed === null || !sameNearby(shown, computed))) {
    setShown(computed)
  }

  if (!reference) {
    return <p className="nearby__hint">Find a bus to see the buses near your boarding stop.</p>
  }

  const from = reference.kind === 'board' ? 'your boarding stop' : 'the stop you are at'
  return (
    <details className="nearby" open>
      <summary>
        <h2>
          Buses near {reference.label} ({from})
        </h2>
      </summary>
      <p className="nearby__note">Straight-line distance from each bus to {reference.label}.</p>
      {shown && <NearbyList view={shown} onShowBus={onShowBus} />}
    </details>
  )
}

const NearbyList = memo(function NearbyList({ view, onShowBus }) {
  return (
    <>
      {view.rows.length === 0 ? (
        <p>No live buses right now.</p>
      ) : (
        <ul className="nearby__list">
          {view.rows.map((r) => {
            const info = STATUS_INFO[r.status] ?? STATUS_INFO.unknown
            return (
              <li key={r.bus_id}>
                <button type="button" className="nearby__item" onClick={() => onShowBus(r.bus_id)}>
                  <span className="nearby__title">
                    Bus {r.bus_id} · {r.route}
                  </span>
                  <span>
                    <span aria-hidden="true">{info.glyph} </span>
                    {info.label} · {speedText(r.speed)} · {formatDistance(r.distance_m)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {view.hiddenStale > 0 && (
        <p className="nearby__note">
          {view.hiddenStale} {view.hiddenStale === 1 ? 'bus is' : 'buses are'} not reporting (hidden).
        </p>
      )}
    </>
  )
})
