-- SCMTS seed data: 1 test student, 3 routes, 10 stops, 4 buses (+ their D2 rows)
-- Run after schema.sql: mysql -u <user> -p scmts < db/seed.sql

-- Safe to re-run: fixed ids, existing seed rows are updated in place.
-- Coordinates: a ~1 km campus box; shift lat/lng to match your own campus.

SET NAMES utf8mb4;

START TRANSACTION;

-- ---------- Users: test student (id 1) ----------
-- password_hash is a placeholder; replace it with a real hash in the auth task (3.7).

INSERT INTO users (id, name, email, password_hash, role) VALUES
    (1, 'Test Student', 'student@test.local', 'PLACEHOLDER_NOT_A_HASH', 'student')
ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), role = VALUES(role);

-- ---------- D1: stops ----------

INSERT INTO stops (id, name, lat, lng) VALUES
    (1,  'Main Gate',        10.040500, 76.321200),
    (2,  'Admin Block',      10.042100, 76.322600),
    (3,  'Central Library',  10.043600, 76.324100),
    (4,  'Engineering Block', 10.045000, 76.325300),
    (5,  'Science Block',    10.046200, 76.323700),
    (6,  'Food Court',       10.044300, 76.326700),
    (7,  'Boys Hostel',      10.047800, 76.328400),
    (8,  'Girls Hostel',     10.046600, 76.329600),
    (9,  'Sports Complex',   10.041800, 76.327900),
    (10, 'Staff Quarters',   10.040200, 76.329300)
ON DUPLICATE KEY UPDATE name = VALUES(name), lat = VALUES(lat), lng = VALUES(lng);

-- ---------- D1: routes ----------

INSERT INTO routes (id, name) VALUES
    (1, 'Route 1 - Main Gate to Academic'),
    (2, 'Route 2 - Hostels to Academic'),
    (3, 'Route 3 - Staff Quarters to Main Gate')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---------- D1: route_stops (stop_order starts at 1) ----------

INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES
    -- Route 1: Main Gate -> Admin -> Library -> Engineering -> Science
    (1, 1, 1), (1, 2, 2), (1, 3, 3), (1, 4, 4), (1, 5, 5),
    -- Route 2: Boys Hostel -> Girls Hostel -> Food Court -> Library -> Engineering
    (2, 7, 1), (2, 8, 2), (2, 6, 3), (2, 3, 4), (2, 4, 5),
    -- Route 3: Staff Quarters -> Sports Complex -> Food Court -> Admin -> Main Gate
    (3, 10, 1), (3, 9, 2), (3, 6, 3), (3, 2, 4), (3, 1, 5)
ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id);

-- ---------- D1: buses (no drivers assigned yet) ----------

INSERT INTO buses (id, plate, route_id, driver_id) VALUES
    (1, 'KL-07-CB-1101', 1, NULL),
    (2, 'KL-07-CB-1102', 1, NULL),
    (3, 'KL-07-CB-2201', 2, NULL),
    (4, 'KL-07-CB-3301', 3, NULL)
ON DUPLICATE KEY UPDATE plate = VALUES(plate), route_id = VALUES(route_id);

-- ---------- D2: starting live positions (drivers' GPS overwrites these) ----------

INSERT INTO bus_live (bus_id, lat, lng, speed, status) VALUES
    (1, 10.040500, 76.321200,  0.0, 'on_route'),       -- at Main Gate
    (2, 10.043600, 76.324100, 18.5, 'on_route'),       -- near Central Library
    (3, 10.047800, 76.328400,  0.0, 'delayed'),        -- at Boys Hostel
    (4, 10.040200, 76.329300,  0.0, 'out_of_service')  -- parked at Staff Quarters
ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng),
                        speed = VALUES(speed), status = VALUES(status);

COMMIT;
