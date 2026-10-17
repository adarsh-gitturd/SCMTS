import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deriveAlerts, holdRemoved, newAnnouncements, pruneDismissed, trackSeen } from './alertsLogic.js'

const TICK_MS = 1000 // staleness and removal-hold expiry are checked on this tick

// Alerts state for the strip. Re-runs on every live update, but visible keeps its
// identity while nothing on screen changed (holdRemoved / sameAlerts).
// -> { visible, liveText, dismiss }
export function useAlerts({ buses, conn, busRoutes, routeNames, top, info }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Local time each bus's ts last changed (see isQuiet).
  const [seen, setSeen] = useState(() => ({ buses: null, map: new Map() }))
  let seenMap = seen.map
  if (seen.buses !== buses) {
    seenMap = trackSeen(seen.map, buses, now)
    setSeen({ buses, map: seenMap })
  }

  const [hadLive, setHadLive] = useState(false)
  if (conn.kind === 'live' && !hadLive) setHadLive(true)

  const derived = deriveAlerts({
    buses,
    seen: seenMap,
    connKind: conn.kind,
    hadLive: hadLive || conn.kind === 'live',
    busRoutes,
    routeNames,
    top,
    now,
    info,
  })

  const [shown, setShown] = useState([])
  const nextShown = holdRemoved(shown, derived, now)
  if (nextShown !== shown) setShown(nextShown)

  // Dismissed keys, in memory only.
  const [dismissed, setDismissed] = useState(() => new Set())
  const nextDismissed = pruneDismissed(dismissed, nextShown)
  if (nextDismissed !== dismissed) setDismissed(nextDismissed)

  const visible = useMemo(() => nextShown.filter((a) => !nextDismissed.has(a.key)), [nextShown, nextDismissed])

  // Only alerts that were not visible before are put in the live region.
  const announcedRef = useRef(new Set())
  const [liveText, setLiveText] = useState('')
  useEffect(() => {
    const ann = newAnnouncements(announcedRef.current, visible)
    announcedRef.current = ann.announced
    if (ann.text) setLiveText(ann.text)
    else if (visible.length === 0) setLiveText('') // so the same text is announced again next time
  }, [visible])

  const dismiss = useCallback((key) => setDismissed((d) => new Set(d).add(key)), [])

  return { visible, liveText, dismiss }
}
