# SCMTS Tasks
One task = one fresh Claude session. Tick when done and committed.

## Phase 1 – Assessment
- [ ] 1.1 Write docs/SPEC.md (features per role, D1/D2/D3, MVP scope)
- [ ] 1.2 Decide MVP cut line (list what is NOT in MVP)

## Phase 2 – Design
- [x] 2.1 Design db/schema.sql (routes, stops, route_stops, buses, bus_live, trips, users)
- [ ] 2.2 Write docs/API.md (endpoint list with request/response JSON)
- [ ] 2.3 Create folder structure (frontend/, backend/, db/, docs/)
- [ ] 2.4 Finish admin dashboard DFD (Level 1)

## Phase 3 – MVP
### Backend + DB
- [x] 3.1 Go project skeleton, config via env vars, MySQL connection
- [x] 3.2 Run schema + seed data (3 routes, 10 stops, 4 buses)
- [x] 3.3 GET /routes and GET /stops
- [x] 3.4 GET /buses (reads D2)
- [x] 3.5 POST /trip/create (insert into D3, return ranked buses, nearest-bus logic)
- [x] 3.6 PATCH /trip/{id}/complete (rating + end time)
- [x] 3.7 Basic auth with roles (student/driver/admin)
  - [x] login + tokens: auth package, POST /auth/login, JWT_SECRET check, cmd/seeduser
  - [x] wrap /api routes in auth middleware (/health stays public), RequireRole, user id from token
  - [x] Set MySQL session time zone to UTC in db.go (then simplify buses.go timestamp handling)
### GPS + real time
- [x] 3.8 GPS simulator script: moves buses along a route, updates D2 every 3s
- [ ] 3.9 WebSocket endpoint broadcasting bus positions (/ws/buses: student, admin; /ws/driver: driver)
  - [x] 3.9-A ticket system: wsticket package, POST /api/ws-ticket (student, admin)
  - [x] 3.9-B GET /ws/buses live feed: hub package (one shared poller), ticket + Origin check,
        route mounted outside the request logger so the ticket is never logged
  - [x] 3.9-C WS /ws/driver (driver GPS over WebSocket)
  - [x] 3.9-D ranking skips buses on break (out_of_service and break excluded, delayed eligible)
### Student UI
- [x] 3.10 React skeleton + routing + API helper (Vite + react-router-dom, login, sessionStorage auth)
- [x] 3.11 Live map with bus markers (Leaflet + OpenStreetMap)
- [x] 3.12 Destination picker + call POST /trip/create
- [x] 3.13 Advisor card + nearby buses list
- [x] 3.14 Alerts strip
  - alerts table / GET /alerts unused in MVP; revisit after MVP
- [x] 3.15 Trip history + rating form
  - [x] 3.15-A GET /trips
  - [x] 3.15-B history + rating UI
### Driver UI
- [x] 3.16 Show assigned route (GET /driver/route: role driver)
  - [x] 3.16-A GET /driver/route
  - [x] 3.16-B driver route page
- [ ] 3.17 Send GPS + status updates (driver endpoints: role driver)
- [ ] 3.18 Log passenger count (POST /driver/passengers: role driver)
### Admin UI
- [ ] 3.19 CRUD routes and stops (writes D1; /admin/*: role admin)
- [ ] 3.20 Fleet overview (reads D2; GET /admin/fleet: role admin)

## Phase 4 – Pre-AI data
- [ ] 4.1 Add context columns to trips (time, weekday, delay, passengers)
- [ ] 4.2 Admin analytics queries (busiest routes, average delay; /admin/analytics/*: role admin)
- [ ] 4.3 Analytics page in admin UI
- [ ] 4.4 Script to generate extra synthetic trip data

## Phase 5 – AI (only after MVP is stable)
- [ ] 5.1 Export trip data to CSV for training
- [ ] 5.2 ETA prediction model (simple regression first)
- [ ] 5.3 Serve predictions from Go (keep rule-based logic as fallback)
- [ ] 5.4 Demand prediction (stretch)
