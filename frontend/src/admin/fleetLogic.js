// Pure helpers for the admin fleet overview (/admin/fleet, GET /api/admin/fleet).
// No React, no fetch. Check: node src/admin/fleetLogic.check.js
// Ages only ever compare two server times (server_time - updated_at); the PC clock
// is never compared with a server timestamp.
import { STALE_MS } from '../map/liveBusLogic.js'
import { loadErrorMessage } from './adminLogic.js'

// Copy of STATUS_INFO in map/busIcons.js (that file imports Leaflet, so node cannot load it).
const STATUS_INFO = {
  on_route: { label: 'On route', glyph: '▶' },
  delayed: { label: 'Delayed', glyph: '!' },
  break: { label: 'On break', glyph: '‖' },
  out_of_service: { label: 'Out of service', glyph: '✕' },
  unknown: { label: 'Unknown', glyph: '?' },
}
export const SUMMARY_STATUSES = ['on_route', 'delayed', 'break', 'out_of_service']

const STALE_S = STALE_MS / 1000

export const FLAG_NO_DRIVER = 'No driver assigned'
export const FLAG_NO_ROUTE = 'No route assigned'
export const FLAG_NO_LIVE = 'No live data yet'

// --- response ---

function isTime(s) {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s))
}

function nameOrNull(v) {
  return typeof v === 'string' ? v : v === null || v === undefined ? null : undefined
}

// live object -> { lat, lng, speed, status, updated_at }, null for null, undefined if broken.
function parseLive(live) {
  if (live === null || live === undefined) return null
  if (typeof live !== 'object') return undefined
  const { lat, lng, speed, status, updated_at } = live
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined
  if (typeof status !== 'string' || !isTime(updated_at)) return undefined
  return {
    lat,
    lng,
    speed: Number.isFinite(speed) ? speed : null,
    status: SUMMARY_STATUSES.includes(status) ? status : 'unknown',
    updated_at,
  }
}

// -> { serverTime, buses: [{ bus_id, plate, route_name, driver_name, live }] } or null when
// server_time is missing (ages cannot be computed). Broken buses (also a broken live
// object) are dropped; server order is kept; live null stays null.
export function parseFleetResponse(data) {
  if (!data || typeof data !== 'object' || !isTime(data.server_time)) return null
  const buses = []
  for (const b of Array.isArray(data.buses) ? data.buses : []) {
    if (!b || !Number.isInteger(b.bus_id) || b.bus_id <= 0 || typeof b.plate !== 'string') continue
    const route_name = nameOrNull(b.route_name)
    const driver_name = nameOrNull(b.driver_name)
    const live = parseLive(b.live)
    if (route_name === undefined || driver_name === undefined || live === undefined) continue
    buses.push({ bus_id: b.bus_id, plate: b.plate, route_name, driver_name, live })
  }
  return { serverTime: data.server_time, buses }
}

// --- row stability ---

function sameLive(a, b) {
  if (a === null || b === null) return a === b
  return (
    a.lat === b.lat && a.lng === b.lng && a.speed === b.speed && a.status === b.status && a.updated_at === b.updated_at
  )
}

// True if every field the card shows is equal.
export function sameBus(a, b) {
  return (
    !!a &&
    !!b &&
    a.bus_id === b.bus_id &&
    a.plate === b.plate &&
    a.route_name === b.route_name &&
    a.driver_name === b.driver_name &&
    sameLive(a.live, b.live)
  )
}

// next in server order, reusing prev's object for a bus that did not change, so
// memoized cards skip re-rendering. Returns prev itself when nothing changed.
export function stabilize(prev, next) {
  const byId = new Map(prev.map((b) => [b.bus_id, b]))
  const out = next.map((b) => {
    const old = byId.get(b.bus_id)
    return sameBus(old, b) ? old : b
  })
  const same = out.length === prev.length && out.every((b, i) => b === prev[i])
  return same ? prev : out
}

// --- age ---

// Seconds between two server times, or null if either cannot be parsed.
export function ageSeconds(serverTime, updatedAt) {
  const s = Date.parse(serverTime)
  const u = Date.parse(updatedAt)
  if (Number.isNaN(s) || Number.isNaN(u)) return null
  return (s - u) / 1000
}

// Age now = age at fetch + time passed since the fetch (both performance.now() ms).
export function displayAge(ageAtFetch, fetchedAt, now) {
  if (ageAtFetch === null || !Number.isFinite(fetchedAt) || !Number.isFinite(now)) return null
  return ageAtFetch + (now - fetchedAt) / 1000
}

// "5 s ago", "2 min 10 s ago", "1 h 5 min ago". Negative (clock rounding) -> 0 s.
export function formatAge(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s ago`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`
}

// Out of service buses stop reporting on purpose, so they are never stale.
export function isStaleAge(seconds, status) {
  return status !== 'out_of_service' && Number.isFinite(seconds) && seconds > STALE_S
}

// --- display ---

function statusInfo(status) {
  return Object.hasOwn(STATUS_INFO, status) ? STATUS_INFO[status] : STATUS_INFO.unknown
}

export function statusLabel(status) {
  return statusInfo(status).label
}

export function statusSymbol(status) {
  return statusInfo(status).glyph
}

// Configuration problems in words.
export function busFlags(bus) {
  const flags = []
  if (bus.driver_name === null) flags.push(FLAG_NO_DRIVER)
  if (bus.route_name === null) flags.push(FLAG_NO_ROUTE)
  if (bus.live === null) flags.push(FLAG_NO_LIVE)
  return flags
}

// Rounded to 5 decimals: 10.0436 -> "10.04360".
export function formatPosition(lat, lng) {
  const f = (n) => (Math.round(n * 1e5) / 1e5 + 0).toFixed(5) // + 0 turns -0 into 0
  return `${f(lat)}, ${f(lng)}`
}

export function formatSpeed(speed) {
  return Number.isFinite(speed) ? `${Math.round(speed)} km/h` : 'Unknown'
}

// ageFn(bus) -> seconds or null (only called for buses with live data).
// -> { total, byStatus: { on_route, delayed, break, out_of_service, unknown }, notReporting, noLive, flagged }
export function summarize(buses, ageFn) {
  const byStatus = { on_route: 0, delayed: 0, break: 0, out_of_service: 0, unknown: 0 }
  let notReporting = 0
  let noLive = 0
  let flagged = 0
  for (const bus of buses) {
    if (busFlags(bus).length > 0) flagged += 1
    if (bus.live === null) {
      noLive += 1
      continue
    }
    byStatus[Object.hasOwn(byStatus, bus.live.status) ? bus.live.status : 'unknown'] += 1
    if (isStaleAge(ageFn(bus), bus.live.status)) notReporting += 1
  }
  return { total: buses.length, byStatus, notReporting, noLive, flagged }
}

// Own wording, never server text. 401 -> null (logout flow takes over).
export function fleetErrorMessage(status) {
  return loadErrorMessage(status)
}
