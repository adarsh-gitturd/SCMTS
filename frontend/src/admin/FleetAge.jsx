import { useFleetClock } from './fleetClock.js'
import { ageSeconds, displayAge, formatAge, isStaleAge } from './fleetLogic.js'

// Age of one bus's last update plus "Not reporting" when stale. The only part of a
// card that re-renders on the 1-second tick.
export default function FleetAge({ updatedAt, status }) {
  const { now, serverTime, fetchedAt } = useFleetClock()
  const age = serverTime === null ? null : displayAge(ageSeconds(serverTime, updatedAt), fetchedAt, now)
  if (age === null) return null
  const stale = isStaleAge(age, status)

  return (
    <>
      {formatAge(age)}
      {stale && (
        <span className="fleet-stale">
          <span aria-hidden="true">⚠ </span>Not reporting
        </span>
      )}
    </>
  )
}
