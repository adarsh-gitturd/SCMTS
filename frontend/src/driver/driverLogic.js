// Pure helpers for the driver route page (GET /driver/route). No React, no fetch.

function validStop(s) {
  return (
    s &&
    Number.isInteger(s.stop_id) &&
    typeof s.name === 'string' &&
    s.name.trim() !== '' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    Number.isInteger(s.order)
  )
}

// Returns { bus_id, plate, route: null | { id, name, stops: [...] } } or null when
// the response shape is wrong. Broken stops are dropped; API order is kept.
export function parseDriverRoute(data) {
  if (!data || !Number.isInteger(data.bus_id) || data.bus_id <= 0 || typeof data.plate !== 'string') {
    return null
  }
  if (data.route === null) {
    return { bus_id: data.bus_id, plate: data.plate, route: null }
  }
  const r = data.route
  if (!r || !Number.isInteger(r.id) || typeof r.name !== 'string' || !Array.isArray(r.stops)) {
    return null
  }
  const stops = r.stops
    .filter(validStop)
    .map((s) => ({ stop_id: s.stop_id, name: s.name, lat: s.lat, lng: s.lng, order: s.order }))
  return { bus_id: data.bus_id, plate: data.plate, route: { id: r.id, name: r.name, stops } }
}

// Own wording per status; never server text. 401 -> null (logout flow takes over).
export function driverRouteErrorMessage(status) {
  switch (status) {
    case 401:
      return null
    case 0:
      return 'Cannot reach the server. Check your connection and try again.'
    case 403:
      return 'This page is for drivers only.'
    case 404:
      return 'No bus is assigned to you. Ask an admin.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

// state: { phase: 'loading' | 'ready' | 'error', status, data }
// data is the parseDriverRoute result (null = bad response).
// Returns 'loading' | 'route' | 'no-stops' | 'no-route' | 'no-bus' | 'forbidden' | 'network' | 'error' | 'none'
export function driverRouteView(state) {
  if (!state || state.phase === 'loading') return 'loading'
  if (state.phase === 'error') {
    switch (state.status) {
      case 401:
        return 'none'
      case 0:
        return 'network'
      case 403:
        return 'forbidden'
      case 404:
        return 'no-bus'
      default:
        return 'error'
    }
  }
  const data = state.data
  if (!data) return 'error'
  if (data.route === null) return 'no-route'
  if (data.route.stops.length === 0) return 'no-stops'
  return 'route'
}

// Converts a parsed route into the shapes StaticLayer takes (GET /routes, GET /stops).
export function toMapLayers(route) {
  if (!route) return { routes: [], stops: [] }
  return {
    routes: [{ id: route.id, name: route.name, stops: route.stops.map((s) => ({ stop_id: s.stop_id, order: s.order })) }],
    stops: route.stops.map((s) => ({ id: s.stop_id, name: s.name, lat: s.lat, lng: s.lng })),
  }
}
