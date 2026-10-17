import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import {
  buildLocationBody,
  FORBIDDEN_MESSAGE,
  isValidStatus,
  locationErrorOutcome,
  NO_BUS_MESSAGE,
  parseStatusResponse,
  startErrorMessage,
  statusErrorMessage,
  statusLabel,
} from './shiftLogic.js'

const SEND_INTERVAL_MS = 3000
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 }
const CONN_PROBLEM_AFTER = 2 // consecutive failed sends

const DENIED_MESSAGE =
  'Location permission is off. Allow location for this site in your browser settings, then start the shift again.'
const UNSUPPORTED_MESSAGE = 'This browser cannot share location. Use an up-to-date browser over HTTPS.'
const END_UNSURE_MESSAGE = 'Sharing stopped, but the status may not have changed.'

// phase: 'idle' | 'starting' | 'sharing' | 'ending'
// status: last status the server confirmed with 200 (null = unknown; never optimistic)
// canCancel: starting, and the first request has not been sent yet
// lastSentAt: client time (ms) of the last accepted location
const IDLE = {
  phase: 'idle',
  status: null,
  statusBusy: false,
  canCancel: false,
  gpsWaiting: false,
  connProblem: false,
  rejected: 0,
  lastSentAt: null,
  message: null,
  statusMessage: null,
}

// Screen wake lock while sharing. Unsupported or denied is ignored.
async function acquireWake(wakeRef, stillWanted) {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  if (wakeRef.current && !wakeRef.current.released) return
  try {
    const lock = await navigator.wakeLock.request('screen')
    if (!stillWanted() || (wakeRef.current && !wakeRef.current.released)) {
      lock.release().catch(() => {})
      return
    }
    wakeRef.current = lock
  } catch {
    // not allowed (e.g. battery saver): sharing works without it
  }
}

function releaseWake(wakeRef) {
  const lock = wakeRef.current
  wakeRef.current = null
  if (lock) lock.release().catch(() => {})
}

// Driver shift: GPS sharing (POST /driver/location every ~3s) and status changes
// (PATCH /driver/status). Nothing starts on mount; everything starts from a click,
// so a StrictMode double mount cannot start a watch or a timer. Unmount (logout,
// navigation, 401) stops everything without changing the status.
export function useDriverShift() {
  const [state, setState] = useState(IDLE)
  const phaseRef = useRef('idle') // set synchronously, so a double click cannot start or end twice
  const shiftIdRef = useRef(0) // bumped on every start/stop/unmount; late results with an old id are dropped
  const mountedRef = useRef(false)
  const cancelableRef = useRef(false)
  const statusBusyRef = useRef(false)
  const sendingRef = useRef(false) // a location POST is in flight
  const watchIdRef = useRef(null)
  const timerRef = useRef(null)
  const fixRef = useRef(null) // latest fix only: { latitude, longitude, speed }; never logged
  const failStreakRef = useRef(0)
  const wakeRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true
    const onVisible = () => {
      if (document.visibilityState === 'visible' && phaseRef.current === 'sharing') {
        acquireWake(wakeRef, () => mountedRef.current && phaseRef.current === 'sharing')
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      mountedRef.current = false
      shiftIdRef.current += 1
      phaseRef.current = 'idle'
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      clearInterval(timerRef.current)
      timerRef.current = null
      releaseWake(wakeRef)
      fixRef.current = null
      sendingRef.current = false
      statusBusyRef.current = false
    }
  }, [])

  const current = (id) => mountedRef.current && shiftIdRef.current === id

  // Stops the watch, the timer and the wake lock, and drops all running requests.
  function stopLocal() {
    shiftIdRef.current += 1
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    clearInterval(timerRef.current)
    timerRef.current = null
    releaseWake(wakeRef)
    fixRef.current = null
    sendingRef.current = false
    statusBusyRef.current = false
    cancelableRef.current = false
  }

  // Back to idle with a message; the status becomes unknown.
  function stopShift(message) {
    stopLocal()
    phaseRef.current = 'idle'
    setState((s) => ({ ...IDLE, lastSentAt: s.lastSentAt, message }))
  }

  function startWatch(id) {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!current(id)) return
        const c = pos.coords
        fixRef.current = { latitude: c.latitude, longitude: c.longitude, speed: c.speed }
        setState((s) => (s.gpsWaiting ? { ...s, gpsWaiting: false } : s))
        if (phaseRef.current === 'starting' && cancelableRef.current) void beginShift(id)
      },
      (err) => {
        if (!current(id)) return
        if (err.code === err.PERMISSION_DENIED) {
          stopShift(DENIED_MESSAGE)
          return
        }
        // Timeout or unavailable: the watch keeps trying; sharing keeps sending the last fix.
        setState((s) => (s.gpsWaiting ? s : { ...s, gpsWaiting: true }))
      },
      WATCH_OPTIONS,
    )
  }

  function startTimer(id) {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => void sendTick(id), SEND_INTERVAL_MS)
  }

  // First fix -> POST location -> PATCH on_route -> sharing. Any failure ends the start.
  async function beginShift(id) {
    const body = buildLocationBody(fixRef.current)
    if (!body) return // wait for the next fix
    cancelableRef.current = false
    setState((s) => ({ ...s, canCancel: false }))

    try {
      await api.post('/driver/location', body)
    } catch (err) {
      if (current(id)) stopShift(startErrorMessage(err?.status))
      return
    }
    if (!current(id)) return
    // Runs from the geolocation callback after an await, never during render.
    // oxlint-disable-next-line react/purity
    const sentAt = Date.now()

    let data
    try {
      data = await api.patch('/driver/status', { status: 'on_route' })
    } catch (err) {
      if (current(id)) stopShift(startErrorMessage(err?.status))
      return
    }
    if (!current(id)) return
    if (parseStatusResponse(data)?.status !== 'on_route') {
      stopShift(startErrorMessage(500))
      return
    }

    phaseRef.current = 'sharing'
    failStreakRef.current = 0
    startTimer(id)
    acquireWake(wakeRef, () => current(id) && phaseRef.current === 'sharing')
    setState((s) => ({ ...s, phase: 'sharing', status: 'on_route', lastSentAt: sentAt, message: null }))
  }

  // One periodic send of the latest fix. Skipped when there is no fix or a send is in flight.
  async function sendTick(id) {
    if (!current(id) || phaseRef.current !== 'sharing' || sendingRef.current) return
    const body = buildLocationBody(fixRef.current)
    if (!body) return
    sendingRef.current = true
    try {
      await api.post('/driver/location', body)
      if (!current(id)) return
      failStreakRef.current = 0
      const now = Date.now()
      setState((s) => ({ ...s, lastSentAt: now, connProblem: false }))
    } catch (err) {
      if (!current(id)) return
      switch (locationErrorOutcome(err?.status)) {
        case 'reject':
          setState((s) => ({ ...s, rejected: s.rejected + 1 }))
          break
        case 'skip':
        case 'logout':
          break
        case 'forbidden':
          stopShift(FORBIDDEN_MESSAGE)
          break
        case 'no-bus':
          stopShift(NO_BUS_MESSAGE)
          break
        default:
          failStreakRef.current += 1
          if (failStreakRef.current >= CONN_PROBLEM_AFTER) {
            setState((s) => (s.connProblem ? s : { ...s, connProblem: true }))
          }
      }
    } finally {
      // A stop during the request already reset the flag for the next shift.
      if (shiftIdRef.current === id) sendingRef.current = false
    }
  }

  function start() {
    if (phaseRef.current !== 'idle') return
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      setState((s) => ({ ...s, message: UNSUPPORTED_MESSAGE }))
      return
    }
    stopLocal() // clean slate; also bumps the id
    phaseRef.current = 'starting'
    cancelableRef.current = true
    const id = shiftIdRef.current
    setState((s) => ({ ...IDLE, phase: 'starting', canCancel: true, lastSentAt: s.lastSentAt }))
    startWatch(id)
  }

  // Only before the first request is sent, so it never races the on_route PATCH.
  function cancel() {
    if (phaseRef.current !== 'starting' || !cancelableRef.current) return
    stopShift(null)
  }

  async function end() {
    if (phaseRef.current !== 'sharing' || statusBusyRef.current) return
    phaseRef.current = 'ending'
    stopLocal()
    const id = shiftIdRef.current
    setState((s) => ({ ...s, phase: 'ending', gpsWaiting: false, connProblem: false, message: null, statusMessage: null }))

    let data
    try {
      data = await api.patch('/driver/status', { status: 'out_of_service' })
    } catch (err) {
      if (!current(id)) return
      phaseRef.current = 'idle'
      const message = err?.status === 401 ? null : END_UNSURE_MESSAGE
      setState((s) => ({ ...IDLE, lastSentAt: s.lastSentAt, message }))
      return
    }
    if (!current(id)) return
    phaseRef.current = 'idle'
    const ok = parseStatusResponse(data)?.status === 'out_of_service'
    setState((s) => ({
      ...IDLE,
      lastSentAt: s.lastSentAt,
      status: ok ? 'out_of_service' : null,
      message: ok ? 'Shift ended. Status: Out of service.' : END_UNSURE_MESSAGE,
    }))
  }

  // No optimistic UI: the status changes only after a 200 with the same status.
  async function changeStatus(next) {
    if (phaseRef.current !== 'sharing' || statusBusyRef.current || !isValidStatus(next)) return
    statusBusyRef.current = true
    const id = shiftIdRef.current
    setState((s) => ({ ...s, statusBusy: true, statusMessage: null }))
    try {
      let data
      try {
        data = await api.patch('/driver/status', { status: next })
      } catch (err) {
        if (!current(id)) return
        const message = statusErrorMessage(err?.status)
        if (err?.status === 403 || err?.status === 404) {
          stopShift(message)
          return
        }
        setState((s) => ({ ...s, statusBusy: false, statusMessage: message }))
        return
      }
      if (!current(id)) return
      const res = parseStatusResponse(data)
      if (res?.status !== next) {
        setState((s) => ({ ...s, statusBusy: false, statusMessage: statusErrorMessage(500) }))
        return
      }
      setState((s) => ({
        ...s,
        statusBusy: false,
        status: res.status,
        statusMessage: `Status changed to ${statusLabel(res.status)}.`,
      }))
    } finally {
      if (shiftIdRef.current === id) statusBusyRef.current = false
    }
  }

  return { state, start, cancel, end, changeStatus }
}
