import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { analyticsErrorMessage, buildQuery, parseDemand, parseRoutesAnalytics } from './analyticsLogic.js'

// Analytics for /admin/analytics: GET /admin/analytics/routes and /demand (reads D3).
// Loads fresh on every mount; no polling, no automatic retry.
//
// Each section: { phase: 'loading' | 'ready' | 'error', data, error, canRetry }.
//   'loading' only while a section has no data yet. A later load keeps the data on
//   screen and sets `updating` instead. A failed later load keeps the data and sets
//   error (shown as "Could not update"). 403: no Retry. 401: nothing (logout flow).
// Both sections are requested together but settle on their own, so one failing never
// blanks the other.
//
// Races: every request bumps its section's id; a response is used only if the page is
// still mounted and the id is still current. busyRef holds the running load's token,
// set synchronously, so a second Apply/Reset/Retry while one runs does nothing.
const SECTIONS = {
  routes: { path: '/admin/analytics/routes', parse: parseRoutesAnalytics },
  demand: { path: '/admin/analytics/demand', parse: parseDemand },
}
const INITIAL_SECTION = { phase: 'loading', data: null, error: null, canRetry: false }

export function useAnalytics() {
  const [routes, setRoutes] = useState(INITIAL_SECTION)
  const [demand, setDemand] = useState(INITIAL_SECTION)
  const [updating, setUpdating] = useState(false)

  const reqRef = useRef({ routes: 0, demand: 0 }) // current request id per section
  const queryRef = useRef({ routes: '', demand: '' }) // last query per section, for Retry
  const hasDataRef = useRef({ routes: false, demand: false })
  const busyRef = useRef(0) // token of the running load, 0 = idle
  const tokenRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const req = reqRef.current
    return () => {
      mountedRef.current = false
      req.routes += 1
      req.demand += 1
      // StrictMode remounts at once; the old load must not block the new one.
      busyRef.current = 0
    }
  }, [])

  // Requests one section. Never throws. Returns the echoed { from, to } on success.
  const fetchSection = useCallback(async (name, query) => {
    const { path, parse } = SECTIONS[name]
    const set = name === 'routes' ? setRoutes : setDemand
    reqRef.current[name] += 1
    const id = reqRef.current[name]
    queryRef.current[name] = query

    let data = null
    let status = null
    try {
      data = await api.get(path + query)
    } catch (err) {
      status = err?.status ?? -1
    }
    if (!mountedRef.current || reqRef.current[name] !== id) return null

    // status null here with parsed null = 200 with an unusable body: generic error.
    const parsed = status === null ? parse(data) : null
    if (parsed) {
      hasDataRef.current[name] = true
      set({ phase: 'ready', data: parsed, error: null, canRetry: false })
      return { from: parsed.from, to: parsed.to }
    }
    if (status === 401) return null
    const error = analyticsErrorMessage(status ?? -1)
    const canRetry = status !== 403
    set((s) => (s.data ? { ...s, phase: 'ready', error, canRetry } : { phase: 'error', data: null, error, canRetry }))
    return null
  }, [])

  // initial: the mount load; sections are already 'loading', so no state is set
  // before the first await (no setState inside the mount effect).
  const run = useCallback(
    async (names, query, initial) => {
      if (busyRef.current) return null
      tokenRef.current += 1
      const token = tokenRef.current
      busyRef.current = token

      if (!initial) {
        if (names.some((n) => hasDataRef.current[n])) setUpdating(true)
        for (const n of names) {
          const set = n === 'routes' ? setRoutes : setDemand
          set((s) => (s.data ? { ...s, error: null, canRetry: false } : INITIAL_SECTION))
        }
      }
      try {
        const results = await Promise.all(names.map((n) => fetchSection(n, query)))
        return results.find(Boolean) ?? null
      } finally {
        if (busyRef.current === token) {
          busyRef.current = 0
          if (mountedRef.current) setUpdating(false)
        }
      }
    },
    [fetchSection],
  )

  // Both sections for a range ('' and '' = server default). Resolves to the echoed
  // { from, to } of the first section that loaded, or null (failed, stale or busy).
  const load = useCallback(
    (from, to, { initial = false } = {}) => run(['routes', 'demand'], buildQuery(from, to), initial),
    [run],
  )

  // One section again, with its last query.
  const retry = useCallback((name) => run([name], queryRef.current[name], false), [run])

  const isBusy = useCallback(() => busyRef.current !== 0, [])

  return { routes, demand, updating, load, retry, isBusy }
}
