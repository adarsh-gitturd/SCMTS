import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import {
  loadErrorMessage,
  parseRoutesResponse,
  parseStopsResponse,
  routeErrorMessage,
  routeErrorRefetch,
  sortStops,
} from './adminLogic.js'

// Routes for /admin/routes: GET /routes and GET /stops (for names), plus
// POST/PUT/DELETE /admin/routes. Loads fresh on every mount; nothing is cached.
// Routes and stops load separately, each with its own phase, error and Retry,
// so the list can still show "Stop #id" when stops fail.
//
// phase: 'loading' (first load / Retry only) | 'ready' | 'error'
const INITIAL = { phase: 'loading', error: null, items: [] }

// One GET list with request id + mounted flag; late or stale results are dropped.
function useList(path, parse) {
  const [state, setState] = useState(INITIAL)
  const reqRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reqRef.current += 1
    }
  }, [])

  const load = useCallback(
    async (background) => {
      reqRef.current += 1
      const id = reqRef.current
      const current = () => mountedRef.current && reqRef.current === id

      let data
      try {
        data = await api.get(path)
      } catch (err) {
        if (!current()) return
        if (background) return // keep what is on screen
        const message = loadErrorMessage(err?.status)
        if (message === null) return // 401: logout flow takes over
        setState((s) => ({ ...s, phase: 'error', error: message }))
        return
      }
      if (!current()) return
      setState({ phase: 'ready', error: null, items: parse(data) })
    },
    [path, parse],
  )

  useEffect(() => {
    void (async () => {
      await load(false)
    })()
  }, [load])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, phase: 'loading', error: null }))
    load(false)
  }, [load])

  return { state, load, retry, mountedRef }
}

const parseSortedStops = (data) => sortStops(parseStopsResponse(data))

export function useAdminRoutes() {
  const routes = useList('/routes', parseRoutesResponse)
  const stops = useList('/stops', parseSortedStops)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // set synchronously: blocks a second write while one runs

  const loadRoutes = routes.load
  const loadStops = stops.load
  const mountedRef = routes.mountedRef

  // One write at a time. Returns { ok, message, gone, blocked }; never throws, never retries.
  // gone = the route no longer exists. An unknown stop id refetches stops and keeps the form.
  const run = useCallback(
    async (send) => {
      if (busyRef.current) return { ok: false, message: null, gone: false, blocked: true }
      busyRef.current = true
      setBusy(true)
      try {
        await send()
      } catch (err) {
        const refetch = routeErrorRefetch(err?.status, err?.message)
        if (refetch === 'routes') loadRoutes(true)
        if (refetch === 'stops') loadStops(true)
        return {
          ok: false,
          message: routeErrorMessage(err?.status, err?.message),
          gone: refetch === 'routes',
          blocked: false,
        }
      } finally {
        busyRef.current = false
        if (mountedRef.current) setBusy(false)
      }
      loadRoutes(true)
      return { ok: true, message: null, gone: false, blocked: false }
    },
    [loadRoutes, loadStops, mountedRef],
  )

  // id null = create (POST), otherwise full replace (PUT). body: { name, stops: [ids] }.
  const save = useCallback(
    (id, body) => run(() => (id === null ? api.post('/admin/routes', body) : api.put(`/admin/routes/${id}`, body))),
    [run],
  )

  const remove = useCallback((id) => run(() => api.delete(`/admin/routes/${id}`)), [run])

  return {
    routes: routes.state,
    stops: stops.state,
    retryRoutes: routes.retry,
    retryStops: stops.retry,
    busy,
    save,
    remove,
  }
}
