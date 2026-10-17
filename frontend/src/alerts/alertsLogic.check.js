// Manual check for alertsLogic.js. Run from frontend/: node src/alerts/alertsLogic.check.js
import assert from 'node:assert/strict'
import {
  compareAlerts,
  deriveAlerts,
  dismissKey,
  FEED_KEY,
  holdRemoved,
  isQuiet,
  newAnnouncements,
  pruneDismissed,
  REMOVAL_HOLD_MS,
  sameAlerts,
  trackSeen,
} from './alertsLogic.js'

const INFO = {
  delayed: { glyph: '!' },
  break: { glyph: '|' },
  out_of_service: { glyph: 'x' },
  unknown: { glyph: '?' },
}
const now = 1_000_000
const T = '2026-10-17T10:00:00Z'
const T_OLD = '2026-10-17T09:59:00Z' // 60 s behind T
const bus = (id, status, ts = T) => [id, { bus_id: id, lat: 13, lng: 80, speed: 20, status, ts }]
const routeNames = new Map([[1, 'Route A'], [2, 'Route B']])
const busRoutes = new Map([[1, 1], [2, 1], [3, 2], [4, 2]])
const base = { connKind: 'live', hadLive: true, busRoutes, routeNames, top: null, now, info: INFO }
const derive = (buses, extra = {}) => {
  const m = new Map(buses)
  return deriveAlerts({ ...base, buses: m, seen: trackSeen(new Map(), m, now), ...extra })
}

// dismissKey
assert.equal(dismissKey(2, 'delayed'), 'bus:2:delayed')
assert.equal(dismissKey(null, 'feed'), FEED_KEY)

// trackSeen: keeps prev when nothing changed, new `at` only for a new ts
const m1 = new Map([bus(1, 'on_route')])
const s1 = trackSeen(new Map(), m1, 100)
assert.deepEqual(s1.get(1), { ts: T, at: 100 })
assert.equal(trackSeen(s1, new Map(m1), 200), s1)
const s2 = trackSeen(s1, new Map([bus(1, 'on_route', '2026-10-17T10:00:03Z')]), 200)
assert.equal(s2.get(1).at, 200)
assert.equal(trackSeen(s1, new Map(), 200).size, 0)

// isQuiet: only local elapsed time or server-vs-server ts, never PC clock vs ts
const fresh = { ts: T }
const newest = Date.parse(T)
assert.equal(isQuiet(fresh, { ts: T, at: now }, newest, now), false)
assert.equal(isQuiet(fresh, { ts: T, at: now - 31_000 }, newest, now), true)
assert.equal(isQuiet({ ts: T_OLD }, { ts: T_OLD, at: now }, newest, now), true)
// PC clock a day off: still fresh, because now is only compared with `at`
assert.equal(isQuiet(fresh, { ts: T, at: now + 86_400_000 }, newest, now + 86_400_000), false)

// deriveAlerts: texts, Route unknown fallback, no alert for on_route / unknown
const a1 = derive([bus(1, 'delayed'), bus(3, 'break'), bus(4, 'on_route'), bus(9, 'out_of_service'), bus(5, 'unknown')])
assert.deepEqual(
  a1.map((a) => [a.key, a.glyph, a.text]),
  [
    ['bus:9:out_of_service', 'x', 'Bus 9 (Route unknown) is out of service'],
    ['bus:3:break', '|', 'Bus 3 (Route B) is on break'],
    ['bus:1:delayed', '!', 'Bus 1 (Route A) is delayed'],
  ],
)
assert.ok(a1.every((a) => a.tag === null))

// stale: no delayed/break alert, one "not reporting" instead; out_of_service stays
const a2 = derive([bus(1, 'delayed', T_OLD), bus(3, 'break'), bus(9, 'out_of_service', T_OLD)])
assert.deepEqual(
  a2.map((a) => a.key),
  ['bus:9:out_of_service', 'bus:3:break', 'bus:1:stale'],
)
assert.equal(a2[2].text, 'Bus 1 (Route A) is not reporting')

// relevance: your bus, then your route, then others; severity then bus id inside a tier
const top = { bus_id: 2, route_id: 1 }
const a3 = derive([bus(1, 'delayed'), bus(2, 'delayed'), bus(3, 'out_of_service'), bus(4, 'delayed')], { top })
assert.deepEqual(
  a3.map((a) => [a.bus_id, a.tag]),
  [[2, 'your bus'], [1, 'on your route'], [3, null], [4, null]],
)
// input order does not matter
const a3r = derive([bus(4, 'delayed'), bus(3, 'out_of_service'), bus(2, 'delayed'), bus(1, 'delayed')], { top })
assert.ok(sameAlerts(a3, a3r))
assert.ok(compareAlerts(a3[0], a3[1]) < 0)

// feed: one alert only, no bus alerts; nothing before the first connect
const buses = [bus(1, 'delayed', T_OLD), bus(3, 'break')]
assert.deepEqual(
  derive(buses, { connKind: 'reconnecting' }).map((a) => a.text),
  ['Live updates paused, reconnecting'],
)
assert.equal(derive(buses, { connKind: 'connecting', hadLive: true }).length, 1)
assert.equal(derive(buses, { connKind: 'connecting', hadLive: false }).length, 0)
assert.equal(derive(buses, { connKind: 'forbidden' })[0].text, 'Live updates not available')

// sameAlerts
assert.ok(sameAlerts(a1, derive([bus(1, 'delayed'), bus(3, 'break'), bus(9, 'out_of_service')])))
assert.ok(!sameAlerts(a1, a1.slice(1)))
assert.ok(!sameAlerts(a1, [{ ...a1[0], text: 'x' }, a1[1], a1[2]]))

// holdRemoved: same -> prev; vanished alert held REMOVAL_HOLD_MS; kind change replaces at once
assert.equal(holdRemoved(a1, derive([bus(1, 'delayed'), bus(3, 'break'), bus(9, 'out_of_service')]), now), a1)
const h1 = holdRemoved(a1, a1.slice(0, 2), now) // bus 1 back on route
assert.deepEqual(
  h1.map((a) => [a.key, a.goneAt]),
  [
    ['bus:9:out_of_service', undefined],
    ['bus:3:break', undefined],
    ['bus:1:delayed', now],
  ],
)
assert.equal(holdRemoved(h1, a1.slice(0, 2), now + 1000), h1) // still held, same object
assert.equal(holdRemoved(h1, a1.slice(0, 2), now + REMOVAL_HOLD_MS).length, 2) // expired
assert.equal(holdRemoved(h1, a1, now + 500)[2].goneAt, undefined) // came back within the hold
const toBreak = derive([bus(1, 'break'), bus(3, 'break'), bus(9, 'out_of_service')])
assert.deepEqual(
  holdRemoved(a1, toBreak, now).map((a) => a.key),
  ['bus:9:out_of_service', 'bus:1:break', 'bus:3:break'],
)
// feed pause: bus alerts go at once, feed alert clears at once on reconnect
const paused = derive(buses, { connKind: 'reconnecting' })
assert.deepEqual(holdRemoved(a1, paused, now).map((a) => a.key), [FEED_KEY])
assert.deepEqual(holdRemoved(paused, [], now), [])

// pruneDismissed: kept while shown, dropped when status changes, kept during a feed pause
const d1 = new Set(['bus:1:delayed', FEED_KEY])
assert.deepEqual([...pruneDismissed(d1, a1)], ['bus:1:delayed'])
const d2 = new Set(['bus:1:delayed'])
assert.equal(pruneDismissed(d2, a1), d2)
assert.equal(pruneDismissed(d2, h1), d2) // held alert still counts as shown
assert.equal(pruneDismissed(d2, toBreak).size, 0)
assert.equal(pruneDismissed(d2, paused), d2)

// newAnnouncements: new keys once; card-announced break/out_of_service for your bus skipped
const n1 = newAnnouncements(new Set(), a3)
assert.equal(
  n1.text,
  'New alert: Bus 2 (Route A) is delayed, your bus. New alert: Bus 1 (Route A) is delayed, on your route. ' +
    'New alert: Bus 3 (Route B) is out of service. New alert: Bus 4 (Route B) is delayed.',
)
const n2 = newAnnouncements(n1.announced, a3r)
assert.equal(n2.text, '')
assert.equal(n2.announced, n1.announced)
const yourBreak = derive([bus(2, 'break')], { top })
assert.equal(newAnnouncements(new Set(), yourBreak).text, '')
assert.equal(newAnnouncements(new Set(), derive([bus(2, 'break')])).text, 'New alert: Bus 2 (Route A) is on break.')

process.stdout.write('alertsLogic: all checks passed\n')
