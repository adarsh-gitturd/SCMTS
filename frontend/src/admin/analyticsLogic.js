// Pure helpers for the admin analytics page (/admin/analytics).
// No React, no fetch, no clock. Check: node src/admin/analyticsLogic.check.js

const MAX_DAYS = 366 // inclusive, same as the server
const DAY_MS = 86400000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// Heatmap hours always cover at least this span (campus local time).
const MIN_FIRST_HOUR = 6
const MIN_LAST_HOUR = 21
export const SHADE_LEVELS = 4 // shadeLevel returns 0..SHADE_LEVELS

export const WEEKDAYS = [
  { weekday: 1, short: 'Mon', long: 'Monday' },
  { weekday: 2, short: 'Tue', long: 'Tuesday' },
  { weekday: 3, short: 'Wed', long: 'Wednesday' },
  { weekday: 4, short: 'Thu', long: 'Thursday' },
  { weekday: 5, short: 'Fri', long: 'Friday' },
  { weekday: 6, short: 'Sat', long: 'Saturday' },
  { weekday: 7, short: 'Sun', long: 'Sunday' },
]

const BOTH_DATES = 'Enter both dates, or leave both empty for the default range.'
const COMPLETE_DATE = 'Enter a complete date.'

// --- range ---

// "YYYY-MM-DD" -> UTC day number (days since 1970-01-01), or null if not a real date.
// Date.UTC is only used for calendar arithmetic, never for "today".
function dayNumber(text) {
  const m = typeof text === 'string' ? DATE_RE.exec(text) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  // Date.UTC maps years 0..99 to 1900..1999; the round trip rejects those and 2026-02-30.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ms / DAY_MS
}

// -> { ok, errors: { from?, to? }, query }. Both empty = server default range.
// Values are sent exactly as typed when valid.
export function validateRange(from, to) {
  const f = typeof from === 'string' ? from : ''
  const t = typeof to === 'string' ? to : ''
  const errors = {}
  if (f === '' && t === '') return { ok: true, errors, query: '' }
  if (f === '') errors.from = BOTH_DATES
  if (t === '') errors.to = BOTH_DATES
  const fd = f === '' ? null : dayNumber(f)
  const td = t === '' ? null : dayNumber(t)
  if (f !== '' && fd === null) errors.from = COMPLETE_DATE
  if (t !== '' && td === null) errors.to = COMPLETE_DATE
  if (fd !== null && td !== null) {
    const days = td - fd + 1
    if (days < 1) errors.to = 'To must be on or after From.'
    else if (days > MAX_DAYS) errors.to = `The range can be at most ${MAX_DAYS} days (this one is ${days}).`
  }
  const ok = Object.keys(errors).length === 0
  return { ok, errors, query: ok ? buildQuery(f, t) : '' }
}

// '' for the default range, else "?from=...&to=...".
export function buildQuery(from, to) {
  if (!from && !to) return ''
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

// --- responses ---

const isCount = (n) => Number.isInteger(n) && n >= 0
const isAverage = (n) => n === null || Number.isFinite(n)

// GET /admin/analytics/routes -> { from, to, routes: [...] }, or null when unusable.
// Broken route entries are dropped, server order kept, null averages kept.
export function parseRoutesAnalytics(data) {
  if (!data || typeof data !== 'object' || typeof data.from !== 'string' || typeof data.to !== 'string') {
    return null
  }
  if (!Array.isArray(data.routes)) return null
  const routes = data.routes
    .filter(
      (r) =>
        r &&
        Number.isInteger(r.route_id) &&
        r.route_id > 0 &&
        typeof r.route_name === 'string' &&
        isCount(r.trips) &&
        isCount(r.rated_trips) &&
        isCount(r.completed_trips) &&
        isCount(r.timed_trips) &&
        isAverage(r.avg_rating) &&
        isAverage(r.avg_duration_min) &&
        isAverage(r.avg_predicted_eta_min) &&
        isAverage(r.avg_delay_min),
    )
    .map((r) => ({
      routeId: r.route_id,
      routeName: r.route_name,
      trips: r.trips,
      ratedTrips: r.rated_trips,
      avgRating: r.avg_rating,
      completedTrips: r.completed_trips,
      timedTrips: r.timed_trips,
      avgDurationMin: r.avg_duration_min,
      avgPredictedEtaMin: r.avg_predicted_eta_min,
      avgDelayMin: r.avg_delay_min,
    }))
  return { from: data.from, to: data.to, routes }
}

// GET /admin/analytics/demand -> { from, to, cells, tripsWithoutContext }, or null.
// Cells: weekday 1..7, hour 0..23, trips > 0; broken or duplicate cells dropped (first kept).
export function parseDemand(data) {
  if (!data || typeof data !== 'object' || typeof data.from !== 'string' || typeof data.to !== 'string') {
    return null
  }
  if (!Array.isArray(data.cells) || !isCount(data.trips_without_context)) return null
  const seen = new Set()
  const cells = []
  for (const c of data.cells) {
    if (
      !c ||
      !Number.isInteger(c.weekday) ||
      c.weekday < 1 ||
      c.weekday > 7 ||
      !Number.isInteger(c.hour) ||
      c.hour < 0 ||
      c.hour > 23 ||
      !Number.isInteger(c.trips) ||
      c.trips < 1
    ) {
      continue
    }
    const key = c.weekday * 100 + c.hour
    if (seen.has(key)) continue
    seen.add(key)
    cells.push({ weekday: c.weekday, hour: c.hour, trips: c.trips })
  }
  return { from: data.from, to: data.to, cells, tripsWithoutContext: data.trips_without_context }
}

// --- formatting ---

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

// One decimal as sent by the server (8 -> "8.0"); null -> "No data". Never 0 for null.
export function formatAverage(value, unit = '') {
  if (value === null || !Number.isFinite(value)) return 'No data'
  return unit ? `${value.toFixed(1)} ${unit}` : value.toFixed(1)
}

// "(from 90 timed trips)" next to every timed average.
export function basedOn(count, one, many) {
  return `(from ${plural(count, one, many)})`
}

// Delay in words with a sign and a symbol; tone is only an extra visual cue.
// -> { text, symbol, tone: 'late' | 'early' | 'on' | 'none' }
export function formatDelay(minutes) {
  if (minutes === null || !Number.isFinite(minutes)) return { text: 'No data', symbol: '', tone: 'none' }
  const abs = Math.abs(minutes).toFixed(1)
  if (abs === '0.0') return { text: '0 min, on prediction', symbol: '●', tone: 'on' }
  if (minutes > 0) return { text: `+${abs} min later than predicted`, symbol: '▲', tone: 'late' }
  return { text: `-${abs} min earlier than predicted`, symbol: '▼', tone: 'early' }
}

// "4.2 of 5, from 120 rated trips" / "No data (0 rated trips)".
export function formatRating(avg, ratedTrips) {
  const n = isCount(ratedTrips) ? ratedTrips : 0
  if (avg === null || !Number.isFinite(avg) || n === 0) return `No data (${plural(n, 'rated trip', 'rated trips')})`
  return `${avg.toFixed(1)} of 5, from ${plural(n, 'rated trip', 'rated trips')}`
}

// --- heatmap ---

// cells -> { hours: [h...], rows: [{ weekday, short, long, counts: [n per hour] }], max, total }.
// Hours span the smallest to largest hour present, never narrower than 06..21.
export function buildHeatmap(cells) {
  const list = Array.isArray(cells) ? cells : []
  let first = MIN_FIRST_HOUR
  let last = MIN_LAST_HOUR
  for (const c of list) {
    first = Math.min(first, c.hour)
    last = Math.max(last, c.hour)
  }
  const hours = []
  for (let h = first; h <= last; h++) hours.push(h)

  const counts = new Map(list.map((c) => [c.weekday * 100 + c.hour, c.trips]))
  let max = 0
  let total = 0
  const rows = WEEKDAYS.map((d) => ({
    ...d,
    counts: hours.map((h) => {
      const n = counts.get(d.weekday * 100 + h) ?? 0
      max = Math.max(max, n)
      total += n
      return n
    }),
  }))
  return { hours, rows, max, total }
}

// 0 for no trips, else 1..SHADE_LEVELS proportional to count/max.
export function shadeLevel(count, max) {
  if (!(count > 0) || !(max > 0)) return 0
  return Math.min(SHADE_LEVELS, Math.max(1, Math.ceil((SHADE_LEVELS * count) / max)))
}

export function formatHour(h) {
  return String(h).padStart(2, '0')
}

// --- errors ---
// Own wording per status, never server text. 401 -> null (logout flow takes over).
// Other statuses (and a 200 with an unusable body, status -1) -> generic.
export function analyticsErrorMessage(status) {
  switch (status) {
    case 401:
      return null
    case 0:
      return 'Cannot reach the server. Check your connection and try again.'
    case 400:
      return 'That date range was not accepted. Check the dates.'
    case 403:
      return 'This page is for admins only.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
