import { memo } from 'react'
import FleetAge from './FleetAge.jsx'
import { busFlags, FLAG_NO_LIVE, formatPosition, formatSpeed, statusLabel, statusSymbol } from './fleetLogic.js'

const updatedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

// One bus. Memoized: the bus object keeps its identity while its visible fields are
// unchanged (stabilize), so a tick or an unchanged poll does not re-render it.
// Everything from the server is rendered as React text.
function FleetBusCard({ bus }) {
  const { live } = bus
  const flags = busFlags(bus)

  return (
    <li className="fleet-card">
      <h3 className="fleet-card__title">
        Bus {bus.bus_id} · {bus.plate}
      </h3>
      <dl className="fleet-card__fields">
        <dt>Route</dt>
        <dd>{bus.route_name ?? 'No route'}</dd>
        <dt>Driver</dt>
        <dd>{bus.driver_name ?? 'No driver'}</dd>
        {live === null ? (
          <>
            <dt>Live data</dt>
            <dd>{FLAG_NO_LIVE}</dd>
          </>
        ) : (
          <>
            <dt>Status</dt>
            <dd>
              <span className={`fleet-status fleet-status--${live.status}`}>
                <span aria-hidden="true">{statusSymbol(live.status)} </span>
                {statusLabel(live.status)}
              </span>
            </dd>
            <dt>Speed</dt>
            <dd>{formatSpeed(live.speed)}</dd>
            <dt>Position</dt>
            <dd>{formatPosition(live.lat, live.lng)}</dd>
            <dt>Last update</dt>
            <dd>
              <FleetAge updatedAt={live.updated_at} status={live.status} />
              <span className="fleet-card__secondary">{updatedFormat.format(new Date(live.updated_at))}</span>
            </dd>
          </>
        )}
      </dl>
      {flags.length > 0 && (
        <ul className="fleet-flags" aria-label="Problems">
          {flags.map((f) => (
            <li key={f}>
              <span aria-hidden="true">⚑ </span>
              {f}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default memo(FleetBusCard)
