import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { buildCompleteRequest, completeErrorMessage, parseTripsResponse } from './historyLogic.js'

// Reads the student's trip history (GET /trips) plus routes and stops (D1) for
// names. Routes/stops are best-effort: if they fail the list still shows with
// "Route #id" / "Stop #id" fallbacks. A rating goes through PATCH and then a
// quiet background refetch, because the PATCH response has no rating/ended_at.
//
// state.phase: 'loading' (first load / Retry only) | 'ready' | 'error'
// A background refetch keeps phase 'ready' so the list stays on screen.
const INITIAL = {
  phase: 'loading',
  error: null,
  trips: [],
  routesById: new Map(),
  stopsById: new Map(),
  atLimit: false,
}

function toMap(list) {
  const m = new Map()
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && Number.isInteger(item.id)) m.set(item.id, item)
    }
  }
  return m
}

export function useTripHistory() {
  const [state, setState] = useState(INITIAL)
  const reqRef = useRef(0) // current load id; late results with a stale id are dropped
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reqRef.current += 1
    }
  }, [])

  // background=true keeps the current list and phase visible (no "Loading"),
  // so a refetch after a rating does not flash the screen or lose scroll.
  // The "Loading" phase itself is set by the caller (INITIAL on first mount,
  // retry() on Retry), never synchronously here, to avoid a setState in the
  // mount effect.
  const load = useCallback(async (background) => {
    reqRef.current += 1
    const id = reqRef.current
    const current = () => mountedRef.current && reqRef.current === id

    let tripsData
    try {
      tripsData = await api.get('/trips')
    } catch (err) {
      if (!current()) return
      if (err?.status === 401) return // logout flow takes over
      if (background) return // keep what is on screen; the next action can retry
      const message =
        err?.status === 0
          ? 'Cannot reach the server. Check your connection and try again.'
          : 'Could not load your trip history. Please try again.'
      setState((s) => ({ ...s, phase: 'error', error: message }))
      return
    }

    // Routes and stops are optional; swallow their errors and use empty maps.
    let routes = []
    let stops = []
    try {
      ;[routes, stops] = await Promise.all([api.get('/routes'), api.get('/stops')])
    } catch {
      routes = []
      stops = []
    }
    if (!current()) return

    const trips = parseTripsResponse(tripsData)
    setState({
      phase: 'ready',
      error: null,
      trips,
      routesById: toMap(routes),
      stopsById: toMap(stops),
      atLimit: trips.length === 50,
    })
  }, [])

  useEffect(() => {
    // State is already 'loading' (INITIAL); load() only sets state after its
    // awaits, so this does not trigger a synchronous cascade on mount.
    void (async () => {
      await load(false)
    })()
  }, [load])

  // Rate a trip, then quietly refetch so the card shows the stored state.
  // Returns { ok } on success or { ok:false, message } for the card to show.
  // Never throws to the UI. 401 returns { ok:false, message:null } (logout flow).
  const submitRating = useCallback(
    async (tripId, rating, feedback) => {
      try {
        await api.patch(`/trip/${tripId}/complete`, buildCompleteRequest(rating, feedback))
      } catch (err) {
        const message = completeErrorMessage(err?.status)
        // 409 means the row changed under us: refetch so the card refreshes.
        if (err?.status === 409) load(true)
        return { ok: false, message }
      }
      load(true) // PATCH response lacks rating/ended_at; reload the real row.
      return { ok: true, message: null }
    },
    [load],
  )

  const retry = useCallback(() => {
    setState((s) => ({ ...s, phase: 'loading', error: null }))
    load(false)
  }, [load])

  return { state, submitRating, retry }
}
