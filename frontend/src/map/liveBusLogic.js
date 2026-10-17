// Pure helpers for the live bus feed. No imports, no side effects, so they can be
// tried from node: node -e "import('./src/map/liveBusLogic.js').then(m => ...)"

export const STATUSES = ['on_route', 'delayed', 'break', 'out_of_service']
export const STALE_MS = 30_000

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 15_000
const JITTER = 0.2 // +-20%

// One WS text frame -> bus object, or null if it is not a valid position frame.
export function parseBusMessage(text) {
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object' || msg.type !== 'position') return null
  const { bus_id, lat, lng, speed, status, ts } = msg
  if (!Number.isInteger(bus_id)) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  if (typeof status !== 'string' || typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null
  return {
    bus_id,
    lat,
    lng,
    speed: Number.isFinite(speed) ? speed : null,
    status: STATUSES.includes(status) ? status : 'unknown',
    ts,
  }
}

// Returns a new Map with the buses upserted by bus_id. reset = start from empty
// (a new connection's snapshot replaces the old state). Snapshot and change
// frames are handled the same way.
export function applyUpdates(prev, updates, reset) {
  const next = reset ? new Map() : new Map(prev)
  for (const bus of updates) next.set(bus.bus_id, bus)
  return next
}

// Delay before reconnect attempt number `attempt` (0-based): 1s, 2s, 4s, 8s, 15s, 15s...
// with +-20% jitter. rand is injectable for testing.
export function backoffDelay(attempt, rand = Math.random) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))
  const factor = 1 - JITTER + rand() * 2 * JITTER
  return Math.round(base * factor)
}

export function isStale(bus, now) {
  return now - Date.parse(bus.ts) > STALE_MS
}

export function wsUrl(protocol, host, ticket) {
  const scheme = protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${host}/ws/buses?ticket=${encodeURIComponent(ticket)}`
}
