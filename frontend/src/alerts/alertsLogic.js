// Pure helpers for the alerts strip. Alerts are derived from the live feed (D2),
// see docs/SPEC.md "5.0 Send alerts (reads D2)". Only pure imports, so they can be
// checked from node: node src/alerts/alertsLogic.check.js
import { routeLabel } from '../advisor/advisorLogic.js'
import { STALE_MS } from '../map/liveBusLogic.js'

export const VISIBLE_LIMIT = 3
export const REMOVAL_HOLD_MS = 2000 // a vanished bus alert stays this long, so a flicker does not flash it
export const FEED_KEY = 'feed'

export const TIER_YOUR_BUS = 0
export const TIER_YOUR_ROUTE = 1
export const TIER_OTHER = 2
const TAGS = { [TIER_YOUR_BUS]: 'your bus', [TIER_YOUR_ROUTE]: 'on your route', [TIER_OTHER]: null }

const SEVERITY = { out_of_service: 3, break: 2, delayed: 1, stale: 0, feed: 4 }
const WORDS = { delayed: 'is delayed', break: 'is on break', out_of_service: 'is out of service', stale: 'is not reporting' }
const STALE_GLYPH = '?'
const FEED_GLYPH = '!'

export function dismissKey(busId, kind) {
  return busId === null ? FEED_KEY : `bus:${busId}:${kind}`
}

// bus_id -> { ts, at }: at = local time when that bus's ts last changed.
// Returns prev itself when nothing changed.
export function trackSeen(prev, buses, now) {
  let changed = prev.size !== buses.size
  const next = new Map()
  for (const bus of buses.values()) {
    const old = prev.get(bus.bus_id)
    if (old && old.ts === bus.ts) {
      next.set(bus.bus_id, old)
    } else {
      next.set(bus.bus_id, { ts: bus.ts, at: now })
      changed = true
    }
  }
  return changed ? next : prev
}

// Stale without comparing the PC clock to server time: either no new ts for
// STALE_MS of local time, or the ts is STALE_MS behind the newest ts in the feed
// (both server time).
export function isQuiet(bus, seenEntry, newestMs, now) {
  if (seenEntry && now - seenEntry.at > STALE_MS) return true
  return newestMs - Date.parse(bus.ts) > STALE_MS
}

// 'reconnecting', or 'connecting' again after having been live, means paused.
function feedAlert(connKind, hadLive) {
  let text = null
  if (connKind === 'forbidden') text = 'Live updates not available'
  else if (connKind === 'reconnecting' || (connKind === 'connecting' && hadLive)) text = 'Live updates paused, reconnecting'
  if (!text) return null
  return { key: FEED_KEY, kind: 'feed', bus_id: null, tier: TIER_OTHER, glyph: FEED_GLYPH, text, tag: null }
}

// Alert kind for one bus, or null. out_of_service stays shown when quiet: the
// bus stops reporting on purpose (gpssim skips it).
function busAlertKind(bus, quiet) {
  if (bus.status === 'out_of_service') return 'out_of_service'
  if (quiet) return 'stale'
  return bus.status === 'delayed' || bus.status === 'break' ? bus.status : null
}

// All alerts, sorted. Feed paused -> only the feed alert. top = top recommendation
// ({ bus_id, route_id }) or null. info = STATUS_INFO from busIcons.js (glyphs).
export function deriveAlerts({ buses, seen, connKind, hadLive, busRoutes, routeNames, top, now, info }) {
  const feed = feedAlert(connKind, hadLive)
  if (feed) return [feed]
  if (connKind !== 'live') return []

  let newestMs = -Infinity
  for (const bus of buses.values()) newestMs = Math.max(newestMs, Date.parse(bus.ts))

  const alerts = []
  for (const bus of buses.values()) {
    const kind = busAlertKind(bus, isQuiet(bus, seen.get(bus.bus_id), newestMs, now))
    if (!kind) continue
    const routeId = busRoutes.get(bus.bus_id)
    let tier = TIER_OTHER
    if (top && bus.bus_id === top.bus_id) tier = TIER_YOUR_BUS
    else if (top && routeId !== undefined && routeId === top.route_id) tier = TIER_YOUR_ROUTE
    alerts.push({
      key: dismissKey(bus.bus_id, kind),
      kind,
      bus_id: bus.bus_id,
      tier,
      glyph: kind === 'stale' ? STALE_GLYPH : (info[kind]?.glyph ?? STALE_GLYPH),
      text: `Bus ${bus.bus_id} (${routeId === undefined ? 'Route unknown' : routeLabel(routeNames, routeId)}) ${WORDS[kind]}`,
      tag: TAGS[tier],
    })
  }
  return alerts.sort(compareAlerts)
}

// Your bus, then your route, then others; within a tier most severe first, then bus id.
// Only fixed properties of an alert are used, so live frames alone never reorder.
export function compareAlerts(a, b) {
  return a.tier - b.tier || SEVERITY[b.kind] - SEVERITY[a.kind] || (a.bus_id ?? 0) - (b.bus_id ?? 0)
}

// True if two alert arrays render the same. goneAt is compared too, so a held
// alert keeps its first goneAt and expires.
export function sameAlerts(a, b) {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return x.key === y.key && x.text === y.text && x.tag === y.tag && x.glyph === y.glyph && x.goneAt === y.goneAt
  })
}

// Next shown list: the derived alerts plus bus alerts that vanished less than
// REMOVAL_HOLD_MS ago (goneAt set). A different alert for the same bus replaces
// it at once. No hold around feed pauses: the feed alert replaces bus alerts and
// is cleared on reconnect. Returns prev itself when nothing visible changed.
export function holdRemoved(prev, next, now) {
  const out = [...next]
  const feedMode = next.some((a) => a.kind === 'feed') || prev.some((a) => a.kind === 'feed')
  if (!feedMode) {
    const keys = new Set(next.map((a) => a.key))
    const busIds = new Set(next.map((a) => a.bus_id))
    for (const a of prev) {
      if (keys.has(a.key) || busIds.has(a.bus_id)) continue
      const goneAt = a.goneAt ?? now
      if (now - goneAt < REMOVAL_HOLD_MS) out.push({ ...a, goneAt })
    }
    out.sort(compareAlerts)
  }
  return sameAlerts(prev, out) ? prev : out
}

// Drops dismissals whose alert is no longer shown (the bus's status changed, or
// the feed came back). Bus dismissals are kept while the feed is paused.
// Returns dismissed itself when nothing was dropped.
export function pruneDismissed(dismissed, shown) {
  const keys = new Set(shown.map((a) => a.key))
  const paused = keys.has(FEED_KEY)
  const next = new Set()
  for (const k of dismissed) {
    if (keys.has(k) || (paused && k !== FEED_KEY)) next.add(k)
  }
  return next.size === dismissed.size ? dismissed : next
}

// The advisor card already announces its top bus going on break / out of service.
function cardAnnounces(a) {
  return a.tier === TIER_YOUR_BUS && (a.kind === 'break' || a.kind === 'out_of_service')
}

export function alertLabel(a) {
  return a.tag ? `${a.text}, ${a.tag}` : a.text
}

// Alerts not announced before -> text for the polite live region ('' = none).
// announced = keys of the alerts visible last time; a key is forgotten when its
// alert leaves, so it is announced again only if it really comes back.
export function newAnnouncements(announced, visible) {
  const keys = new Set(visible.map((a) => a.key))
  const fresh = visible.filter((a) => !announced.has(a.key) && !cardAnnounces(a))
  const same = keys.size === announced.size && [...keys].every((k) => announced.has(k))
  return {
    announced: same ? announced : keys,
    text: fresh.map((a) => `New alert: ${alertLabel(a)}.`).join(' '),
  }
}
