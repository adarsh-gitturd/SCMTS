import { useSyncExternalStore } from 'react'

// Shared 1-second tick for the fleet page's age texts and summary, so the bus cards
// themselves never re-render on a tick. Also holds the base of the last successful
// fetch: server_time and the performance.now() moment the response arrived.
// The interval runs only while something is subscribed. Times are performance.now()
// (monotonic), never Date.now(), so a wrong PC clock does not change any age.
const TICK_MS = 1000

let snapshot = { now: 0, serverTime: null, fetchedAt: null }
const listeners = new Set()
let timer = null

function emit(next) {
  snapshot = next
  for (const fn of listeners) fn()
}

function tick() {
  emit({ ...snapshot, now: performance.now() })
}

export function setFetchBase(serverTime, fetchedAt) {
  emit({ now: fetchedAt, serverTime, fetchedAt })
}

export function clearFetchBase() {
  emit({ now: performance.now(), serverTime: null, fetchedAt: null })
}

function subscribe(fn) {
  listeners.add(fn)
  if (timer === null) timer = setInterval(tick, TICK_MS)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot() {
  return snapshot
}

// -> { now, serverTime, fetchedAt }; re-renders the caller every tick and on every fetch.
export function useFleetClock() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
