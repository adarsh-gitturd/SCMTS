import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { getPosition } from './geolocation.js'
import { buildTripRequest, originFallbackMessage, parseTripResponse, tripErrorMessage } from './tripLogic.js'

// phase: 'idle' | 'locating' | 'submitting' | 'success' | 'error'
// originMode: 'gps' | 'manual' (manual after a failed location fix, kept until retryLocation)
// result: { trip_id, destination_stop_id, recommendations: [...] } as from parseTripResponse
const IDLE = { phase: 'idle', originMode: 'gps', notice: null, result: null, error: null }

// POST /trip/create and its state. Each call creates a trip row, so a request only
// starts from submit() (a click), never from an effect, and never twice at once.
export function useTripRequest() {
  const [state, setState] = useState(IDLE)
  const busyRef = useRef(false) // set synchronously, so a fast double click cannot slip through
  const reqRef = useRef(0) // current request id; bumped by reset and unmount to drop late results
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reqRef.current += 1
      busyRef.current = false
    }
  }, [])

  // originStop: { lat, lng } of the stop picked in manual mode, or null to use GPS.
  // Coordinates stay in local variables and go only into the request body.
  const submit = useCallback(async (destStopId, originStop) => {
    if (busyRef.current) return
    busyRef.current = true
    reqRef.current += 1
    const id = reqRef.current
    const current = () => mountedRef.current && reqRef.current === id

    try {
      let origin
      if (originStop) {
        origin = { lat: originStop.lat, lng: originStop.lng }
      } else {
        setState((s) => ({ ...s, phase: 'locating', error: null }))
        try {
          origin = await getPosition()
        } catch (err) {
          if (!current()) return
          setState((s) => ({ ...s, phase: 'idle', originMode: 'manual', notice: originFallbackMessage(err?.reason) }))
          return
        }
        if (!current()) return
      }

      setState((s) => ({ ...s, phase: 'submitting', error: null }))
      let data
      try {
        data = await api.post('/trip/create', buildTripRequest(origin, destStopId))
      } catch (err) {
        if (!current()) return
        const message = tripErrorMessage(err?.status)
        setState((s) => ({ ...s, phase: message ? 'error' : 'idle', error: message }))
        return
      }
      if (!current()) return

      const result = parseTripResponse(data, destStopId)
      if (!result) {
        setState((s) => ({ ...s, phase: 'error', error: tripErrorMessage(500) }))
        return
      }
      setState((s) => ({ ...s, phase: 'success', result, error: null }))
    } finally {
      // A reset during the request already freed the guard for the next one.
      if (reqRef.current === id) busyRef.current = false
    }
  }, [])

  // Clears the result and drops any running request. Sends nothing.
  const reset = useCallback(() => {
    reqRef.current += 1
    busyRef.current = false
    setState((s) => ({ ...IDLE, originMode: s.originMode, notice: s.notice }))
  }, [])

  // Back to GPS mode after a fallback; the next click asks for location again.
  const retryLocation = useCallback(() => {
    reqRef.current += 1
    busyRef.current = false
    setState(IDLE)
  }, [])

  return { state, submit, reset, retryLocation }
}
