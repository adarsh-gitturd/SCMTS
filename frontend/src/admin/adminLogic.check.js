// Manual check for adminLogic.js. Run from frontend/: node src/admin/adminLogic.check.js
import assert from 'node:assert/strict'
import {
  addStop,
  formatCoord,
  loadErrorMessage,
  moveItem,
  parseCoordinate,
  parseRoutesResponse,
  parseStopsResponse,
  removeStop,
  routeErrorMessage,
  routeErrorRefetch,
  sortStops,
  stopErrorMessage,
  stopIsGone,
  stopName,
  validateRouteForm,
  validateStopForm,
} from './adminLogic.js'

const NETWORK = 'Cannot reach the server. Check your connection and try again.'
const FORBIDDEN = 'This page is for admins only.'
const GENERIC = 'Something went wrong. Please try again.'

// parseStopsResponse: drops broken entries, keeps order, only known fields
assert.deepEqual(
  parseStopsResponse([
    { id: 3, name: 'Library', lat: 13.0102, lng: 80.2355, extra: 1 },
    { id: '4', name: 'X', lat: 1, lng: 1 },
    { id: 5, name: null, lat: 1, lng: 1 },
    { id: 6, name: 'Y', lat: '1', lng: 1 },
    null,
    { id: 0, name: 'Z', lat: 1, lng: 1 },
    { id: 2, name: 'Gate', lat: -1, lng: 0 },
  ]),
  [
    { id: 3, name: 'Library', lat: 13.0102, lng: 80.2355 },
    { id: 2, name: 'Gate', lat: -1, lng: 0 },
  ],
)
for (const d of [null, undefined, {}, 'x']) assert.deepEqual(parseStopsResponse(d), [])

// parseRoutesResponse: stopIds always an array, server order kept
assert.deepEqual(
  parseRoutesResponse([
    { id: 1, name: 'A', stops: [{ stop_id: 3, order: 1 }, { stop_id: 1, order: 2 }, { stop_id: 'x' }, null] },
    { id: 2, name: 'B', stops: null },
    { id: 3, name: 'C' },
    { id: 'x', name: 'D', stops: [] },
    { id: 4, stops: [] },
  ]),
  [
    { id: 1, name: 'A', stopIds: [3, 1] },
    { id: 2, name: 'B', stopIds: [] },
    { id: 3, name: 'C', stopIds: [] },
  ],
)
assert.deepEqual(parseRoutesResponse(null), [])

// sortStops: by name, then id; does not mutate
const unsorted = [
  { id: 5, name: 'Library' },
  { id: 2, name: 'Gate' },
  { id: 1, name: 'Library' },
]
assert.deepEqual(sortStops(unsorted).map((s) => s.id), [2, 1, 5])
assert.equal(unsorted[0].id, 5)

// formatCoord: 6 decimals, no trailing zeros
assert.equal(formatCoord(13.0102), '13.0102')
assert.equal(formatCoord(13.01020049), '13.0102')
assert.equal(formatCoord(80.1234567), '80.123457')
assert.equal(formatCoord(-0), '0')
assert.equal(formatCoord(-0.0000001), '0')
assert.equal(formatCoord(90), '90')
assert.equal(formatCoord(NaN), '')

// parseCoordinate
assert.equal(parseCoordinate('13'), 13)
assert.equal(parseCoordinate('13.'), 13)
assert.equal(parseCoordinate('13.0102'), 13.0102)
assert.equal(parseCoordinate('-13.5'), -13.5)
assert.equal(parseCoordinate('.5'), 0.5)
assert.equal(parseCoordinate('-.5'), -0.5)
assert.ok(Object.is(parseCoordinate('-0'), 0))
for (const t of ['', '-', '.', '-.', '+1', '1e5', '1E5', ' 1', '1 ', 'abc', 'Infinity', 'NaN', '1,5', '0x10', '1.2.3', '9'.repeat(400)]) {
  assert.equal(parseCoordinate(t), null, `parseCoordinate(${JSON.stringify(t)})`)
}
for (const v of [null, undefined, 13]) assert.equal(parseCoordinate(v), null)

// validateStopForm
let v = validateStopForm('  Library  ', '13.0102', '80.2355')
assert.equal(v.ok, true)
assert.deepEqual(v.errors, {})
assert.deepEqual(v.body, { name: 'Library', lat: 13.0102, lng: 80.2355 })
assert.deepEqual(validateStopForm('A', '-90', '180').body, { name: 'A', lat: -90, lng: 180 })
assert.deepEqual(validateStopForm('A', '90', '-180').body, { name: 'A', lat: 90, lng: -180 })
v = validateStopForm('   ', '91', 'abc')
assert.equal(v.ok, false)
assert.equal(v.body, null)
assert.deepEqual(Object.keys(v.errors).sort(), ['lat', 'lng', 'name'])
assert.equal(validateStopForm('A', '-90.0001', '0').errors.lat, 'The latitude must be between -90 and 90.')
assert.equal(validateStopForm('A', '0', '180.5').errors.lng, 'The longitude must be between -180 and 180.')
assert.equal(validateStopForm('A', '1e1', '0').errors.lat, 'Enter the latitude as a number, like 13.0102.')
assert.equal(validateStopForm('A', '-', '0').ok, false)
// 100 characters counted as code points, not UTF-16 units or bytes
assert.equal(validateStopForm('é'.repeat(100), '0', '0').ok, true)
assert.equal(validateStopForm('😀'.repeat(100), '0', '0').ok, true)
assert.equal(validateStopForm('😀'.repeat(101), '0', '0').errors.name, 'Use at most 100 characters (now 101).')
assert.equal(validateStopForm('a'.repeat(101), '0', '0').ok, false)
assert.equal(validateStopForm('a\tb', '0', '0').errors.name, 'Remove tabs and line breaks from the name.')
assert.equal(validateStopForm('a\u0085b', '0', '0').ok, false)
assert.equal(validateStopForm(undefined, '0', '0').errors.name, 'Enter a name.')

// validateRouteForm
let r = validateRouteForm(' Main Gate - Hostel ', [3, 5, 1])
assert.deepEqual(r, { ok: true, errors: {}, body: { name: 'Main Gate - Hostel', stops: [3, 5, 1] } })
assert.deepEqual(Object.keys(r.body).sort(), ['name', 'stops'])
assert.deepEqual(validateRouteForm('A', []).body, { name: 'A', stops: [] })
assert.equal(validateRouteForm('A', [3, 3]).errors.stops, 'Each stop can be in a route only once.')
assert.equal(validateRouteForm('A', Array.from({ length: 51 }, (_, i) => i + 1)).ok, false)
assert.equal(validateRouteForm('A', Array.from({ length: 50 }, (_, i) => i + 1)).ok, true)
assert.equal(validateRouteForm('A', [0]).ok, false)
assert.equal(validateRouteForm('A', ['3']).ok, false)
assert.equal(validateRouteForm('A', null).ok, false)
r = validateRouteForm('', [1])
assert.equal(r.errors.name, 'Enter a name.')
assert.equal(r.body, null)

// moveItem
assert.deepEqual(moveItem([1, 2, 3], 1, -1), [2, 1, 3])
assert.deepEqual(moveItem([1, 2, 3], 1, 1), [1, 3, 2])
const base = [1, 2, 3]
assert.equal(moveItem(base, 0, -1), base)
assert.equal(moveItem(base, 2, 1), base)
assert.equal(moveItem(base, 5, -1), base)
assert.equal(moveItem(base, 1, 2), base)
assert.deepEqual(base, [1, 2, 3])

// addStop / removeStop
assert.deepEqual(addStop([1], 2), [1, 2])
const one = [1]
assert.equal(addStop(one, 1), one)
assert.equal(addStop(one, 0), one)
assert.equal(addStop(one, NaN), one)
const full = Array.from({ length: 50 }, (_, i) => i + 1)
assert.equal(addStop(full, 99), full)
assert.deepEqual(removeStop([1, 2, 3], 2), [1, 3])
assert.deepEqual(removeStop([1, 2, 3], 9), [1, 2, 3])

// stopName
const byId = new Map([[3, { id: 3, name: 'Library' }]])
assert.equal(stopName(byId, 3), 'Library')
assert.equal(stopName(byId, 9), 'Stop #9')

// loadErrorMessage
assert.equal(loadErrorMessage(401), null)
assert.equal(loadErrorMessage(0), NETWORK)
assert.equal(loadErrorMessage(403), FORBIDDEN)
assert.equal(loadErrorMessage(500), GENERIC)

// stopErrorMessage: exact server strings only to tell variants apart
assert.equal(stopErrorMessage(400, 'name must be 1-100 characters'), 'Please check the name and coordinates.')
assert.equal(stopErrorMessage(400, undefined), 'Please check the name and coordinates.')
assert.equal(stopErrorMessage(404, 'stop not found'), 'That stop no longer exists. The list was refreshed.')
assert.equal(stopErrorMessage(404, 'request failed (404)'), GENERIC)
assert.equal(stopErrorMessage(409, 'stop is in use'), 'This stop is used by a route, a trip or a passenger log, so it cannot be deleted.')
assert.equal(stopErrorMessage(409, 'Stop is in use'), GENERIC)
assert.equal(stopErrorMessage(401, 'unauthorized'), null)
assert.equal(stopErrorMessage(403, 'forbidden'), FORBIDDEN)
assert.equal(stopErrorMessage(0, 'network error'), NETWORK)
for (const s of [500, 502, 413, 418, undefined]) assert.equal(stopErrorMessage(s, 'internal error'), GENERIC)
assert.equal(stopIsGone(404, 'stop not found'), true)
assert.equal(stopIsGone(404, 'other'), false)
assert.equal(stopIsGone(409, 'stop not found'), false)

// routeErrorMessage
assert.equal(routeErrorMessage(400, 'unknown stop id'), 'One of the stops no longer exists. The list was refreshed.')
assert.equal(routeErrorMessage(400, 'duplicate stop id 5'), 'Please check the name and stops.')
assert.equal(routeErrorMessage(400, undefined), 'Please check the name and stops.')
assert.equal(routeErrorMessage(404, 'route not found'), 'That route no longer exists. The list was refreshed.')
assert.equal(routeErrorMessage(404, 'stop not found'), GENERIC)
assert.equal(routeErrorMessage(409, 'route name already exists'), 'A route with that name already exists.')
assert.equal(routeErrorMessage(409, 'route has buses assigned'), 'This route has buses assigned. Reassign them first.')
assert.equal(routeErrorMessage(409, 'conflict'), GENERIC)
assert.equal(routeErrorMessage(401, 'unauthorized'), null)
assert.equal(routeErrorMessage(403, 'forbidden'), FORBIDDEN)
assert.equal(routeErrorMessage(0, 'network error'), NETWORK)
for (const s of [500, 503, 418, undefined]) assert.equal(routeErrorMessage(s, 'internal error'), GENERIC)
assert.equal(routeErrorRefetch(404, 'route not found'), 'routes')
assert.equal(routeErrorRefetch(400, 'unknown stop id'), 'stops')
assert.equal(routeErrorRefetch(400, 'duplicate stop id 5'), null)
assert.equal(routeErrorRefetch(409, 'route name already exists'), null)

process.stdout.write('adminLogic: all checks passed\n')
