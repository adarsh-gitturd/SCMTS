import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { clearFetchBase, setFetchBase } from './fleetClock.js'
import { fleetErrorMessage, parseFleetResponse, stabilize } from './fleetLogic.js'

// Fleet for /admin/fleet: GET /admin/fleet, polled every 5 s. Loads fresh on every mount.
// The next request is scheduled with setTimeout only after the previous response, so
// requests never overlap. Paused while the tab is hidden; refreshes at once when visible.
//
// phase: 'loading' (first load / Retry) | 'ready' | 'error'
//   error after a first load that failed: polling stops, Retry (canRetry) restarts it.
//   403: polling stops for good (no Retry). 401: nothing shown, logout flow takes over.
// A failed poll after data was shown keeps the data, sets refreshFailed and keeps polling.
// recovered = the last failure was followed by a success (for the "Data refreshed." text).
const POLL_MS = 5000
const INITIAL = {
  phase: 'loading',
  error: null,
  canRetry: false,
  buses: [],
  lastOkAt: null, // local time the last good response arrived, "HH:MM:SS" (display only)
  refreshFailed: false,
  recovered: false,
}
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function useFleet() {
  const [state, setState] = useState(INITIAL)
  const [run, setRun] = useState(0) // bumped by Retry to start a new polling loop
  const reqRef = useRef(0) // current request id; late responses with an old id are dropped

  useEffect(() => {
    // One polling loop per effect run. StrictMode's extra mount/unmount clears the
    // first timer before it fires, so only one loop and one request ever exist.
    let alive = true
    let stopped = false // 401, 403 or a failed first load
    let inFlight = false
    let hasData = false
    let timer = null

    function schedule(ms) {
      clearTimeout(timer)
      timer = document.hidden ? null : setTimeout(poll, ms)
    }

    async function poll() {
      timer = null
      if (inFlight || stopped) return
      inFlight = true
      reqRef.current += 1
      const id = reqRef.current

      let data = null
      let status = null
      try {
        data = await api.get('/admin/fleet')
      } catch (err) {
        status = err?.status
      }
      if (!alive || reqRef.current !== id) return
      inFlight = false

      const parsed = status === null ? parseFleetResponse(data) : null
      if (parsed) {
        setFetchBase(parsed.serverTime, performance.now())
        hasData = true
        const lastOkAt = timeFormat.format(new Date())
        setState((s) => ({
          phase: 'ready',
          error: null,
          canRetry: false,
          buses: stabilize(s.buses, parsed.buses),
          lastOkAt,
          refreshFailed: false,
          recovered: s.refreshFailed || s.recovered,
        }))
        schedule(POLL_MS)
        return
      }

      // status null here = 200 with an unusable body: treated like a server error.
      if (status === 401) {
        stopped = true
        return
      }
      const message = fleetErrorMessage(status ?? -1)
      if (status === 403) {
        stopped = true
        setState({ ...INITIAL, phase: 'error', error: message })
        return
      }
      if (hasData) {
        setState((s) => (s.refreshFailed ? s : { ...s, refreshFailed: true, recovered: false }))
        schedule(POLL_MS)
        return
      }
      stopped = true
      setState((s) => ({ ...s, phase: 'error', error: message, canRetry: true }))
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimeout(timer)
        timer = null
      } else if (!inFlight && !stopped) {
        schedule(0)
      }
      // In flight: its response schedules the next poll (the tab is visible again).
    }

    document.addEventListener('visibilitychange', onVisibility)
    schedule(0)

    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      reqRef.current += 1
      clearFetchBase()
    }
  }, [run])

  const retry = useCallback(() => {
    setState(INITIAL)
    setRun((r) => r + 1)
  }, [])

  return { state, retry }
}
