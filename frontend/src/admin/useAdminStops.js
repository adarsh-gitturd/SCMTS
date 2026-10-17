import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { loadErrorMessage, parseStopsResponse, sortStops, stopErrorMessage, stopIsGone } from './adminLogic.js'

// Stops for /admin/stops: GET /stops plus POST/PUT/DELETE /admin/stops.
// Loads fresh on every mount; nothing is cached between pages.
//
// state.phase: 'loading' (first load / Retry only) | 'ready' | 'error'
// A background reload keeps phase 'ready' so the list and scroll stay put.
const INITIAL = { phase: 'loading', error: null, stops: [] }

export function useAdminStops() {
  const [state, setState] = useState(INITIAL)
  const [busy, setBusy] = useState(false)
  const reqRef = useRef(0) // current load id; late results with a stale id are dropped
  const mountedRef = useRef(false)
  const busyRef = useRef(false) // set synchronously: blocks a second write while one runs

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reqRef.current += 1
    }
  }, [])

  const load = useCallback(async (background) => {
    reqRef.current += 1
    const id = reqRef.current
    const current = () => mountedRef.current && reqRef.current === id

    let data
    try {
      data = await api.get('/stops')
    } catch (err) {
      if (!current()) return
      if (background) return // keep what is on screen; the next action can retry
      const message = loadErrorMessage(err?.status)
      if (message === null) return // 401: logout flow takes over
      setState((s) => ({ ...s, phase: 'error', error: message }))
      return
    }
    if (!current()) return
    setState({ phase: 'ready', error: null, stops: sortStops(parseStopsResponse(data)) })
  }, [])

  useEffect(() => {
    // State is already 'loading' (INITIAL); load() only sets state after its await.
    void (async () => {
      await load(false)
    })()
  }, [load])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, phase: 'loading', error: null }))
    load(false)
  }, [load])

  // One write at a time. Returns { ok, message, gone, blocked }; never throws, never retries.
  // message is null for 401 (logout flow). gone = the stop no longer exists (list refetched).
  const run = useCallback(
    async (send) => {
      if (busyRef.current) return { ok: false, message: null, gone: false, blocked: true }
      busyRef.current = true
      setBusy(true)
      try {
        await send()
      } catch (err) {
        const gone = stopIsGone(err?.status, err?.message)
        if (gone) load(true)
        return { ok: false, message: stopErrorMessage(err?.status, err?.message), gone, blocked: false }
      } finally {
        busyRef.current = false
        if (mountedRef.current) setBusy(false)
      }
      load(true)
      return { ok: true, message: null, gone: false, blocked: false }
    },
    [load],
  )

  // id null = create (POST), otherwise full replace (PUT).
  const save = useCallback(
    (id, body) => run(() => (id === null ? api.post('/admin/stops', body) : api.put(`/admin/stops/${id}`, body))),
    [run],
  )

  const remove = useCallback((id) => run(() => api.delete(`/admin/stops/${id}`)), [run])

  return { state, busy, retry, save, remove }
}
