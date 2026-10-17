// Manual check for passengerLogic.js. Run from frontend/: node src/driver/passengerLogic.check.js
import assert from 'node:assert/strict'
import {
  buildPassengerBody,
  parseCount,
  parseCreated,
  passengerErrorMessage,
  successMessage,
} from './passengerLogic.js'

// parseCount: integer 0..200 from digits only
assert.equal(parseCount('0'), 0)
assert.equal(parseCount('18'), 18)
assert.equal(parseCount('200'), 200)
assert.equal(parseCount('018'), 18)
for (const t of ['', '-1', '201', '18.5', '18.0', '1e2', '+5', ' 5 ', '5 ', ' 5', '-0', 'abc', '0x10', '99999999999999999999']) {
  assert.equal(parseCount(t), null, `parseCount(${JSON.stringify(t)})`)
}
for (const v of [null, undefined, 18, NaN]) assert.equal(parseCount(v), null)

// buildPassengerBody: exactly { count, stop_id }, numbers
assert.deepEqual(buildPassengerBody(3, 18), { count: 18, stop_id: 3 })
assert.deepEqual(buildPassengerBody(3, 0), { count: 0, stop_id: 3 })
assert.deepEqual(Object.keys(buildPassengerBody(3, 18)).sort(), ['count', 'stop_id'])
assert.equal(buildPassengerBody(0, 18), null)
assert.equal(buildPassengerBody(-3, 18), null)
assert.equal(buildPassengerBody('3', 18), null)
assert.equal(buildPassengerBody(3, '18'), null)
assert.equal(buildPassengerBody(3, 18.5), null)
assert.equal(buildPassengerBody(3, -1), null)
assert.equal(buildPassengerBody(3, 201), null)
assert.equal(buildPassengerBody(3, null), null)

// passengerErrorMessage: own wording, exact server strings only to tell variants apart
assert.equal(passengerErrorMessage(401, 'unauthorized'), null)
assert.equal(passengerErrorMessage(400, 'stop is not on your route'), 'That stop is not on your route.')
assert.equal(passengerErrorMessage(400, 'count must be an integer between 0 and 200'), 'That count or stop was not accepted. Check the values.')
assert.equal(passengerErrorMessage(400, 'Stop is not on your route.'), 'That count or stop was not accepted. Check the values.')
assert.equal(passengerErrorMessage(400, undefined), 'That count or stop was not accepted. Check the values.')
assert.equal(passengerErrorMessage(403, 'forbidden'), 'This page is for drivers only.')
assert.equal(passengerErrorMessage(404, 'no bus assigned'), 'No bus is assigned to you. Ask an admin.')
assert.equal(passengerErrorMessage(404, 'stop not found'), 'That stop no longer exists. Reload the page.')
assert.equal(passengerErrorMessage(404, 'request failed (404)'), 'Something went wrong. Please try again.')
assert.equal(passengerErrorMessage(404, undefined), 'Something went wrong. Please try again.')
assert.equal(passengerErrorMessage(409, 'no route assigned'), 'Your bus has no route assigned. Ask an admin.')
assert.equal(passengerErrorMessage(429, 'too many updates'), 'Please wait a second before logging again.')
assert.equal(passengerErrorMessage(0, 'network error'), 'Cannot reach the server. Check your connection and try again.')
for (const status of [500, 502, 503, 413, 418, undefined]) {
  assert.equal(passengerErrorMessage(status, 'internal error'), 'Something went wrong. Please try again.')
}

// successMessage: singular only for 1
assert.equal(successMessage(1, 'Library'), 'Logged 1 passenger at Library')
assert.equal(successMessage(0, 'Library'), 'Logged 0 passengers at Library')
assert.equal(successMessage(18, 'Main Gate'), 'Logged 18 passengers at Main Gate')

// parseCreated: positive integer id
assert.equal(parseCreated({ id: 311 }), 311)
assert.equal(parseCreated({ id: 311, extra: 1 }), 311)
for (const d of [null, undefined, {}, { id: '311' }, { id: 0 }, { id: -1 }, { id: 3.5 }, []]) {
  assert.equal(parseCreated(d), null)
}

process.stdout.write('passengerLogic: all checks passed\n')
