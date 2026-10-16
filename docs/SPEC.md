# SCMTS Spec – Smart Campus Mobility Transportation System

## Purpose
Help campus students pick the best bus for a trip using live bus positions, destination
and (later) traffic. Drivers feed live data; admins manage routes and review analytics.
Rule-based logic first; AI refines predictions in Phase 5 and never replaces the fallback.

## Roles
- Student: sets destination, sees buses, gets recommendation, alerts, rates trips
- Driver: sees assigned route, broadcasts GPS, reports status, logs passengers
- Admin: manages routes/stops/buses, views fleet and analytics

## External entities
- GPS sensor / driver phone (location source)
- Map/traffic API (third party, later phase; start with Leaflet + OpenStreetMap)

## Data stores
| Store | Content | Behavior |
|---|---|---|
| D1 routes & stops | routes, stops, route-stop order, buses | Static. Admin writes; student/driver read |
| D2 live bus data | lat, lng, speed, status, updated_at per bus | Overwritten every few seconds by driver; student/admin read |
| D3 trip history | trips, ratings, passenger counts | Append-only. Student and driver write; admin (and later AI) read |

## Features

### Student (MVP)
- Live map with buses and stops
- Destination picker with saved places
- Advisor card: recommended bus + ETA
- Nearby buses list
- Alerts strip (delay, arrival)
- Trip history with rating/feedback

### Driver
- Show assigned route at shift start
- Broadcast GPS continuously (retry if offline)
- Report status: on_route, delayed, break, out_of_service
- Log passenger count

### Admin
- CRUD routes, stops, buses (writes D1)
- Fleet overview (reads D2)
- Analytics from trip history (reads D3)
(Admin DFD not finished; processes above are the working assumption.)

## DFD summary

### Level 0
One process (smart campus transport system) with entities: Student, Driver app,
Map/traffic API, Admin.

### Student Level 1
1.0 Set trip | 2.0 Track buses (reads D2, runs continuously) | 3.0 AI advisor
4.0 Show map (D1 + D2) | 5.0 Send alerts (reads D2) | 6.0 Log trips (D3)
- 3.0 Level 2: 3.1 find candidates, 3.2 calculate ETA, 3.3 rank buses, 3.4 package result
- 6.0 fires twice: trip start (INSERT) and trip end (UPDATE with rating)

### Driver Level 1
1.0 Broadcast GPS (writes D2) | 2.0 Report status (writes D2)
3.0 Show route (reads D1) | 4.0 Log passengers (writes D3)
- 1.0 Level 2: 1.1 read GPS fix, 1.2 filter readings, 1.3 build update, 1.4 send + save

Key idea: drivers mostly WRITE to stores, students mostly READ. Student "track buses" and
driver "broadcast GPS" connect only through D2.

## Trip request flow
1. Student picks destination; React validates
2. POST /trip/create (HTTPS)
3. Go validates input and checks the destination stop exists (one DB transaction for 3-5)
4. Go reads D2 (live buses) and D1 (routes)
5. Advisor logic ranks candidates (lowest ETA first in MVP), then INSERTs the trip into D3
   with the top pick (NULL if none)
6. JSON response; React renders map, advisor card, bus list
7. WebSocket keeps bus positions fresh in the background
8. On completion: PATCH /trip/{id}/complete stores rating in D3

## Recommendation logic (MVP, rule-based)
1. Candidates: buses whose route passes near the student's origin and the destination
2. ETA: straight-line distance / average speed (Phase 5 replaces with learned ETA)
3. Rank: lowest ETA first; skip buses with status out_of_service or break (delayed stays eligible)
4. Return top 3

## Tech stack
React (frontend) | Go + chi + database/sql (backend) | MySQL | REST + WebSocket

## Phases
1 Assessment | 2 Design | 3 MVP (backend, DB, UIs, GPS simulator, live map, tracking)
4 Pre-AI data collection and analytics | 5 AI (ETA, demand, recommendations)
See docs/TASKS.md.

## Non-functional
- Position updates visible within ~3-5 seconds
- Driver app retries sends when offline
- HTTPS everywhere, parameterized SQL, role-based access
- Mobile-friendly UI, especially for drivers

## Out of scope (future)
Digital twin simulation, RFID/NFC boarding, payments, multi-campus support.
IoT note: the GPS source is the IoT layer; stop beacons and tap readers are extensions.
