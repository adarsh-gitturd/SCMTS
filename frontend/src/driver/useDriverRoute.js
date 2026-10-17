import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { parseDriverRoute } from './driverLogic.js'

// Reads the logged-in driver's bus and route (GET /driver/route) once on mount.
// Read-only: sends nothing else.
//
// state: { phase: 'loading' | 'ready' | 'error', status, data }
// status is the HTTP status (0 = network error); data is the parseDriverRoute
// result (null when the response shape was wrong).
const INITIAL = { phase: 'loading', status: null, data: null }

export function useDriverRoute() {
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

  // Sets state only after the await, so calling it from the mount effect
  // does not cause a synchronous setState cascade.
  const load = useCallback(async () => {
    reqRef.current += 1
    const id = reqRef.current
    const current = () => mountedRef.current && reqRef.current === id

    let data
    try {
      data = await api.get('/driver/route')
    } catch (err) {
      if (!current()) return
      const status = typeof err?.status === 'number' ? err.status : -1
      setState({ phase: 'error', status, data: null })
      return
    }
    if (!current()) return
    setState({ phase: 'ready', status: 200, data: parseDriverRoute(data) })
  }, [])

  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load])

  const retry = useCallback(() => {
    setState(INITIAL)
    load()
  }, [load])

  return { state, retry }
}
