// Manual check for tripLogic.js. Run from frontend/: node src/trip/tripLogic.check.js
import assert from 'node:assert/strict'
import {
  buildTripRequest,
  originFallbackMessage,
  parseTripResponse,
  sortStopsByName,
  stopLabel,
  tripErrorMessage,
} from './tripLogic.js'

// sortStopsByName: by name, ties by id, input not mutated
const stops = [
  { id: 3, name: 'Library' },
  { id: 1, name: 'Hostel' },
  { id: 2, name: 'Library' },
]
assert.deepEqual(
  sortStopsByName(stops).map((s) => s.id),
  [1, 2, 3],
)
assert.equal(stops[0].id, 3)

// buildTripRequest: exact shape from docs/API.md
assert.deepEqual(buildTripRequest({ lat: 13.01, lng: 80.23, extra: 1 }, 5), {
  origin: { lat: 13.01, lng: 80.23 },
  destination: { stop_id: 5 },
})

// parseTripResponse
const rec = { bus_id: 7, route_id: 1, eta_minutes: 6, board_stop_id: 3, distance_m: 850, rank: 1 }
assert.deepEqual(parseTripResponse({ trip_id: 42, recommendations: [rec] }, 5), {
  trip_id: 42,
  destination_stop_id: 5,
  recommendations: [rec],
})
assert.deepEqual(parseTripResponse({ trip_id: 43, recommendations: [] }, 5).recommendations, [])
assert.equal(parseTripResponse({ trip_id: 42, recommendations: [rec, { bus_id: 'x' }, null] }, 5).recommendations.length, 1)
assert.equal(parseTripResponse(null, 5), null)
assert.equal(parseTripResponse({ trip_id: 0, recommendations: [] }, 5), null)
assert.equal(parseTripResponse({ trip_id: '42', recommendations: [] }, 5), null)
assert.equal(parseTripResponse({ trip_id: 42 }, 5), null)

// tripErrorMessage: own wording, nothing for 401
assert.equal(tripErrorMessage(401), null)
for (const status of [0, 400, 403, 404, 500, 502, 503, 418]) {
  assert.equal(typeof tripErrorMessage(status), 'string')
}
assert.equal(tripErrorMessage(500), tripErrorMessage(503))

// originFallbackMessage: every reason has a message
for (const reason of ['denied', 'timeout', 'unsupported', 'unavailable', undefined]) {
  assert.match(originFallbackMessage(reason), /Choose the stop/)
}

// stopLabel
const byId = new Map([[3, { id: 3, name: 'Library' }]])
assert.equal(stopLabel(byId, 3), 'Library')
assert.equal(stopLabel(byId, 9), 'Stop #9')

process.stdout.write('tripLogic: all checks passed\n')
