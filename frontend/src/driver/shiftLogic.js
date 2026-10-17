// Pure helpers for the driver shift controls (POST /driver/location, PATCH /driver/status).
// No React, no fetch, no geolocation.

// Same symbols as map/busIcons.js (not imported: it pulls in Leaflet). Text is always shown too.
export const SHIFT_STATUSES = [
  { value: 'on_route', label: 'On route', glyph: '▶' },
  { value: 'delayed', label: 'Delayed', glyph: '!' },
  { value: 'break', label: 'Break', glyph: '‖' },
  { value: 'out_of_service', label: 'Out of service', glyph: '✕' },
]

const MAX_SPEED_KMH = 200 // server rejects above this

export function isValidStatus(s) {
  return SHIFT_STATUSES.some((o) => o.value === s)
}

// Label for a status value; 'Unknown' for null or anything else.
export function statusLabel(s) {
  return SHIFT_STATUSES.find((o) => o.value === s)?.label ?? 'Unknown'
}

// coords.speed is m/s and often null. Returns km/h in 0..200, one decimal (DECIMAL(5,1)).
export function speedKmh(coords) {
  const s = coords?.speed
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return 0
  return Math.round(Math.min(s * 3.6, MAX_SPEED_KMH) * 10) / 10
}

// fix: { latitude, longitude, speed } (a copy of GeolocationCoordinates).
// Returns exactly { lat, lng, speed } or null when the position is unusable. No timestamp.
export function buildLocationBody(fix) {
  const lat = fix?.latitude
  const lng = fix?.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }
  return { lat, lng, speed: speedKmh(fix) }
}

// What to do when a periodic location POST fails.
// 'reject' skip and count | 'skip' silent | 'logout' client handles 401 |
// 'forbidden' / 'no-bus' stop sharing | 'retry' keep trying (network, 5xx, anything else)
export function locationErrorOutcome(status) {
  switch (status) {
    case 400:
      return 'reject'
    case 429:
      return 'skip'
    case 401:
      return 'logout'
    case 403:
      return 'forbidden'
    case 404:
      return 'no-bus'
    default:
      return 'retry'
  }
}

export const FORBIDDEN_MESSAGE = 'This page is for drivers only.'
export const NO_BUS_MESSAGE = 'No bus is assigned to you. Ask an admin.'

// Own wording for a failed PATCH /driver/status; never server text. 401 -> null (logout flow).
export function statusErrorMessage(status) {
  switch (status) {
    case 401:
      return null
    case 400:
      return 'That status was not accepted.'
    case 403:
      return FORBIDDEN_MESSAGE
    case 404:
      return NO_BUS_MESSAGE
    case 409:
      return 'Send a location first.'
    default:
      return 'Could not change status. Try again.'
  }
}

// Own wording when Start shift fails (first location POST or the on_route PATCH).
export function startErrorMessage(status) {
  switch (status) {
    case 401:
      return null
    case 403:
      return FORBIDDEN_MESSAGE
    case 404:
      return NO_BUS_MESSAGE
    default:
      return 'Could not start the shift. Try again.'
  }
}

// Checks the 200 body { bus_id, status }. Returns it or null.
export function parseStatusResponse(data) {
  if (!data || !Number.isInteger(data.bus_id) || data.bus_id <= 0 || !isValidStatus(data.status)) return null
  return { bus_id: data.bus_id, status: data.status }
}

// ms -> 'HH:MM:SS' in local time; '' for a missing or bad value.
export function formatClock(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
