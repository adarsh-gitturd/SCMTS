import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import {
  buildPassengerBody,
  parseCreated,
  passengerErrorMessage,
  successMessage,
  UNCLEAR_SAVE_MESSAGE,
} from './passengerLogic.js'
import { formatClock } from './shiftLogic.js'

// POST /driver/passengers and its state. Each call writes a row, so a request only
// starts from submit() (a click or Enter), never from an effect, never twice at once,
// and is never retried automatically.
//
// notice: { kind: 'success' | 'error', text } | null
export function usePassengerLog() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const busyRef = useRef(false) // set synchronously, so a double click or Enter cannot slip through
  const reqRef = useRef(0) // current request id; bumped on unmount to drop late results
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reqRef.current += 1
      busyRef.current = false
    }
  }, [])

  // Resolves to true when the count was logged (201 with an id), false otherwise.
  const submit = useCallback(async (stopId, count, stopName) => {
    const body = buildPassengerBody(stopId, count)
    if (busyRef.current || !body) return false
    busyRef.current = true
    reqRef.current += 1
    const id = reqRef.current
    const current = () => mountedRef.current && reqRef.current === id

    setBusy(true)
    setNotice(null)
    try {
      let data
      try {
        data = await api.post('/driver/passengers', body)
      } catch (err) {
        if (!current()) return false
        const text = passengerErrorMessage(err?.status, err?.message)
        setNotice(text ? { kind: 'error', text } : null)
        return false
      }
      if (!current()) return false
      if (parseCreated(data) === null) {
        setNotice({ kind: 'error', text: UNCLEAR_SAVE_MESSAGE })
        return false
      }
      setNotice({ kind: 'success', text: `${successMessage(count, stopName)} (${formatClock(Date.now())})` })
      return true
    } finally {
      if (reqRef.current === id) {
        busyRef.current = false
        if (mountedRef.current) setBusy(false)
      }
    }
  }, [])

  return { busy, notice, submit }
}
