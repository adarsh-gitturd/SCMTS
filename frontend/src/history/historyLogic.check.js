// Manual check for historyLogic.js. Run from frontend/: node src/history/historyLogic.check.js
import assert from 'node:assert/strict'
import {
  buildCompleteRequest,
  canRate,
  completeErrorMessage,
  formatStartedAt,
  parseTripsResponse,
  ratingLabel,
  validateRating,
} from './historyLogic.js'

const good = {
  id: 42,
  status: 'completed',
  destination: 'Library',
  destination_stop_id: 5,
  route_id: 1,
  bus_id: 7,
  board_stop_id: 3,
  rating: 4,
  feedback: 'On time',
  started_at: '2026-10-17T10:56:14Z',
  ended_at: '2026-10-17T11:20:02Z',
}

// parseTripsResponse: not an array -> []
assert.deepEqual(parseTripsResponse(null), [])
assert.deepEqual(parseTripsResponse({}), [])
assert.deepEqual(parseTripsResponse([]), [])

// keeps a good trip, preserves order, drops broken entries
const started = {
  ...good,
  id: 43,
  status: 'started',
  rating: null,
  feedback: null,
  ended_at: null,
}
const parsed = parseTripsResponse([good, { id: 'x' }, null, started, { ...good, status: 'bogus' }])
assert.deepEqual(
  parsed.map((t) => t.id),
  [42, 43],
)
// nulls for optional fields survive
assert.equal(parsed[1].bus_id, 7)
assert.equal(parsed[1].rating, null)
assert.equal(parsed[1].ended_at, null)

// null route_id / bus_id / board_stop_id are valid
assert.equal(parseTripsResponse([{ ...started, route_id: null, bus_id: null, board_stop_id: null }]).length, 1)
// rating out of range is dropped
assert.equal(parseTripsResponse([{ ...good, rating: 6 }]).length, 0)
assert.equal(parseTripsResponse([{ ...good, rating: 0 }]).length, 0)
// empty started_at dropped
assert.equal(parseTripsResponse([{ ...good, started_at: '' }]).length, 0)
// id must be positive
assert.equal(parseTripsResponse([{ ...good, id: 0 }]).length, 0)

// canRate: started + bus only
assert.equal(canRate({ status: 'started', bus_id: 7 }), true)
assert.equal(canRate({ status: 'started', bus_id: null }), false)
assert.equal(canRate({ status: 'completed', bus_id: 7 }), false)
assert.equal(canRate(null), false)

// ratingLabel
assert.equal(ratingLabel(4), 'Rated 4 of 5')
assert.equal(ratingLabel(null), null)
assert.equal(ratingLabel('4'), null)

// formatStartedAt: real UTC string -> readable text (local zone, so only check
// it rendered the date, not an exact clock time); bad input -> raw fallback
assert.match(formatStartedAt('2026-10-17T10:56:14Z'), /Oct.*2026/)
assert.equal(formatStartedAt('not a date'), 'not a date') // fallback to raw
assert.equal(formatStartedAt(''), '')
assert.equal(formatStartedAt(null), '')

// validateRating
for (const n of [1, 2, 3, 4, 5]) assert.equal(validateRating(n), true)
for (const n of [0, 6, -1, 2.5, '3', null, undefined]) assert.equal(validateRating(n), false)

// buildCompleteRequest: feedback trimmed, empty omitted
assert.deepEqual(buildCompleteRequest(4, 'On time'), { rating: 4, feedback: 'On time' })
assert.deepEqual(buildCompleteRequest(4, '  spaced  '), { rating: 4, feedback: 'spaced' })
assert.deepEqual(buildCompleteRequest(4, '   '), { rating: 4 })
assert.deepEqual(buildCompleteRequest(4, ''), { rating: 4 })
assert.deepEqual(buildCompleteRequest(4, undefined), { rating: 4 })

// completeErrorMessage: own wording, nothing for 401
assert.equal(completeErrorMessage(401), null)
for (const status of [0, 400, 403, 404, 409, 500, 503, 418]) {
  assert.equal(typeof completeErrorMessage(status), 'string')
}
assert.equal(completeErrorMessage(500), completeErrorMessage(503))

process.stdout.write('historyLogic: all checks passed\n')
