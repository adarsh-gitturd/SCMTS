import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client.js'
import { applyUpdates, backoffDelay, parseBusMessage, wsUrl } from './liveBusLogic.js'

const FLUSH_MS = 200 // batch WS frames into at most ~5 renders per second

// Live bus positions from WS /ws/buses.
// conn.kind: 'connecting' | 'live' | 'reconnecting' (with retryAt, ms epoch) | 'forbidden'
export function useLiveBuses(token) {
  const [buses, setBuses] = useState(() => new Map())
  const [conn, setConn] = useState({ kind: 'connecting' })

  useEffect(() => {
    if (!token) return undefined

    // Everything below is local to this effect run, so a StrictMode double mount
    // (or a token change) gets a fully separate connection that its cleanup ends.
    let cancelled = false
    let ws = null
    let attempt = 0
    let retryTimer = null
    let flushTimer = null
    let pending = []
    let pendingReset = false

    function flush() {
      flushTimer = null
      const updates = pending
      const reset = pendingReset
      pending = []
      pendingReset = false
      setBuses((prev) => applyUpdates(prev, updates, reset))
    }

    function scheduleRetry() {
      const delay = backoffDelay(attempt)
      attempt += 1
      setConn({ kind: 'reconnecting', retryAt: Date.now() + delay })
      retryTimer = setTimeout(connect, delay)
    }

    async function connect() {
      retryTimer = null
      setConn({ kind: 'connecting' })

      let ticket
      try {
        const data = await api.post('/ws-ticket')
        ticket = data?.ticket
      } catch (err) {
        if (cancelled) return
        // 401 also logs out via the client's unauthorized handler; 403 = role not allowed.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setConn({ kind: 'forbidden' })
          return
        }
        scheduleRetry()
        return
      }
      // StrictMode's first mount ends up here after its cleanup: the ticket is dropped
      // unused and no socket is opened.
      if (cancelled) return
      if (typeof ticket !== 'string' || ticket === '') {
        scheduleRetry()
        return
      }

      const sock = new WebSocket(wsUrl(window.location.protocol, window.location.host, ticket))
      ws = sock
      sock.onopen = () => {
        attempt = 0
        pendingReset = true // the snapshot that follows replaces local state
        setConn({ kind: 'live' })
      }
      sock.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        const bus = parseBusMessage(ev.data)
        if (!bus) return
        pending.push(bus)
        if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_MS)
      }
      // A failed handshake (401/403/503) also arrives here, as code 1006.
      sock.onclose = () => {
        if (cancelled || ws !== sock) return
        ws = null
        scheduleRetry()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearTimeout(flushTimer)
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.close(1000)
        ws = null
      }
    }
  }, [token])

  return { buses, conn }
}
