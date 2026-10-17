// Pure helpers for the advisor card and the nearby buses list. Only pure imports,
// so they can be checked from node: node src/advisor/advisorLogic.check.js
import { haversineM } from '../geo/haversine.js'
import { isStale } from '../map/liveBusLogic.js'
import { stopLabel } from '../trip/tripLogic.js'

export const NEARBY_LIMIT = 5
const DISTANCE_STEP_M = 10 // nearby distances are rounded to this, so tiny moves do not reorder the list
const UNAVAILABLE = new Set(['break', 'out_of_service']) // never recommended (docs/SPEC.md)

export function formatDistance(m) {
  if (!Number.isFinite(m) || m < 0) return 'n/a'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function etaText(minutes) {
  return minutes === 0 ? 'under 1 min' : `${minutes} min`
}

export function speedText(speed) {
  return Number.isFinite(speed) ? `${Math.round(speed)} km/h` : 'speed n/a'
}

// Local HH:MM for a ms timestamp.
export function clockHHMM(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Trip state -> 'none' | 'empty' | 'result'
export function cardView(state) {
  if (state.phase !== 'success' || !state.result) return 'none'
  return state.result.recommendations.length === 0 ? 'empty' : 'result'
}

export function routeLabel(routeNames, routeId) {
  if (!Number.isInteger(routeId)) return 'Route unknown'
  const name = routeNames.get(routeId)
  return typeof name === 'string' && name !== '' ? name : `Route #${routeId}`
}

// GET /buses body -> Map bus_id -> route_id. Positions in the body are ignored.
export function busRouteMap(list) {
  const map = new Map()
  if (!Array.isArray(list)) return map
  for (const b of list) {
    if (b && Number.isInteger(b.id) && Number.isInteger(b.route_id)) map.set(b.id, b.route_id)
  }
  return map
}

// Live status of the recommended bus, in words. info = STATUS_INFO from busIcons.js.
// kind: 'ok' | 'changed' (now on break / out of service) | 'stale' | 'missing'
export function liveStatus(bus, now, info) {
  if (!bus) return { kind: 'missing', glyph: '?', text: 'Live position not available right now.' }
  const s = info[bus.status] ?? info.unknown
  if (isStale(bus, now)) {
    return { kind: 'stale', glyph: s.glyph, text: `No live update since ${clockHHMM(Date.parse(bus.ts))}.` }
  }
  if (UNAVAILABLE.has(bus.status)) {
    return {
      kind: 'changed',
      glyph: s.glyph,
      text: `Status changed: ${s.label}. This bus may not come; see the other options or start over.`,
    }
  }
  return { kind: 'ok', glyph: s.glyph, text: `${s.label}, ${speedText(bus.speed)}` }
}

// Which stop the nearby list measures from: the top pick's board stop, else the
// stop picked in manual mode. Only stop coordinates (D1), never GPS.
// -> { stopId, label, kind: 'board' | 'origin', point: { lat, lng } } or null
export function nearbyReference(result, originStopId, stopsById) {
  const top = result?.recommendations[0]
  const board = top ? stopsById.get(top.board_stop_id) : undefined
  if (board) return makeReference(board, 'board', stopsById)
  const origin = originStopId === null ? undefined : stopsById.get(originStopId)
  if (origin) return makeReference(origin, 'origin', stopsById)
  return null
}

function makeReference(stop, kind, stopsById) {
  return { stopId: stop.id, label: stopLabel(stopsById, stop.id), kind, point: { lat: stop.lat, lng: stop.lng } }
}

// Live buses nearest to point, fresh ones only, at most limit.
// -> { rows: [{ bus_id, route, status, speed, distance_m }], hiddenStale }
export function nearbyRows(buses, point, busRoutes, routeNames, now, limit = NEARBY_LIMIT) {
  const rows = []
  let hiddenStale = 0
  for (const bus of buses.values()) {
    if (isStale(bus, now)) {
      hiddenStale += 1
      continue
    }
    const routeId = busRoutes.get(bus.bus_id)
    rows.push({
      bus_id: bus.bus_id,
      route: routeId === undefined ? 'Route unknown' : routeLabel(routeNames, routeId),
      status: bus.status,
      speed: Number.isFinite(bus.speed) ? Math.round(bus.speed) : null,
      distance_m: Math.round(haversineM(point, bus) / DISTANCE_STEP_M) * DISTANCE_STEP_M,
    })
  }
  rows.sort((a, b) => a.distance_m - b.distance_m || a.bus_id - b.bus_id)
  return { rows: rows.slice(0, limit), hiddenStale }
}

// True if two nearbyRows results would look the same on screen.
export function sameNearby(a, b) {
  if (a.hiddenStale !== b.hiddenStale || a.rows.length !== b.rows.length) return false
  return a.rows.every((r, i) => {
    const o = b.rows[i]
    return (
      r.bus_id === o.bus_id &&
      r.route === o.route &&
      r.status === o.status &&
      r.speed === o.speed &&
      r.distance_m === o.distance_m
    )
  })
}
