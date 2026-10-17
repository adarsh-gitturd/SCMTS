// Pure helpers for the trip history page and rating form. No imports, no side
// effects, so they can be checked from node: node src/history/historyLogic.check.js

function intOrNull(v) {
  return v === null || Number.isInteger(v)
}

function stringOrNull(v) {
  return v === null || typeof v === 'string'
}

function validTrip(t) {
  return (
    t !== null &&
    typeof t === 'object' &&
    Number.isInteger(t.id) &&
    t.id > 0 &&
    (t.status === 'started' || t.status === 'completed') &&
    typeof t.destination === 'string' &&
    Number.isInteger(t.destination_stop_id) &&
    intOrNull(t.route_id) &&
    intOrNull(t.bus_id) &&
    intOrNull(t.board_stop_id) &&
    (t.rating === null || (Number.isInteger(t.rating) && t.rating >= 1 && t.rating <= 5)) &&
    stringOrNull(t.feedback) &&
    typeof t.started_at === 'string' &&
    t.started_at !== '' &&
    stringOrNull(t.ended_at)
  )
}

// GET /api/trips body -> trips kept in state. Not an array -> []. Order is the
// API's (newest first); malformed entries are dropped so one bad row cannot
// break the whole list.
export function parseTripsResponse(data) {
  if (!Array.isArray(data)) return []
  return data.filter(validTrip).map((t) => ({
    id: t.id,
    status: t.status,
    destination: t.destination,
    destination_stop_id: t.destination_stop_id,
    route_id: t.route_id,
    bus_id: t.bus_id,
    board_stop_id: t.board_stop_id,
    rating: t.rating,
    feedback: t.feedback,
    started_at: t.started_at,
    ended_at: t.ended_at,
  }))
}

// UI rule only (not enforced by the backend): a trip can be rated when it is
// still started and actually had a bus. A started trip with no bus never got a
// recommendation, so there is nothing to rate.
export function canRate(trip) {
  return !!trip && trip.status === 'started' && Number.isInteger(trip.bus_id)
}

// "Rated 4 of 5", or null when there is no rating yet.
export function ratingLabel(rating) {
  if (!Number.isInteger(rating)) return null
  return `Rated ${rating} of 5`
}

// RFC3339 UTC string -> readable text in the browser's local time zone. Falls
// back to the raw string so a card never shows "Invalid Date".
export function formatStartedAt(iso) {
  if (typeof iso !== 'string' || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

// A rating is valid only as an integer 1..5.
export function validateRating(n) {
  return Number.isInteger(n) && n >= 1 && n <= 5
}

// Body for PATCH /api/trip/{id}/complete, field names as in docs/API.md.
// Feedback is trimmed; empty feedback is omitted (the API stores it as null).
export function buildCompleteRequest(rating, feedback) {
  const body = { rating }
  const trimmed = typeof feedback === 'string' ? feedback.trim() : ''
  if (trimmed !== '') body.feedback = trimmed
  return body
}

// Our own wording per documented status; server error text is never shown.
// null = show nothing (401: the client's logout flow takes over).
export function completeErrorMessage(status) {
  switch (status) {
    case 0:
      return 'Cannot reach the server. Check your connection and try again.'
    case 400:
      return 'That rating was not valid. Choose 1 to 5.'
    case 401:
      return null
    case 403:
      return 'Only students can rate trips.'
    case 404:
      return 'That trip was not found.'
    case 409:
      return 'This trip was already rated.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
