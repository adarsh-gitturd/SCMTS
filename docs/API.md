# SCMTS API

Base URL (dev): http://localhost:8080/api
Format: JSON. Auth: `Authorization: Bearer <token>` on everything except /auth/login.
Roles: student, driver, admin. Wrong role returns 403.
Error shape: `{ "error": "message" }` with 400 (bad input), 401, 403, 404, 500.
Update this file whenever you add or change an endpoint.

## Health
### GET /health
Outside /api (http://localhost:8080/health) and public: no token needed.
Res 200: `{ "status": "ok", "db": "ok" }`
Res 503: `{ "status": "error", "db": "unreachable" }`

## Auth
### POST /auth/login
Req:  `{ "email": "a@b.com", "password": "..." }`
Res 200: `{ "token": "...", "user": { "id": 1, "name": "Asha", "role": "student" } }`

### GET /me
Res 200: `{ "id": 1, "name": "Asha", "role": "student" }`

## Shared reads (D1)
### GET /routes
Res 200: `[ { "id": 1, "name": "Main Gate - Hostel", "stops": [ {"stop_id": 3, "order": 1} ] } ]`

### GET /stops
Res 200: `[ { "id": 3, "name": "Library", "lat": 13.0102, "lng": 80.2355 } ]`

## Student
### GET /buses  (reads D2)
Query: `?route_id=1` (optional)
Res 200:
`[ { "id": 7, "route_id": 1, "lat": 13.01, "lng": 80.23, "speed": 22, "status": "on_route", "updated_at": "2026-10-11T09:30:05Z" } ]`

### POST /trip/create  (INSERT D3, then rank)
Req:  `{ "origin": {"lat": 13.01, "lng": 80.23}, "destination": {"stop_id": 5} }`
Res 201:
`{ "trip_id": 42, "recommendations": [ { "bus_id": 7, "route_id": 1, "eta_minutes": 6, "board_stop_id": 3, "distance_m": 850, "rank": 1 } ] }`

### PATCH /trip/{id}/complete  (UPDATE D3)
Req:  `{ "rating": 4, "feedback": "On time" }`  (rating 1-5, feedback optional)
Res 200: `{ "trip_id": 42, "status": "completed" }`

### GET /trips
History for the logged-in student, newest first.
Res 200: `[ { "id": 42, "route_id": 1, "bus_id": 7, "destination": "Library", "rating": 4, "started_at": "...", "ended_at": "..." } ]`

### GET /places, POST /places
Saved places. POST req: `{ "name": "Hostel", "stop_id": 8 }`

### GET /alerts
Res 200: `[ { "id": 1, "type": "delay", "bus_id": 7, "message": "Bus 7 running 5 min late", "created_at": "..." } ]`

## Driver
### GET /driver/route
Assigned route and stops for the logged-in driver's bus.
Res 200: `{ "bus_id": 7, "route": { "id": 1, "name": "...", "stops": [ ... ] } }`

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
### WS /ws/buses  (students, admin)
Server pushes on every D2 change:
`{ "type": "position", "bus_id": 7, "lat": 13.01, "lng": 80.23, "speed": 22, "status": "on_route", "ts": "..." }`

### WS /ws/driver  (driver)
Client sends location every ~3s: `{ "lat": 13.01, "lng": 80.23, "speed": 22, "ts": "..." }`
Server acks with `{ "ok": true }`. Client buffers and retries if the connection drops.

## Core tables (for reference; full schema in db/schema.sql)
users, routes, stops, route_stops, buses, bus_live (D2), trips (D3), passenger_logs (D3),
saved_places, alerts
