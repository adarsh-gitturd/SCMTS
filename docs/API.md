# SCMTS API

Base URL (dev): http://localhost:8080/api
Format: JSON. Auth: `Authorization: Bearer <token>` on every /api endpoint; /health and
/auth/login are public, /ws/buses uses a ticket (see WebSocket).
Roles: student, driver, admin. Wrong role returns 403.
Error shape: `{ "error": "message" }` with 400 (bad input), 401, 403, 404, 500.
Update this file whenever you add or change an endpoint.

Auth errors (every /api endpoint):
- 401 `{ "error": "unauthorized" }`: Authorization header missing or not `Bearer <token>`,
  or the token is malformed, expired, or has a bad signature/algorithm.
- 403 `{ "error": "forbidden" }`: valid token, but the role may not call this endpoint.
Role and user id come from the token, so role changes apply at the next login (max 24h).
Each endpoint below lists who may call it in **Roles:**.

## Health
### GET /health
Outside /api (http://localhost:8080/health) and public: no token needed.
**Roles:** public.
Res 200: `{ "status": "ok", "db": "ok" }`
Res 503: `{ "status": "error", "db": "unreachable" }`

## Auth
### POST /auth/login
Outside /api (http://localhost:8080/auth/login) and public: no token needed.
**Roles:** public.
Req:  `{ "email": "a@b.com", "password": "..." }`  (email is trimmed; body max 1 MB)
Res 200: `{ "token": "...", "user": { "id": 1, "name": "Asha", "role": "student" } }`
Res 400: invalid JSON, or email/password missing or empty
Res 401: `invalid credentials` (same response for unknown email and wrong password)
Res 500: `internal error`
Token: JWT, HS256, expires 24h after login. Claims: `uid`, `role`, `exp`.

### GET /me  (not built yet)
**Roles:** any logged-in user.
Res 200: `{ "id": 1, "name": "Asha", "role": "student" }`

## Shared reads (D1)
**Roles:** any logged-in user (student, driver, admin).

### GET /routes
Res 200: `[ { "id": 1, "name": "Main Gate - Hostel", "stops": [ {"stop_id": 3, "order": 1} ] } ]`

### GET /stops
Res 200: `[ { "id": 3, "name": "Library", "lat": 13.0102, "lng": 80.2355 } ]`

## Student
**Roles:** student, except GET /buses (any logged-in user).
Trips are always created for and owned by the logged-in student (user id from the token).

### GET /buses  (reads D2)
**Roles:** any logged-in user.
Query: `?route_id=1` (optional)
Res 200:
`[ { "id": 7, "route_id": 1, "lat": 13.01, "lng": 80.23, "speed": 22, "status": "on_route", "updated_at": "2026-10-11T09:30:05Z" } ]`

### POST /trip/create  (rank, then INSERT D3 with the top pick; one transaction)
**Roles:** student.
Errors: 400 bad JSON / missing fields / lat-lng out of range, 401 no/invalid token,
403 not a student, 404 destination stop not found.
`recommendations` is `[]` when no bus qualifies (trip is still stored, bus/route/board stop NULL).
Req:  `{ "origin": {"lat": 13.01, "lng": 80.23}, "destination": {"stop_id": 5} }`
Res 201:
`{ "trip_id": 42, "recommendations": [ { "bus_id": 7, "route_id": 1, "eta_minutes": 6, "board_stop_id": 3, "distance_m": 850, "rank": 1 } ] }`

### PATCH /trip/{id}/complete  (UPDATE D3)
**Roles:** student (own trips only).
Req:  `{ "rating": 4, "feedback": "On time" }`  (rating 1-5, feedback optional, max 500 chars, trimmed; empty -> null)
Res 200: `{ "trip_id": 42, "status": "completed" }`
Res 400: invalid id, invalid JSON, missing rating, rating outside 1-5, feedback too long
Res 401: no/invalid token. Res 403: not a student.
Res 404: `trip not found` (also for trips of another student)
Res 409: `trip already completed`
Rating can only be set once: a completed trip cannot be re-rated or changed.

### GET /trips  (reads D3)
**Roles:** student (own trips only; student id from the token).
History for the logged-in student, newest first (`started_at` desc, then `id` desc).
Query: `?limit=N` (optional, default 50, 1-100)
Res 200 (always an array, `[]` when there are no trips):
`[ { "id": 42, "status": "completed", "destination": "Library", "destination_stop_id": 5, "route_id": 1, "bus_id": 7, "board_stop_id": 3, "rating": 4, "feedback": "On time", "started_at": "2026-10-17T10:56:14Z", "ended_at": "2026-10-17T11:20:02Z" } ]`
`status` is `started` or `completed`. `route_id`, `bus_id`, `board_stop_id`, `rating`, `feedback`
and `ended_at` are `null` when not set (e.g. no bus qualified, or trip not completed yet).
Timestamps are RFC3339 UTC.
Res 400: `limit must be an integer between 1 and 100`
Res 401: no/invalid token. Res 403: not a student. Res 500: `internal error`

### GET /places, POST /places  (not built yet)
Saved places. POST req: `{ "name": "Hostel", "stop_id": 8 }`

### GET /alerts  (not built yet)
Not built yet; the MVP derives alerts in the frontend from live bus status.
Res 200: `[ { "id": 1, "type": "delay", "bus_id": 7, "message": "Bus 7 running 5 min late", "created_at": "..." } ]`

## Driver
**Roles:** driver (all endpoints in this section).

### GET /driver/route  (reads D1)
Assigned bus, route and stops for the logged-in driver (driver id from the token;
a driver only ever sees their own bus).
Res 200:
`{ "bus_id": 7, "plate": "TN01AB1234", "route": { "id": 1, "name": "Main Gate - Hostel", "stops": [ { "stop_id": 3, "name": "Library", "lat": 13.0102, "lng": 80.2355, "order": 1 } ] } }`
`stops` is ordered by `order` and is always an array (`[]` when the route has no stops).
`route` is `null` when the bus has no route assigned.
Res 404: `no bus assigned` (no bus has this driver).
Res 401: no/invalid token. Res 403: not a driver. Res 500: `internal error`

### POST /driver/location  (upserts D2)
Req:  `{ "lat": 13.01, "lng": 80.23, "speed": 22 }`  (speed in km/h)
All three fields required (missing `speed` is 400, not 0). lat -90..90, lng -180..180,
speed 0..200. Body max 1 KB. Unknown fields (e.g. a client `timestamp`) are ignored;
the server sets `updated_at`.
Writes lat, lng, speed and `updated_at` of the driver's own bus (driver id from the
token; no bus id is accepted). Never changes `status` on an existing row. If the bus
has no D2 row yet, one is created with status `out_of_service`.
Res 204.
Res 400: invalid JSON / validation message. Res 404: `no bus assigned`.
Res 429: `too many updates` (less than 500 ms since this driver's last accepted write;
in memory, per server process). Res 401: no/invalid token. Res 403: not a driver.
Res 500: `internal error`

### PATCH /driver/status  (updates D2)
Req:  `{ "status": "delayed" }`  (exactly one of on_route | delayed | break | out_of_service)
Sets the status of the driver's own bus and bumps `updated_at`.
Res 200: `{ "bus_id": 7, "status": "delayed" }`
Res 400: invalid JSON or any other value. Res 404: `no bus assigned`.
Res 409: `send a location first` (bus has no D2 row yet).
Res 401: no/invalid token. Res 403: not a driver. Res 500: `internal error`

### POST /driver/passengers  (INSERT D3)
Req:  `{ "count": 18, "stop_id": 3 }`
Both fields required (missing or `null` is 400, not 0). count: integer 0..200 (18.5, 18.0
or "18" is 400). stop_id: positive integer. Body max 1 KB. Unknown fields are ignored.
Writes one row for the driver's own bus (driver id from the token; no bus id, driver id
or timestamp is accepted); the server sets `logged_at`. The stop must be on the bus's route.
Res 201: `{ "id": 311 }`
Res 400: invalid JSON / validation message, or `stop is not on your route`.
Res 404: `no bus assigned`, or `stop not found`.
Res 409: `no route assigned` (the bus has no route).
If several apply, checked in this order: no bus, no route, stop not found, not on route.
Res 429: `too many updates` (less than 1 s since this driver's last accepted log;
in memory, per server process). Res 401: no/invalid token. Res 403: not a driver.
Res 500: `internal error`

## Admin
**Roles:** admin (all endpoints in this section).

### Routes, stops, buses (write D1)
- POST /admin/stops, PUT /admin/stops/{id}, DELETE /admin/stops/{id}
- POST /admin/routes, PUT /admin/routes/{id}, DELETE /admin/routes/{id}

Stop body (POST and PUT): `{ "name": "Library", "lat": 13.0102, "lng": 80.2355 }`
- All three fields required (PUT is a full replace). Unknown fields ignored. Body max 4 KB.
- name: trimmed, 1-100 characters, no control characters (tab, newline, ...). Not unique.
- lat -90..90, lng -180..180; rounded to 6 decimals before storing.
`{id}` must be a positive integer, otherwise 400 `id must be a positive integer`.
Errors: 400 bad JSON / missing field / invalid value, 401, 403 not an admin, 500 `internal error`.

### POST /admin/stops
Res 201: `{ "id": 3 }`

### PUT /admin/stops/{id}
Res 200: the stop as stored, same shape as GET /stops:
`{ "id": 3, "name": "Library", "lat": 13.0102, "lng": 80.2355 }`
Sending the same values again is still 200.
Res 404: `stop not found`

### DELETE /admin/stops/{id}
Res 204: no body.
Res 404: `stop not found`
Res 409: `stop is in use`: the stop is on a route (route_stops), is the destination of any
trip, or has passenger logs. Nothing is changed.
A successful delete also deletes students' saved_places for that stop and sets
trips.board_stop_id to NULL on past trips that boarded there.

Route body (POST and PUT): `{ "name": "Main Gate - Hostel", "stops": [3, 5, 1] }`
- Both fields required (PUT is a full replace of name and stops). Unknown fields ignored. Body max 8 KB.
- name: trimmed, 1-100 characters, no control characters. Unique: 409 `route name already exists`.
- stops: ordered stop ids; stop_order is the 1-based position. `[]` is allowed; missing or
  `null` is 400. At most 50, each a positive integer, no id twice (400 `duplicate stop id 5`).
- A stop id that does not exist: 400 `unknown stop id`; nothing is changed.
`{id}` must be a positive integer, otherwise 400 `id must be a positive integer`.
Errors: 400 bad JSON / missing field / invalid value, 401, 403 not an admin, 500 `internal error`.

### POST /admin/routes
Res 201: `{ "id": 4 }`
Res 409: `route name already exists`

### PUT /admin/routes/{id}
Res 200: the route as stored, same shape as GET /routes, stops in order (always an array):
`{ "id": 4, "name": "Main Gate - Hostel", "stops": [ {"stop_id": 3, "order": 1} ] }`
Sending the same values again is still 200. On any error the route is unchanged.
Res 404: `route not found`
Res 409: `route name already exists`

### DELETE /admin/routes/{id}
Res 204: no body.
Res 404: `route not found`
Res 409: `route has buses assigned`: some bus has this route_id. Nothing is changed.
A successful delete also deletes the route's stop list (route_stops) and sets
trips.route_id to NULL on past trips of that route.

### Buses (not built yet)
- POST /admin/buses, PUT /admin/buses/{id}, DELETE /admin/buses/{id}
Example POST /admin/buses: `{ "plate": "TN01AB1234", "route_id": 1, "driver_id": 9 }`

### GET /admin/fleet  (reads D2)
**Roles:** admin. Read-only.
All buses with live data, route and driver name, ordered by bus id, at most 500 (hard cap,
no truncation flag).
Res 200:
`{ "server_time": "2026-10-17T10:56:14Z", "buses": [ { "bus_id": 1, "plate": "KL-07-CB-1101", "route_id": 1, "route_name": "Main Gate - Hostel", "driver_id": 9, "driver_name": "Ravi", "live": { "lat": 10.0436, "lng": 76.3241, "speed": 22, "status": "on_route", "updated_at": "2026-10-17T10:56:11Z" } } ] }`
- `buses` is always an array (`[]` when there are no buses).
- `live` is null when the bus has no bus_live row yet.
- `route_id`/`route_name` null when no route assigned; `driver_id`/`driver_name` null when no driver.
- `server_time` is the database clock (CURRENT_TIMESTAMP, same query), so it can be compared
  with `updated_at` to see how old a position is. Times are RFC3339 UTC.
- Only the driver's name is returned from users (no email, role, etc.).
Res 401: no/invalid token. Res 403: not an admin. Res 500: `internal error`

### Analytics query parameters (both endpoints below)
`?from=YYYY-MM-DD&to=YYYY-MM-DD`, both optional, inclusive, dates in the campus time zone
(CAMPUS_TZ, default Asia/Kolkata). An empty value counts as missing.
- Default `to`: today's campus date (server clock). Default `from`: 29 days before `to`
  (30 days). Only `from` given: `to` is today.
- A trip is in range when `started_at` >= start of `from` and < start of the day after `to`
  (campus midnights, converted to UTC; DST days are 23/25 hours).
- The response echoes the dates actually used as `from` and `to`.
- Res 400: `from must be a date YYYY-MM-DD`, `to must be a date YYYY-MM-DD`,
  `to must not be before from`, `range must be at most 366 days`
- Aggregates only: no student ids, names, origins, feedback or individual trips.

### GET /admin/analytics/routes  (reads D3)
**Roles:** admin. Read-only.
One row per route with at least one trip in range, ordered by `trips` desc, then `route_id`,
at most 200 (hard cap).
Res 200:
`{ "from": "2026-10-01", "to": "2026-10-17", "routes": [ { "route_id": 1, "route_name": "Main Gate - Hostel", "trips": 320, "rated_trips": 120, "avg_rating": 4.2, "completed_trips": 150, "timed_trips": 90, "avg_duration_min": 14.5, "avg_predicted_eta_min": 12.1, "avg_delay_min": 2.4 } ] }`
- `routes` is always an array (`[]` when there are no trips).
- Trips with `route_id` NULL are not counted here: trips with no recommended route, and trips
  whose route was deleted (the delete sets their route_id to NULL). /demand still counts them.
- `trips`: all trips on the route in range. `completed_trips`: status `completed`.
- `avg_rating`: over the `rated_trips` (rating not NULL); null when `rated_trips` is 0.
- Timed trips: completed, with `ended_at` and `predicted_eta_min` (only set when a bus was
  recommended, from task 4.1). `timed_trips` counts them. Over that same set:
  `avg_duration_min` = average of (ended_at - started_at) in minutes (seconds kept),
  `avg_predicted_eta_min`, and `avg_delay_min` = average of (duration - predicted_eta_min).
  Negative delay = arrived earlier than predicted (not clamped). All three null when
  `timed_trips` is 0. No delay is stored; it is derived here.
- Averages are rounded to 1 decimal in Go, each on its own, so
  `avg_duration_min - avg_predicted_eta_min` can differ from `avg_delay_min` by 0.1.
Res 401: no/invalid token. Res 403: not an admin. Res 500: `internal error`

### GET /admin/analytics/demand  (reads D3)
**Roles:** admin. Read-only.
Trips per (weekday, hour) in range, all routes (including route_id NULL), from the stored
`start_weekday` (ISO, 1=Mon..7=Sun) and `start_hour` (0-23, campus local).
Res 200:
`{ "from": "2026-10-01", "to": "2026-10-17", "cells": [ { "weekday": 1, "hour": 8, "trips": 54 } ], "trips_without_context": 12 }`
- `cells` is sparse (only cells with at least one trip), ordered by weekday, then hour,
  always an array (`[]` when there are no trips).
- `trips_without_context`: trips in range with `start_weekday` or `start_hour` NULL (created
  before task 4.1). They are not in `cells`. Computed in the same query: GROUP BY
  (start_weekday, start_hour), and the groups containing a NULL are summed.
Res 401: no/invalid token. Res 403: not an admin. Res 500: `internal error`

## WebSocket
Browsers can't send an Authorization header when opening a WebSocket, so the client first
gets a one-time ticket from POST /ws-ticket, then opens the socket with it in the URL:
`wss://<host>/ws/buses?ticket=<ticket>`.

### POST /ws-ticket
**Roles:** student, admin.
No request body. User id and role come from the token.
Res 200: `{ "ticket": "kX9...", "expires_in": 30 }`  (header `Cache-Control: no-store`)
Res 401: no/invalid token. Res 403: not a student or admin.
Res 503: `too many requests, try again` (server-wide limit of 10,000 live tickets)
Res 500: `internal error`
Ticket: 32 random bytes, base64url without padding (43 chars). Valid for 30 seconds and
single use: it is consumed when GET /ws/buses checks it, even if the connection then fails
(including 503). Get a new ticket for every connection or reconnect. Tickets are in memory
and do not survive a restart.

### WS /ws/buses?ticket=<ticket>  (students, admin)
Outside /api (ws://localhost:8080/ws/buses) and not request-logged, because the URL carries the ticket.
**Roles:** student, admin (taken from the ticket; no Authorization header).
Checked before the upgrade, in this order (errors are plain HTTP with the usual error shape):
- 403 `forbidden`: `Origin` header missing or not listed in the server's `ALLOWED_ORIGINS`
  (exact `scheme://host[:port]` match). The ticket is not consumed.
- 401 `unauthorized`: ticket missing, unknown, expired or already used.
- 403 `forbidden`: ticket belongs to a role other than student/admin.
- 503 `too many connections, try again`: 200 live connections already (ticket is consumed).

After connecting, the server sends one JSON text frame per bus:
`{ "type": "position", "bus_id": 7, "lat": 13.01, "lng": 80.23, "speed": 22, "status": "on_route", "ts": "2026-10-16T08:30:00Z" }`
(`ts` = bus_live.updated_at, RFC 3339 UTC.)
- First a full snapshot: one frame for every bus in bus_live.
- Then, polled every second, a frame only for buses that changed (any field, including `ts`).
  No update is lost or repeated between the snapshot and the first change.
- A bus removed from bus_live sends nothing; if it comes back it is sent again as new.
The socket is receive-only: any message from the client closes it with 1008 (policy violation).
Server pings every 30s and drops clients that don't answer within 10s.
Close codes: 1008 `too slow` (client fell ~16s behind) or `read-only`; 1001 `server shutting down`.
On close, get a new ticket and reconnect; the new snapshot replaces local state.

Server config: `ALLOWED_ORIGINS` env var, comma-separated, e.g.
`http://localhost:5173,https://scmts.example.com`. The server refuses to start without it.

### WS /ws/driver  (driver)  (not built yet)
**Roles:** driver.
Client sends location every ~3s: `{ "lat": 13.01, "lng": 80.23, "speed": 22, "ts": "..." }`
Server acks with `{ "ok": true }`. Client buffers and retries if the connection drops.

## Core tables (for reference; full schema in db/schema.sql)
users, routes, stops, route_stops, buses, bus_live (D2), trips (D3), passenger_logs (D3),
saved_places, alerts
