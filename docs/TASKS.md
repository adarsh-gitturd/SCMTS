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
- [ ] 3.1 Go project skeleton, config via env vars, MySQL connection
- [ ] 3.2 Run schema + seed data (3 routes, 10 stops, 4 buses)
- [ ] 3.3 GET /routes and GET /stops
- [ ] 3.4 GET /buses (reads D2)
- [ ] 3.5 POST /trip/create (insert into D3, return ranked buses, nearest-bus logic)
- [ ] 3.6 PATCH /trip/{id}/complete (rating + end time)
- [ ] 3.7 Basic auth with roles (student/driver/admin)
### GPS + real time
- [ ] 3.8 GPS simulator script: moves buses along a route, updates D2 every 3s
- [ ] 3.9 WebSocket endpoint broadcasting bus positions
### Student UI
- [ ] 3.10 React skeleton + routing + API helper
- [ ] 3.11 Live map with bus markers (Leaflet + OpenStreetMap)
- [ ] 3.12 Destination picker + call POST /trip/create
- [ ] 3.13 Advisor card + nearby buses list
- [ ] 3.14 Alerts strip
- [ ] 3.15 Trip history + rating form
### Driver UI
- [ ] 3.16 Show assigned route
- [ ] 3.17 Send GPS + status updates
- [ ] 3.18 Log passenger count
### Admin UI
- [ ] 3.19 CRUD routes and stops (writes D1)
- [ ] 3.20 Fleet overview (reads D2)

## Phase 4 – Pre-AI data
- [ ] 4.1 Add context columns to trips (time, weekday, delay, passengers)
- [ ] 4.2 Admin analytics queries (busiest routes, average delay)
- [ ] 4.3 Analytics page in admin UI
- [ ] 4.4 Script to generate extra synthetic trip data

## Phase 5 – AI (only after MVP is stable)
- [ ] 5.1 Export trip data to CSV for training
- [ ] 5.2 ETA prediction model (simple regression first)
- [ ] 5.3 Serve predictions from Go (keep rule-based logic as fallback)
- [ ] 5.4 Demand prediction (stretch)
