// Pure helpers for the trip request. No imports, no side effects, so they can be
// checked from node: node src/trip/tripLogic.check.js

export function sortStopsByName(stops) {
  return [...stops].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.id - b.id)
}

// Body for POST /api/trip/create, field names as in docs/API.md.
export function buildTripRequest(origin, destStopId) {
  return { origin: { lat: origin.lat, lng: origin.lng }, destination: { stop_id: destStopId } }
}

function validRecommendation(r) {
  return (
    r !== null &&
    typeof r === 'object' &&
    Number.isInteger(r.bus_id) &&
    Number.isInteger(r.route_id) &&
    Number.isInteger(r.board_stop_id) &&
    Number.isInteger(r.eta_minutes) &&
    r.eta_minutes >= 0 &&
    Number.isInteger(r.distance_m) &&
    Number.isInteger(r.rank)
  )
}

// 201 body -> result kept in state, or null if the body is not usable.
// Recommendations keep the API's order and values; malformed entries are dropped.
export function parseTripResponse(data, destStopId) {
  if (!data || typeof data !== 'object') return null
  if (!Number.isInteger(data.trip_id) || data.trip_id <= 0) return null
  if (!Array.isArray(data.recommendations)) return null
  return {
    trip_id: data.trip_id,
    destination_stop_id: destStopId,
    recommendations: data.recommendations.filter(validRecommendation).map((r) => ({
      bus_id: r.bus_id,
      route_id: r.route_id,
      board_stop_id: r.board_stop_id,
      eta_minutes: r.eta_minutes,
      distance_m: r.distance_m,
      rank: r.rank,
    })),
  }
}

// Our own wording per status; server error text is never shown.
// null = show nothing (401: the client's logout flow takes over).
export function tripErrorMessage(status) {
  switch (status) {
    case 0:
      return 'Cannot reach the server. Check your connection and try again.'
    case 400:
      return 'Your trip request was not valid. Please choose the stops again.'
    case 401:
      return null
    case 403:
      return 'Only students can request a trip.'
    case 404:
      return 'That stop no longer exists. Reload the page and choose another.'
    default:
      return 'Something went wrong on the server. Please try again.'
  }
}

// Why we fell back to picking an origin stop (reason from geolocation.js).
export function originFallbackMessage(reason) {
  switch (reason) {
    case 'denied':
      return 'Location permission is off. Choose the stop you are at instead.'
    case 'timeout':
      return 'Finding your location took too long. Choose the stop you are at instead.'
    case 'unsupported':
      return 'This browser cannot share your location here. Choose the stop you are at instead.'
    default:
      return 'Your location is not available right now. Choose the stop you are at instead.'
  }
}

export function stopLabel(stopsById, id) {
  const s = stopsById.get(id)
  return s && typeof s.name === 'string' && s.name !== '' ? s.name : `Stop #${id}`
}
