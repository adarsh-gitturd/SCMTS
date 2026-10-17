// Pure helpers for the admin stops and routes pages (/admin/stops, /admin/routes).
// No React, no fetch. Check: node src/admin/adminLogic.check.js

const NAME_MAX = 100 // characters (Go runes), same as the server
export const ROUTE_STOPS_MAX = 50

// Exact error strings from docs/API.md. Only compared, never shown.
const SERVER_STOP_NOT_FOUND = 'stop not found'
const SERVER_STOP_IN_USE = 'stop is in use'
const SERVER_UNKNOWN_STOP = 'unknown stop id'
const SERVER_ROUTE_NOT_FOUND = 'route not found'
const SERVER_ROUTE_NAME_TAKEN = 'route name already exists'
const SERVER_ROUTE_HAS_BUSES = 'route has buses assigned'

const NETWORK_MESSAGE = 'Cannot reach the server. Check your connection and try again.'
const FORBIDDEN_MESSAGE = 'This page is for admins only.'
const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

// --- responses ---

// GET /stops -> [{ id, name, lat, lng }]. Broken entries are dropped, order kept.
export function parseStopsResponse(data) {
  if (!Array.isArray(data)) return []
  return data
    .filter(
      (s) =>
        s &&
        Number.isInteger(s.id) &&
        s.id > 0 &&
        typeof s.name === 'string' &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng),
    )
    .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))
}

// GET /routes -> [{ id, name, stopIds: [ids in server order] }]. stopIds is always an array.
export function parseRoutesResponse(data) {
  if (!Array.isArray(data)) return []
  return data
    .filter((r) => r && Number.isInteger(r.id) && r.id > 0 && typeof r.name === 'string')
    .map((r) => ({
      id: r.id,
      name: r.name,
      stopIds: Array.isArray(r.stops)
        ? r.stops.filter((s) => s && Number.isInteger(s.stop_id) && s.stop_id > 0).map((s) => s.stop_id)
        : [],
    }))
}

// By name, then id. Returns a new array.
export function sortStops(stops) {
  return [...stops].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

// Rounded to 6 decimals (as stored), no trailing zeros: 13.0102 -> "13.0102".
export function formatCoord(n) {
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 1e6) / 1e6 + 0) // + 0 turns -0 into 0
}

// --- validation ---

// C0 and C1 control characters, like Go's unicode.IsControl.
function isControlChar(ch) {
  const c = ch.codePointAt(0)
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f)
}

// Trimmed, 1..100 characters counted as code points (Go runes), no control characters.
function checkName(name) {
  const value = typeof name === 'string' ? name.trim() : ''
  const chars = [...value]
  if (chars.length === 0) return { value, error: 'Enter a name.' }
  if (chars.length > NAME_MAX) {
    return { value, error: `Use at most ${NAME_MAX} characters (now ${chars.length}).` }
  }
  if (chars.some(isControlChar)) return { value, error: 'Remove tabs and line breaks from the name.' }
  return { value, error: null }
}

// Decimal text -> finite number, or null. Allows "13", "13.", "-13.5", ".5".
// Rejects "", "-", "+1", "1e5", " 1", "Infinity", "abc".
export function parseCoordinate(text) {
  if (typeof text !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n + 0 : null
}

function checkCoordinate(text, label, limit, example) {
  const n = parseCoordinate(text)
  if (n === null) return { value: null, error: `Enter the ${label} as a number, like ${example}.` }
  if (n < -limit || n > limit) {
    return { value: null, error: `The ${label} must be between -${limit} and ${limit}.` }
  }
  return { value: n, error: null }
}

// -> { ok, errors: { name?, lat?, lng? }, body: { name, lat, lng } | null }
export function validateStopForm(name, lat, lng) {
  const n = checkName(name)
  const la = checkCoordinate(lat, 'latitude', 90, '13.0102')
  const lo = checkCoordinate(lng, 'longitude', 180, '80.2355')
  const errors = {}
  if (n.error) errors.name = n.error
  if (la.error) errors.lat = la.error
  if (lo.error) errors.lng = lo.error
  const ok = Object.keys(errors).length === 0
  return { ok, errors, body: ok ? { name: n.value, lat: la.value, lng: lo.value } : null }
}

// -> { ok, errors: { name?, stops? }, body: { name, stops: [ids in order] } | null }
export function validateRouteForm(name, stopIds) {
  const n = checkName(name)
  const errors = {}
  if (n.error) errors.name = n.error
  if (!Array.isArray(stopIds) || stopIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    errors.stops = 'The stop list is not valid. Remove the stops and add them again.'
  } else if (stopIds.length > ROUTE_STOPS_MAX) {
    errors.stops = `A route can have at most ${ROUTE_STOPS_MAX} stops.`
  } else if (new Set(stopIds).size !== stopIds.length) {
    errors.stops = 'Each stop can be in a route only once.'
  }
  const ok = Object.keys(errors).length === 0
  return { ok, errors, body: ok ? { name: n.value, stops: [...stopIds] } : null }
}

// --- route stop list ---

// Swap item at index with its neighbour (dir -1 = up, 1 = down). Same list if it cannot move.
export function moveItem(list, index, dir) {
  const target = index + dir
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list
  if ((dir !== -1 && dir !== 1) || target < 0 || target >= list.length) return list
  const next = [...list]
  next[index] = list[target]
  next[target] = list[index]
  return next
}

// Appends id; same list for an invalid id, a duplicate, or a full list.
export function addStop(list, id) {
  if (!Number.isInteger(id) || id <= 0 || list.includes(id) || list.length >= ROUTE_STOPS_MAX) return list
  return [...list, id]
}

export function removeStop(list, id) {
  return list.filter((x) => x !== id)
}

// Name for a stop id, or a fallback when stops are missing or the stop was deleted.
export function stopName(stopsById, id) {
  return stopsById.get(id)?.name ?? `Stop #${id}`
}

// --- errors ---
// Own wording per status; never server text. serverMessage (ApiError.message) is only
// compared with the documented strings. 401 -> null (logout flow takes over).

export function loadErrorMessage(status) {
  if (status === 401) return null
  if (status === 0) return NETWORK_MESSAGE
  if (status === 403) return FORBIDDEN_MESSAGE
  return GENERIC_MESSAGE
}

export function stopErrorMessage(status, serverMessage) {
  switch (status) {
    case 400:
      return 'Please check the name and coordinates.'
    case 404:
      return serverMessage === SERVER_STOP_NOT_FOUND
        ? 'That stop no longer exists. The list was refreshed.'
        : GENERIC_MESSAGE
    case 409:
      return serverMessage === SERVER_STOP_IN_USE
        ? 'This stop is used by a route, a trip or a passenger log, so it cannot be deleted.'
        : GENERIC_MESSAGE
    default:
      return loadErrorMessage(status)
  }
}

// true when the stop is gone: the list must be refetched.
export function stopIsGone(status, serverMessage) {
  return status === 404 && serverMessage === SERVER_STOP_NOT_FOUND
}

export function routeErrorMessage(status, serverMessage) {
  switch (status) {
    case 400:
      return serverMessage === SERVER_UNKNOWN_STOP
        ? 'One of the stops no longer exists. The list was refreshed.'
        : 'Please check the name and stops.'
    case 404:
      return serverMessage === SERVER_ROUTE_NOT_FOUND
        ? 'That route no longer exists. The list was refreshed.'
        : GENERIC_MESSAGE
    case 409:
      if (serverMessage === SERVER_ROUTE_NAME_TAKEN) return 'A route with that name already exists.'
      if (serverMessage === SERVER_ROUTE_HAS_BUSES) return 'This route has buses assigned. Reassign them first.'
      return GENERIC_MESSAGE
    default:
      return loadErrorMessage(status)
  }
}

// Which list to refetch after a route error: 'routes' (route gone), 'stops' (a stop gone), or null.
export function routeErrorRefetch(status, serverMessage) {
  if (status === 404 && serverMessage === SERVER_ROUTE_NOT_FOUND) return 'routes'
  if (status === 400 && serverMessage === SERVER_UNKNOWN_STOP) return 'stops'
  return null
}
