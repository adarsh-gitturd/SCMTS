// Manual check for analyticsLogic.js. Run from frontend/: node src/admin/analyticsLogic.check.js
import assert from 'node:assert/strict'
import {
  analyticsErrorMessage,
  basedOn,
  buildHeatmap,
  buildQuery,
  formatAverage,
  formatDelay,
  formatHour,
  formatRating,
  parseDemand,
  parseRoutesAnalytics,
  shadeLevel,
  validateRange,
} from './analyticsLogic.js'

// validateRange: empty both = default; both required otherwise; strict dates; order; 366 days
{
  assert.deepEqual(validateRange('', ''), { ok: true, errors: {}, query: '' })
  assert.deepEqual(validateRange('2026-10-17', '2026-10-17'), {
    ok: true,
    errors: {},
    query: '?from=2026-10-17&to=2026-10-17',
  })
  const onlyTo = validateRange('', '2026-10-17')
  assert.equal(onlyTo.ok, false)
  assert.match(onlyTo.errors.from, /both dates/)
  assert.equal(onlyTo.errors.to, undefined)
  assert.match(validateRange('2026-10-01', '').errors.to, /both dates/)

  for (const bad of ['2026-13-01', '2026-1-5', 'abc', '2026-02-30', '0099-01-01', '2026-10-1 ', '?']) {
    const r = validateRange(bad, '2026-10-17')
    assert.equal(r.ok, false, bad)
    assert.equal(r.errors.from, 'Enter a complete date.', bad)
    assert.equal(r.query, '')
  }
  assert.equal(validateRange('2024-02-29', '2024-03-01').ok, true) // leap day

  assert.equal(validateRange('2026-10-10', '2026-10-09').errors.to, 'To must be on or after From.')
  assert.equal(validateRange('2025-10-17', '2026-10-17').ok, true) // 366 days
  assert.equal(
    validateRange('2025-10-16', '2026-10-17').errors.to,
    'The range can be at most 366 days (this one is 367).',
  )
  assert.equal(validateRange('2024-01-01', '2024-12-31').ok, true) // leap year, 366 days
  // Across a DST change elsewhere: UTC day arithmetic, no 23/25-hour days.
  assert.equal(validateRange('2026-03-08', '2027-03-08').ok, true) // 366 days
  assert.equal(validateRange('2026-03-07', '2027-03-08').ok, false) // 367 days
  assert.equal(validateRange(undefined, null).ok, true)
}

// buildQuery
{
  assert.equal(buildQuery('', ''), '')
  assert.equal(buildQuery('2026-10-01', '2026-10-17'), '?from=2026-10-01&to=2026-10-17')
}

// parseRoutesAnalytics: validates, drops broken entries, keeps order, null kept
{
  const route = (over = {}) => ({
    route_id: 1,
    route_name: 'Main Gate - Hostel',
    trips: 320,
    rated_trips: 120,
    avg_rating: 4.2,
    completed_trips: 150,
    timed_trips: 90,
    avg_duration_min: 14.5,
    avg_predicted_eta_min: 12.1,
    avg_delay_min: 2.4,
    ...over,
  })
  const nulls = { avg_rating: null, avg_duration_min: null, avg_predicted_eta_min: null, avg_delay_min: null }
  const parsed = parseRoutesAnalytics({
    from: '2026-10-01',
    to: '2026-10-17',
    routes: [
      route({ route_id: 3, trips: 400 }),
      route({ route_id: 0 }),
      route({ route_name: null }),
      route({ trips: -1 }),
      route({ avg_rating: '4.2' }),
      route({ avg_delay_min: Number.NaN }),
      null,
      route({ route_id: 2, rated_trips: 0, timed_trips: 0, ...nulls }),
    ],
  })
  assert.equal(parsed.from, '2026-10-01')
  assert.deepEqual(
    parsed.routes.map((r) => r.routeId),
    [3, 2],
  )
  assert.equal(parsed.routes[1].avgRating, null)
  assert.equal(parsed.routes[1].avgDelayMin, null)
  assert.equal(parsed.routes[0].avgPredictedEtaMin, 12.1)
  assert.deepEqual(parseRoutesAnalytics({ from: 'a', to: 'b', routes: [] }).routes, [])
  assert.equal(parseRoutesAnalytics(null), null)
  assert.equal(parseRoutesAnalytics({ from: 'a', to: 'b', routes: null }), null)
  assert.equal(parseRoutesAnalytics({ to: 'b', routes: [] }), null)
  assert.equal(parseRoutesAnalytics([]), null)
}

// parseDemand
{
  const parsed = parseDemand({
    from: '2026-10-01',
    to: '2026-10-17',
    cells: [
      { weekday: 1, hour: 8, trips: 54 },
      { weekday: 1, hour: 8, trips: 99 }, // duplicate: first kept
      { weekday: 0, hour: 8, trips: 1 },
      { weekday: 8, hour: 8, trips: 1 },
      { weekday: 2, hour: 24, trips: 1 },
      { weekday: 2, hour: -1, trips: 1 },
      { weekday: 2, hour: 9, trips: 0 },
      { weekday: 2, hour: 9, trips: 1.5 },
      { weekday: '3', hour: 9, trips: 1 },
      null,
      { weekday: 7, hour: 23, trips: 4 },
    ],
    trips_without_context: 12,
  })
  assert.deepEqual(parsed, {
    from: '2026-10-01',
    to: '2026-10-17',
    cells: [
      { weekday: 1, hour: 8, trips: 54 },
      { weekday: 7, hour: 23, trips: 4 },
    ],
    tripsWithoutContext: 12,
  })
  assert.deepEqual(parseDemand({ from: 'a', to: 'b', cells: [], trips_without_context: 0 }).cells, [])
  assert.equal(parseDemand({ from: 'a', to: 'b', cells: [], trips_without_context: -1 }), null)
  assert.equal(parseDemand({ from: 'a', to: 'b', cells: [] }), null)
  assert.equal(parseDemand({ from: 'a', to: 'b', cells: {}, trips_without_context: 0 }), null)
  assert.equal(parseDemand('x'), null)
}

// formatting: null -> "No data", never 0
{
  assert.equal(formatAverage(null, 'min'), 'No data')
  assert.equal(formatAverage(14.5, 'min'), '14.5 min')
  assert.equal(formatAverage(8, 'min'), '8.0 min')
  assert.equal(formatAverage(0, 'min'), '0.0 min')
  assert.equal(formatAverage(Number.NaN), 'No data')
  assert.equal(basedOn(90, 'timed trip', 'timed trips'), '(from 90 timed trips)')
  assert.equal(basedOn(1, 'timed trip', 'timed trips'), '(from 1 timed trip)')

  assert.deepEqual(formatDelay(2.4), { text: '+2.4 min later than predicted', symbol: '▲', tone: 'late' })
  assert.deepEqual(formatDelay(-1), { text: '-1.0 min earlier than predicted', symbol: '▼', tone: 'early' })
  assert.deepEqual(formatDelay(0), { text: '0 min, on prediction', symbol: '●', tone: 'on' })
  assert.deepEqual(formatDelay(-0), { text: '0 min, on prediction', symbol: '●', tone: 'on' })
  assert.deepEqual(formatDelay(null), { text: 'No data', symbol: '', tone: 'none' })

  assert.equal(formatRating(4.2, 120), '4.2 of 5, from 120 rated trips')
  assert.equal(formatRating(5, 1), '5.0 of 5, from 1 rated trip')
  assert.equal(formatRating(null, 0), 'No data (0 rated trips)')
  assert.equal(formatRating(null, undefined), 'No data (0 rated trips)')
  assert.equal(formatHour(6), '06')
  assert.equal(formatHour(21), '21')
}

// buildHeatmap: 7 rows Mon..Sun, hours at least 06..21, widened by data, totals
{
  const empty = buildHeatmap([])
  assert.deepEqual(empty.hours, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
  assert.equal(empty.rows.length, 7)
  assert.deepEqual(
    empty.rows.map((r) => r.weekday),
    [1, 2, 3, 4, 5, 6, 7],
  )
  assert.equal(empty.rows[0].short, 'Mon')
  assert.equal(empty.rows[6].long, 'Sunday')
  assert.equal(empty.max, 0)
  assert.equal(empty.total, 0)
  assert.ok(empty.rows.every((r) => r.counts.every((n) => n === 0)))
  assert.deepEqual(buildHeatmap(undefined).hours, empty.hours)

  const hm = buildHeatmap([
    { weekday: 1, hour: 8, trips: 54 },
    { weekday: 7, hour: 23, trips: 4 },
    { weekday: 3, hour: 0, trips: 1 },
  ])
  assert.equal(hm.hours[0], 0)
  assert.equal(hm.hours.at(-1), 23)
  assert.equal(hm.hours.length, 24)
  assert.equal(hm.rows[0].counts[hm.hours.indexOf(8)], 54)
  assert.equal(hm.rows[6].counts[hm.hours.indexOf(23)], 4)
  assert.equal(hm.rows[2].counts[0], 1)
  assert.equal(hm.max, 54)
  assert.equal(hm.total, 59)

  const narrow = buildHeatmap([{ weekday: 2, hour: 10, trips: 3 }])
  assert.equal(narrow.hours[0], 6)
  assert.equal(narrow.hours.at(-1), 21)
}

// shadeLevel: discrete 0..4, non-zero counts at least 1
{
  assert.equal(shadeLevel(0, 10), 0)
  assert.equal(shadeLevel(5, 0), 0)
  assert.equal(shadeLevel(1, 100), 1)
  assert.equal(shadeLevel(25, 100), 1)
  assert.equal(shadeLevel(26, 100), 2)
  assert.equal(shadeLevel(50, 100), 2)
  assert.equal(shadeLevel(75, 100), 3)
  assert.equal(shadeLevel(76, 100), 4)
  assert.equal(shadeLevel(100, 100), 4)
  assert.equal(shadeLevel(200, 100), 4)
  assert.equal(shadeLevel(-1, 100), 0)
}

// analyticsErrorMessage: own wording only
{
  assert.equal(analyticsErrorMessage(401), null)
  assert.equal(analyticsErrorMessage(400), 'That date range was not accepted. Check the dates.')
  assert.equal(analyticsErrorMessage(403), 'This page is for admins only.')
  assert.equal(analyticsErrorMessage(0), 'Cannot reach the server. Check your connection and try again.')
  assert.equal(analyticsErrorMessage(500), 'Something went wrong. Please try again.')
  assert.equal(analyticsErrorMessage(-1), 'Something went wrong. Please try again.')
  assert.equal(analyticsErrorMessage(undefined), 'Something went wrong. Please try again.')
}

process.stdout.write('analyticsLogic: all checks passed\n')
