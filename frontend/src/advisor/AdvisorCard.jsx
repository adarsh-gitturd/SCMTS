import { memo, useEffect, useState } from 'react'
import { STATUS_INFO } from '../map/busIcons.js'
import { stopLabel } from '../trip/tripLogic.js'
import { cardView, clockHHMM, etaText, formatDistance, liveStatus, routeLabel } from './advisorLogic.js'

const STALE_CHECK_MS = 5000

// Recommended bus + alternatives for the current trip result (state.result).
// liveTop = the top bus from useLiveBuses (or undefined); it only changes when that
// bus sends a new frame. The polite region holds only the result summary, so it is
// announced once per result, not on every live update.
function AdvisorCard({ tripState, routeNames, stopsById, liveTop, onReset, onShowBus }) {
  const view = cardView(tripState)
  const result = tripState.result
  const top = view === 'result' ? result.recommendations[0] : null
  const others = view === 'result' ? result.recommendations.slice(1) : []

  return (
    <div className={view === 'none' ? undefined : 'advisor'}>
      <div aria-live="polite">
        {view === 'empty' && (
          <>
            <h2>No bus is available right now</h2>
            <p>Buses may be on a break or not on a route to your stop. Try again in a minute.</p>
          </>
        )}
        {top && (
          <>
            <h2>Recommended bus</h2>
            <p className="advisor__top">
              Bus {top.bus_id} · {routeLabel(routeNames, top.route_id)}
            </p>
            <p>Board at {stopLabel(stopsById, top.board_stop_id)}</p>
            <p>
              ETA {etaText(top.eta_minutes)}, bus {formatDistance(top.distance_m)} from the stop{' '}
              <span className="advisor__asof">(as of {clockHHMM(result.received_at)})</span>
            </p>
          </>
        )}
      </div>

      {top && <TopLive bus={liveTop} busId={top.bus_id} onShowBus={onShowBus} />}

      {others.length > 0 && (
        <>
          <h3>Other options</h3>
          <ol className="advisor__others">
            {others.map((r) => (
              <li key={`${r.rank}-${r.bus_id}`} value={r.rank}>
                Bus {r.bus_id} · {routeLabel(routeNames, r.route_id)} · board at {stopLabel(stopsById, r.board_stop_id)} ·
                ETA {etaText(r.eta_minutes)} · {formatDistance(r.distance_m)}
              </li>
            ))}
          </ol>
        </>
      )}

      {view !== 'none' && (
        <button type="button" className="link-button" onClick={onReset}>
          Start over
        </button>
      )}
    </div>
  )
}

// Current live status of the top bus. Ticks on its own so staleness shows even
// when no frames arrive. Only a status change is put in a (separate) live region.
function TopLive({ bus, busId, onShowBus }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALE_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  const live = liveStatus(bus, now, STATUS_INFO)

  return (
    <>
      <p className={`advisor__live advisor__live--${live.kind}`}>
        <span aria-hidden="true">{live.glyph} </span>
        Now: {live.text}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {live.kind === 'changed' ? `Bus ${busId}: ${live.text}` : ''}
      </p>
      <button type="button" className="link-button" onClick={() => onShowBus(busId)} disabled={!bus}>
        Show bus {busId} on map
      </button>
    </>
  )
}

export default memo(AdvisorCard)
