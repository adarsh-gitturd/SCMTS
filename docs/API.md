# SCMTS API

Base URL (dev): http://localhost:8080/api
Format: JSON. Auth: `Authorization: Bearer <token>` on everything except /auth/login.
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

### GET /places, POST /places
Saved places. POST req: `{ "name": "Hostel", "stop_id": 8 }`

### GET /alerts
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

### POST /driver/location  (HTTPS fallback; WebSocket preferred)
Req:  `{ "lat": 13.01, "lng": 80.23, "speed": 22, "timestamp": "2026-10-11T09:30:05Z" }`
Res 204. Overwrites that bus's row in D2.

### PATCH /driver/status
Req:  `{ "status": "delayed" }`  (on_route | delayed | break | out_of_service)
Res 200: `{ "bus_id": 7, "status": "delayed" }`

### POST /driver/passengers  (INSERT D3)
Req:  `{ "count": 18, "stop_id": 3 }`
Res 201: `{ "id": 311 }`

## Admin
**Roles:** admin (all endpoints in this section).

### Routes, stops, buses (write D1)
- POST /admin/routes, PUT /admin/routes/{id}, DELETE /admin/routes/{id}
- POST /admin/stops, PUT /admin/stops/{id}, DELETE /admin/stops/{id}
- POST /admin/buses, PUT /admin/buses/{id}, DELETE /admin/buses/{id}
Example POST /admin/stops: `{ "name": "Library", "lat": 13.0102, "lng": 80.2355 }` -> 201 `{ "id": 3 }`
Example POST /admin/buses: `{ "plate": "TN01AB1234", "route_id": 1, "driver_id": 9 }`

### GET /admin/fleet  (reads D2)
All buses with live status, driver and last update time.

### GET /admin/analytics/routes  (reads D3)
Res 200: `[ { "route_id": 1, "trips": 320, "avg_rating": 4.2, "avg_delay_min": 3.1 } ]`

### GET /admin/analytics/demand
Query: `?from=2026-10-01&to=2026-10-11`
Res 200: `[ { "hour": 8, "weekday": 1, "trips": 54 } ]`

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

### WS /ws/driver  (driver)
**Roles:** driver.
Client sends location every ~3s: `{ "lat": 13.01, "lng": 80.23, "speed": 22, "ts": "..." }`
Server acks with `{ "ok": true }`. Client buffers and retries if the connection drops.

## Core tables (for reference; full schema in db/schema.sql)
users, routes, stops, route_stops, buses, bus_live (D2), trips (D3), passenger_logs (D3),
saved_places, alerts
