// Manual check for fleetLogic.js. Run from frontend/: node src/admin/fleetLogic.check.js
import assert from 'node:assert/strict'
import {
  ageSeconds,
  busFlags,
  displayAge,
  fleetErrorMessage,
  formatAge,
  formatPosition,
  formatSpeed,
  isStaleAge,
  parseFleetResponse,
  sameBus,
  stabilize,
  statusLabel,
  statusSymbol,
  summarize,
} from './fleetLogic.js'

const T = '2026-10-17T10:56:14Z'
const live = (over = {}) => ({
  lat: 10.0436,
  lng: 76.3241,
  speed: 22,
  status: 'on_route',
  updated_at: '2026-10-17T10:56:11Z',
  ...over,
})
const bus = (over = {}) => ({
  bus_id: 1,
  plate: 'KL-07-CB-1101',
  route_id: 1,
  route_name: 'Main Gate - Hostel',
  driver_id: 9,
  driver_name: 'Ravi',
  live: live(),
  ...over,
})

// parseFleetResponse: validates, drops broken buses, keeps order, live null kept
const parsed = parseFleetResponse({
  server_time: T,
  buses: [
    bus({ bus_id: 3 }),
    bus({ bus_id: 1, route_id: null, route_name: null, driver_id: null, driver_name: null, live: null }),
    bus({ bus_id: 2, live: live({ status: 'teleporting', speed: 'fast' }) }),
    bus({ bus_id: '4' }),
    bus({ bus_id: 0 }),
    bus({ bus_id: 5, plate: null }),
    bus({ bus_id: 6, route_name: 7 }),
    bus({ bus_id: 7, live: live({ lat: 91 }) }),
    bus({ bus_id: 8, live: live({ updated_at: 'yesterday' }) }),
    bus({ bus_id: 9, live: 'x' }),
    null,
  ],
})
assert.equal(parsed.serverTime, T)
assert.deepEqual(
  parsed.buses.map((b) => b.bus_id),
  [3, 1, 2],
)
assert.deepEqual(parsed.buses[0], {
  bus_id: 3,
  plate: 'KL-07-CB-1101',
  route_name: 'Main Gate - Hostel',
  driver_name: 'Ravi',
  live: live(),
})
assert.equal(parsed.buses[1].live, null)
assert.equal(parsed.buses[1].route_name, null)
assert.equal(parsed.buses[2].live.status, 'unknown')
assert.equal(parsed.buses[2].live.speed, null)
assert.deepEqual(parseFleetResponse({ server_time: T, buses: [] }).buses, [])
assert.deepEqual(parseFleetResponse({ server_time: T, buses: null }).buses, [])
assert.deepEqual(parseFleetResponse({ server_time: T }).buses, [])
for (const d of [null, undefined, 'x', [], {}, { buses: [] }, { server_time: 'nope', buses: [] }]) {
  assert.equal(parseFleetResponse(d), null)
}

// sameBus / stabilize
const a = parseFleetResponse({ server_time: T, buses: [bus({ bus_id: 1 }), bus({ bus_id: 2, live: null })] }).buses
const b = parseFleetResponse({ server_time: '2026-10-17T10:56:19Z', buses: [bus({ bus_id: 1 }), bus({ bus_id: 2, live: null })] }).buses
assert.ok(sameBus(a[0], b[0]))
assert.ok(!sameBus(a[0], undefined))
assert.ok(!sameBus(a[0], { ...a[0], live: { ...a[0].live, lat: 10.1 } }))
assert.ok(!sameBus(a[0], { ...a[0], live: null }))
assert.ok(!sameBus(a[0], { ...a[0], driver_name: null }))
assert.equal(stabilize(a, b), a) // nothing visible changed -> same array
const moved = [{ ...b[0], live: { ...b[0].live, updated_at: '2026-10-17T10:56:16Z' } }, b[1]]
const s = stabilize(a, moved)
assert.notEqual(s, a)
assert.equal(s[0], moved[0])
assert.equal(s[1], a[1]) // unchanged bus keeps its object
assert.deepEqual(stabilize(a, [b[1]]), [a[1]]) // bus removed
assert.deepEqual(stabilize([], b), b)
assert.deepEqual(
  stabilize(a, [b[1], b[0]]).map((x) => x.bus_id),
  [2, 1],
) // server order wins

// ageSeconds / displayAge: only server times, PC clock not involved
assert.equal(ageSeconds(T, '2026-10-17T10:56:11Z'), 3)
assert.equal(ageSeconds(T, '2026-10-17T10:56:15Z'), -1)
assert.equal(ageSeconds('x', T), null)
assert.equal(displayAge(3, 1000, 3500), 5.5)
assert.equal(displayAge(null, 1000, 3500), null)
assert.equal(displayAge(3, NaN, 3500), null)

// formatAge
assert.equal(formatAge(0), '0 s ago')
assert.equal(formatAge(-2), '0 s ago')
assert.equal(formatAge(NaN), '0 s ago')
assert.equal(formatAge(5.9), '5 s ago')
assert.equal(formatAge(59.99), '59 s ago')
assert.equal(formatAge(60), '1 min 0 s ago')
assert.equal(formatAge(130), '2 min 10 s ago')
assert.equal(formatAge(3599), '59 min 59 s ago')
assert.equal(formatAge(3600), '1 h 0 min ago')
assert.equal(formatAge(3900), '1 h 5 min ago')
assert.equal(formatAge(90061), '25 h 1 min ago')

// isStaleAge
assert.equal(isStaleAge(30, 'on_route'), false)
assert.equal(isStaleAge(30.5, 'on_route'), true)
assert.equal(isStaleAge(31, 'delayed'), true)
assert.equal(isStaleAge(31, 'unknown'), true)
assert.equal(isStaleAge(9999, 'out_of_service'), false)
assert.equal(isStaleAge(null, 'on_route'), false)

// status labels and symbols match the map
assert.equal(`${statusSymbol('on_route')} ${statusLabel('on_route')}`, '▶ On route')
assert.equal(`${statusSymbol('delayed')} ${statusLabel('delayed')}`, '! Delayed')
assert.equal(`${statusSymbol('break')} ${statusLabel('break')}`, '‖ On break')
assert.equal(`${statusSymbol('out_of_service')} ${statusLabel('out_of_service')}`, '✕ Out of service')
assert.equal(`${statusSymbol('nope')} ${statusLabel('nope')}`, '? Unknown')
assert.equal(statusLabel('toString'), 'Unknown')

// busFlags
assert.deepEqual(busFlags(a[0]), [])
assert.deepEqual(busFlags({ route_name: null, driver_name: null, live: null }), [
  'No driver assigned',
  'No route assigned',
  'No live data yet',
])
assert.deepEqual(busFlags({ route_name: 'R', driver_name: null, live: live() }), ['No driver assigned'])

// formatPosition / formatSpeed
assert.equal(formatPosition(10.0436, 76.3241), '10.04360, 76.32410')
assert.equal(formatPosition(10.123456789, -76.000004), '10.12346, -76.00000')
assert.equal(formatPosition(-0.000001, 0), '0.00000, 0.00000')
assert.equal(formatSpeed(22), '22 km/h')
assert.equal(formatSpeed(21.6), '22 km/h')
assert.equal(formatSpeed(null), 'Unknown')

// summarize
const fleet = parseFleetResponse({
  server_time: T,
  buses: [
    bus({ bus_id: 1 }),
    bus({ bus_id: 2, live: live({ status: 'delayed', updated_at: '2026-10-17T10:55:00Z' }) }),
    bus({ bus_id: 3, live: live({ status: 'break' }) }),
    bus({ bus_id: 4, driver_name: null, live: live({ status: 'out_of_service', updated_at: '2026-10-16T10:00:00Z' }) }),
    bus({ bus_id: 5, route_name: null, live: null }),
    bus({ bus_id: 6, live: live({ status: 'weird' }) }),
  ],
})
const ageAt = (x) => ageSeconds(fleet.serverTime, x.live.updated_at)
assert.deepEqual(summarize(fleet.buses, ageAt), {
  total: 6,
  byStatus: { on_route: 1, delayed: 1, break: 1, out_of_service: 1, unknown: 1 },
  notReporting: 1, // bus 2; bus 4 is out of service, bus 5 has no live data
  noLive: 1,
  flagged: 2,
})
assert.equal(summarize(fleet.buses, () => 31).notReporting, 4) // all live buses except out of service
assert.deepEqual(summarize([], ageAt), {
  total: 0,
  byStatus: { on_route: 0, delayed: 0, break: 0, out_of_service: 0, unknown: 0 },
  notReporting: 0,
  noLive: 0,
  flagged: 0,
})

// fleetErrorMessage: never server text
assert.equal(fleetErrorMessage(401), null)
assert.equal(fleetErrorMessage(403), 'This page is for admins only.')
assert.equal(fleetErrorMessage(0), 'Cannot reach the server. Check your connection and try again.')
for (const st of [500, 502, 404, undefined, -1]) assert.equal(fleetErrorMessage(st), 'Something went wrong. Please try again.')

process.stdout.write('fleetLogic: all checks passed\n')
