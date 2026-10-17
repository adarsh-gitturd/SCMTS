// Manual check for driverLogic.js and homePathFor. Run from frontend/: node src/driver/driverLogic.check.js
import assert from 'node:assert/strict'
import { homePathFor } from '../auth/homePath.js'
import { driverRouteErrorMessage, driverRouteView, parseDriverRoute, toMapLayers } from './driverLogic.js'

// homePathFor: driver -> /driver, admin -> /admin, everyone else -> /
assert.equal(homePathFor('driver'), '/driver')
assert.equal(homePathFor('student'), '/')
assert.equal(homePathFor('admin'), '/admin')
assert.equal(homePathFor(undefined), '/')
assert.equal(homePathFor('unknown'), '/')

// parseDriverRoute: exact shape from docs/API.md
const stop = (id, order) => ({ stop_id: id, name: `Stop ${id}`, lat: 13.01, lng: 80.23, order })
const full = { bus_id: 7, plate: 'TN01AB1234', route: { id: 1, name: 'Main Gate - Hostel', stops: [stop(3, 1), stop(5, 2)] } }
assert.deepEqual(parseDriverRoute(full), full)

// keeps API order (no re-sort)
const unsorted = parseDriverRoute({ ...full, route: { ...full.route, stops: [stop(5, 2), stop(3, 1)] } })
assert.deepEqual(
  unsorted.route.stops.map((s) => s.stop_id),
  [5, 3],
)

// drops broken stops, keeps the rest, strips extra fields
const mixed = parseDriverRoute({
  ...full,
  route: {
    ...full.route,
    stops: [
      stop(3, 1),
      null,
      { ...stop(4, 2), stop_id: '4' },
      { ...stop(6, 3), name: '  ' },
      { ...stop(7, 4), lat: null },
      { ...stop(8, 5), order: 1.5 },
      { ...stop(9, 6), extra: 'x' },
    ],
  },
})
assert.deepEqual(
  mixed.route.stops.map((s) => s.stop_id),
  [3, 9],
)
assert.equal('extra' in mixed.route.stops[1], false)

// route null and empty stops
assert.deepEqual(parseDriverRoute({ bus_id: 7, plate: 'TN01', route: null }), { bus_id: 7, plate: 'TN01', route: null })
assert.deepEqual(parseDriverRoute({ ...full, route: { ...full.route, stops: [] } }).route.stops, [])

// bad top-level shapes -> null
assert.equal(parseDriverRoute(null), null)
assert.equal(parseDriverRoute({ ...full, bus_id: 0 }), null)
assert.equal(parseDriverRoute({ ...full, bus_id: '7' }), null)
assert.equal(parseDriverRoute({ ...full, plate: 5 }), null)
assert.equal(parseDriverRoute({ bus_id: 7, plate: 'TN01' }), null) // route missing
assert.equal(parseDriverRoute({ ...full, route: { id: 1, name: 'R' } }), null) // stops missing
assert.equal(parseDriverRoute({ ...full, route: { id: '1', name: 'R', stops: [] } }), null)

// driverRouteErrorMessage: own wording, nothing for 401
assert.equal(driverRouteErrorMessage(401), null)
assert.match(driverRouteErrorMessage(404), /No bus is assigned/)
assert.match(driverRouteErrorMessage(403), /drivers only/)
assert.match(driverRouteErrorMessage(0), /Cannot reach the server/)
for (const status of [500, 502, 503, 400, 418]) {
  assert.equal(driverRouteErrorMessage(status), 'Something went wrong. Please try again.')
}

// driverRouteView
const ready = (data) => ({ phase: 'ready', status: 200, data })
assert.equal(driverRouteView({ phase: 'loading', status: null, data: null }), 'loading')
assert.equal(driverRouteView(ready(parseDriverRoute(full))), 'route')
assert.equal(driverRouteView(ready(parseDriverRoute({ bus_id: 7, plate: 'P', route: null }))), 'no-route')
assert.equal(driverRouteView(ready(parseDriverRoute({ ...full, route: { ...full.route, stops: [] } }))), 'no-stops')
assert.equal(driverRouteView(ready(null)), 'error') // bad 200 response
const failed = (status) => driverRouteView({ phase: 'error', status, data: null })
assert.equal(failed(404), 'no-bus')
assert.equal(failed(403), 'forbidden')
assert.equal(failed(0), 'network')
assert.equal(failed(401), 'none')
assert.equal(failed(500), 'error')
assert.equal(failed(502), 'error')

// toMapLayers: shapes StaticLayer expects
assert.deepEqual(toMapLayers(parseDriverRoute(full).route), {
  routes: [{ id: 1, name: 'Main Gate - Hostel', stops: [{ stop_id: 3, order: 1 }, { stop_id: 5, order: 2 }] }],
  stops: [
    { id: 3, name: 'Stop 3', lat: 13.01, lng: 80.23 },
    { id: 5, name: 'Stop 5', lat: 13.01, lng: 80.23 },
  ],
})
assert.deepEqual(toMapLayers(null), { routes: [], stops: [] })

process.stdout.write('driverLogic: all checks passed\n')
