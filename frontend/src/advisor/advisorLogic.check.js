// Manual check for advisorLogic.js and haversine.js. Run from frontend/: node src/advisor/advisorLogic.check.js
import assert from 'node:assert/strict'
import { haversineM } from '../geo/haversine.js'
import {
  busRouteMap,
  cardView,
  clockHHMM,
  etaText,
  formatDistance,
  liveStatus,
  nearbyReference,
  nearbyRows,
  routeLabel,
  sameNearby,
  speedText,
} from './advisorLogic.js'

// haversineM: 0 for the same point, ~111.2 km per degree of latitude
assert.equal(haversineM({ lat: 13, lng: 80 }, { lat: 13, lng: 80 }), 0)
assert.ok(Math.abs(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 1)
assert.equal(
  Math.round(haversineM({ lat: 13.01, lng: 80.23 }, { lat: 13.02, lng: 80.24 })),
  Math.round(haversineM({ lat: 13.02, lng: 80.24 }, { lat: 13.01, lng: 80.23 })),
)

// formatDistance
assert.equal(formatDistance(0), '0 m')
assert.equal(formatDistance(850), '850 m')
assert.equal(formatDistance(999), '999 m')
assert.equal(formatDistance(1000), '1.0 km')
assert.equal(formatDistance(1249), '1.2 km')
assert.equal(formatDistance(-1), 'n/a')
assert.equal(formatDistance(NaN), 'n/a')

// etaText, speedText, clockHHMM
assert.equal(etaText(0), 'under 1 min')
assert.equal(etaText(6), '6 min')
assert.equal(speedText(23.6), '24 km/h')
assert.equal(speedText(null), 'speed n/a')
assert.equal(clockHHMM(new Date(2026, 9, 17, 9, 5).getTime()), '09:05')

// cardView
const rec = { bus_id: 7, route_id: 1, eta_minutes: 6, board_stop_id: 3, distance_m: 850, rank: 1 }
assert.equal(cardView({ phase: 'idle', result: null }), 'none')
assert.equal(cardView({ phase: 'submitting', result: null }), 'none')
assert.equal(cardView({ phase: 'success', result: { recommendations: [] } }), 'empty')
assert.equal(cardView({ phase: 'success', result: { recommendations: [rec] } }), 'result')

// routeLabel, busRouteMap
const routeNames = new Map([[1, 'Main Gate - Hostel']])
assert.equal(routeLabel(routeNames, 1), 'Main Gate - Hostel')
assert.equal(routeLabel(routeNames, 9), 'Route #9')
assert.equal(routeLabel(routeNames, null), 'Route unknown')
const br = busRouteMap([{ id: 7, route_id: 1, lat: 13, lng: 80 }, { id: 8, route_id: null }, null])
assert.deepEqual([...br], [[7, 1]])
assert.equal(busRouteMap(undefined).size, 0)

// liveStatus
const INFO = {
  on_route: { label: 'On route', glyph: '>' },
  break: { label: 'On break', glyph: '|' },
  out_of_service: { label: 'Out of service', glyph: 'x' },
  unknown: { label: 'Unknown', glyph: '?' },
}
const now = Date.parse('2026-10-17T10:00:00Z')
const fresh = { bus_id: 7, lat: 13, lng: 80, speed: 24.2, status: 'on_route', ts: '2026-10-17T09:59:55Z' }
assert.deepEqual(liveStatus(fresh, now, INFO), { kind: 'ok', glyph: '>', text: 'On route, 24 km/h' })
assert.equal(liveStatus({ ...fresh, status: 'break' }, now, INFO).kind, 'changed')
assert.match(liveStatus({ ...fresh, status: 'break' }, now, INFO).text, /^Status changed: On break\./)
assert.match(liveStatus({ ...fresh, status: 'out_of_service' }, now, INFO).text, /Out of service/)
assert.equal(liveStatus({ ...fresh, ts: '2026-10-17T09:59:00Z' }, now, INFO).kind, 'stale')
assert.match(liveStatus({ ...fresh, ts: '2026-10-17T09:59:00Z' }, now, INFO).text, /^No live update since \d\d:\d\d\.$/)
assert.equal(liveStatus(undefined, now, INFO).kind, 'missing')
assert.equal(liveStatus({ ...fresh, status: 'unknown' }, now, INFO).text, 'Unknown, 24 km/h')

// nearbyReference: board stop first, then manual origin stop, else null
const stopsById = new Map([
  [3, { id: 3, name: 'Library', lat: 13.01, lng: 80.23 }],
  [8, { id: 8, name: 'Hostel', lat: 13.02, lng: 80.24 }],
])
const withRec = { recommendations: [rec] }
assert.deepEqual(nearbyReference(withRec, 8, stopsById), {
  stopId: 3,
  label: 'Library',
  kind: 'board',
  point: { lat: 13.01, lng: 80.23 },
})
assert.equal(nearbyReference({ recommendations: [] }, 8, stopsById).kind, 'origin')
assert.equal(nearbyReference(null, 8, stopsById).stopId, 8)
assert.equal(nearbyReference(null, null, stopsById), null)
assert.equal(nearbyReference({ recommendations: [] }, null, stopsById), null)
assert.equal(nearbyReference({ recommendations: [{ ...rec, board_stop_id: 99 }] }, 8, stopsById).kind, 'origin')

// nearbyRows: sorted by distance (ties by id), stale hidden and counted, capped
const point = { lat: 13.01, lng: 80.23 }
const bus = (id, dLat, extra = {}) => [id, { ...fresh, bus_id: id, lat: 13.01 + dLat, lng: 80.23, ...extra }]
const buses = new Map([
  bus(1, 0.01),
  bus(2, 0.001),
  bus(3, 0.001),
  bus(4, 0.002, { ts: '2026-10-17T09:00:00Z' }),
  bus(5, 0.003, { speed: null }),
  bus(6, 0.004),
  bus(7, 0.005),
])
const busRoutes = new Map([[2, 1], [3, 9]])
const near = nearbyRows(buses, point, busRoutes, routeNames, now)
assert.deepEqual(
  near.rows.map((r) => r.bus_id),
  [2, 3, 5, 6, 7],
)
assert.equal(near.hiddenStale, 1)
assert.equal(near.rows[0].distance_m, 110)
assert.equal(near.rows[0].route, 'Main Gate - Hostel')
assert.equal(near.rows[1].route, 'Route #9')
assert.equal(near.rows[2].route, 'Route unknown')
assert.equal(near.rows[2].speed, null)
assert.equal(near.rows[0].speed, 24)
assert.equal(nearbyRows(new Map(), point, busRoutes, routeNames, now).rows.length, 0)
assert.equal(nearbyRows(buses, point, busRoutes, routeNames, now, 2).rows.length, 2)

// sameNearby: a 1 m move keeps the result equal, a status change does not
const moved = new Map(buses)
moved.set(2, { ...buses.get(2), lat: buses.get(2).lat + 0.000005 })
assert.ok(sameNearby(near, nearbyRows(moved, point, busRoutes, routeNames, now)))
moved.set(2, { ...buses.get(2), status: 'break' })
assert.ok(!sameNearby(near, nearbyRows(moved, point, busRoutes, routeNames, now)))
assert.ok(!sameNearby(near, { ...near, hiddenStale: 0 }))

process.stdout.write('advisorLogic: all checks passed\n')
