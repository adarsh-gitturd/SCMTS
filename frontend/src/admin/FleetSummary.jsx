import { useFleetClock } from './fleetClock.js'
import { ageSeconds, displayAge, statusLabel, statusSymbol, summarize, SUMMARY_STATUSES } from './fleetLogic.js'

// Counts above the list. Re-renders on the tick because "Not reporting" depends on age.
// Not a live region on purpose: it changes every few seconds.
export default function FleetSummary({ buses }) {
  const { now, serverTime, fetchedAt } = useFleetClock()
  const ageFn = (bus) =>
    serverTime === null ? null : displayAge(ageSeconds(serverTime, bus.live.updated_at), fetchedAt, now)
  const sum = summarize(buses, ageFn)

  return (
    <div className="fleet-summary">
      <p className="fleet-summary__total">{sum.total === 1 ? '1 bus' : `${sum.total} buses`}</p>
      <ul className="fleet-summary__list">
        {SUMMARY_STATUSES.map((st) => (
          <li key={st}>
            <span aria-hidden="true">{statusSymbol(st)} </span>
            {statusLabel(st)}: {sum.byStatus[st]}
          </li>
        ))}
        {sum.byStatus.unknown > 0 && (
          <li>
            <span aria-hidden="true">{statusSymbol('unknown')} </span>
            {statusLabel('unknown')}: {sum.byStatus.unknown}
          </li>
        )}
        <li>
          <span aria-hidden="true">⚠ </span>Not reporting: {sum.notReporting}
        </li>
        <li>No live data: {sum.noLive}</li>
        <li>With a configuration flag: {sum.flagged}</li>
      </ul>
    </div>
  )
}
