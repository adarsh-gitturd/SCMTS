// Manual check for shiftLogic.js. Run from frontend/: node src/driver/shiftLogic.check.js
import assert from 'node:assert/strict'
import {
  buildLocationBody,
  formatClock,
  isValidStatus,
  locationErrorOutcome,
  parseStatusResponse,
  speedKmh,
  startErrorMessage,
  statusErrorMessage,
  statusLabel,
} from './shiftLogic.js'

// speedKmh: m/s -> km/h, 0 for null/NaN/negative, clamped to 200, one decimal
assert.equal(speedKmh({ speed: 10 }), 36)
assert.equal(speedKmh({ speed: 6.1 }), 22) // 21.96 -> 22.0
assert.equal(speedKmh({ speed: 1.2345 }), 4.4)
assert.equal(speedKmh({ speed: 0 }), 0)
assert.equal(speedKmh({ speed: null }), 0)
assert.equal(speedKmh({ speed: undefined }), 0)
assert.equal(speedKmh({ speed: NaN }), 0)
assert.equal(speedKmh({ speed: -3 }), 0)
assert.equal(speedKmh({ speed: Infinity }), 0)
assert.equal(speedKmh({ speed: '10' }), 0)
assert.equal(speedKmh({ speed: 100 }), 200) // 360 km/h clamped
assert.equal(speedKmh({}), 0)
assert.equal(speedKmh(null), 0)

// buildLocationBody: exactly { lat, lng, speed }, no timestamp, speed always a finite number
const fix = { latitude: 13.01, longitude: 80.23, speed: 6.1, accuracy: 5, timestamp: 123 }
assert.deepEqual(buildLocationBody(fix), { lat: 13.01, lng: 80.23, speed: 22 })
assert.deepEqual(Object.keys(buildLocationBody(fix)).sort(), ['lat', 'lng', 'speed'])
assert.deepEqual(buildLocationBody({ latitude: 0, longitude: 0, speed: null }), { lat: 0, lng: 0, speed: 0 })
assert.deepEqual(buildLocationBody({ latitude: -90, longitude: 180 }), { lat: -90, lng: 180, speed: 0 })
assert.equal(buildLocationBody(null), null)
assert.equal(buildLocationBody({ latitude: NaN, longitude: 80 }), null)
assert.equal(buildLocationBody({ latitude: 13, longitude: Infinity }), null)
assert.equal(buildLocationBody({ latitude: 90.1, longitude: 80 }), null)
assert.equal(buildLocationBody({ latitude: 13, longitude: -180.1 }), null)
assert.equal(buildLocationBody({ latitude: '13', longitude: 80 }), null)

// locationErrorOutcome
assert.equal(locationErrorOutcome(400), 'reject')
assert.equal(locationErrorOutcome(429), 'skip')
assert.equal(locationErrorOutcome(401), 'logout')
assert.equal(locationErrorOutcome(403), 'forbidden')
assert.equal(locationErrorOutcome(404), 'no-bus')
for (const status of [0, 500, 502, 503, 413, undefined]) {
  assert.equal(locationErrorOutcome(status), 'retry')
}

// statusErrorMessage / startErrorMessage: own wording, nothing for 401
assert.equal(statusErrorMessage(401), null)
assert.equal(statusErrorMessage(409), 'Send a location first.')
assert.equal(statusErrorMessage(400), 'That status was not accepted.')
assert.equal(statusErrorMessage(403), 'This page is for drivers only.')
assert.equal(statusErrorMessage(404), 'No bus is assigned to you. Ask an admin.')
for (const status of [0, 500, 502, 418, undefined]) {
  assert.equal(statusErrorMessage(status), 'Could not change status. Try again.')
}
assert.equal(startErrorMessage(401), null)
assert.equal(startErrorMessage(403), 'This page is for drivers only.')
assert.equal(startErrorMessage(404), 'No bus is assigned to you. Ask an admin.')
for (const status of [0, 400, 429, 500, undefined]) {
  assert.equal(startErrorMessage(status), 'Could not start the shift. Try again.')
}

// isValidStatus / statusLabel
for (const s of ['on_route', 'delayed', 'break', 'out_of_service']) assert.equal(isValidStatus(s), true)
for (const s of ['', 'Delayed', 'on route', ' delayed', 'unknown', null, undefined, 1]) assert.equal(isValidStatus(s), false)
assert.equal(statusLabel('on_route'), 'On route')
assert.equal(statusLabel('delayed'), 'Delayed')
assert.equal(statusLabel('break'), 'Break')
assert.equal(statusLabel('out_of_service'), 'Out of service')
assert.equal(statusLabel(null), 'Unknown')
assert.equal(statusLabel('nope'), 'Unknown')

// parseStatusResponse
assert.deepEqual(parseStatusResponse({ bus_id: 7, status: 'delayed' }), { bus_id: 7, status: 'delayed' })
assert.deepEqual(parseStatusResponse({ bus_id: 7, status: 'break', extra: 1 }), { bus_id: 7, status: 'break' })
assert.equal(parseStatusResponse(null), null)
assert.equal(parseStatusResponse({ bus_id: '7', status: 'delayed' }), null)
assert.equal(parseStatusResponse({ bus_id: 0, status: 'delayed' }), null)
assert.equal(parseStatusResponse({ bus_id: 7, status: 'late' }), null)
assert.equal(parseStatusResponse({ bus_id: 7 }), null)

// formatClock: local time, zero padded
assert.equal(formatClock(new Date(2026, 9, 17, 9, 5, 7).getTime()), '09:05:07')
assert.equal(formatClock(new Date(2026, 9, 17, 23, 59, 59).getTime()), '23:59:59')
assert.equal(formatClock(new Date(2026, 9, 17, 0, 0, 0).getTime()), '00:00:00')
assert.equal(formatClock(null), '')
assert.equal(formatClock(NaN), '')

process.stdout.write('shiftLogic: all checks passed\n')
