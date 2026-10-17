-- Task 4.1: context columns on trips (D3). MySQL 8.0.16+ (CHECK constraints).
-- Run: mysql -u <user> -p scmts < db/migrations/001_trips_context.sql
--
-- RUN ONCE. MySQL has no ADD COLUMN IF NOT EXISTS; a second run fails with
--   ERROR 1060 (42S21): Duplicate column name 'start_hour'
-- and changes nothing (it is a single ALTER statement, all-or-nothing).
--
-- DDL cannot be rolled back inside a transaction: the safety net is the
-- backup taken before running this (mysqldump). Stop the backend and gpssim
-- first: adding CHECK constraints rebuilds the table (ALGORITHM=COPY).
--
-- No backfill: existing rows keep NULL in every new column.
-- Existing columns, indexes and constraints are not changed.
-- Keep the ENUM in sync with bus_live.status.

ALTER TABLE trips
    ADD COLUMN start_hour          TINYINT UNSIGNED NULL AFTER ended_at,
    ADD COLUMN start_weekday       TINYINT UNSIGNED NULL AFTER start_hour,
    ADD COLUMN predicted_eta_min   SMALLINT UNSIGNED NULL AFTER start_weekday,
    ADD COLUMN bus_status_at_start ENUM('on_route', 'delayed', 'break', 'out_of_service') NULL AFTER predicted_eta_min,
    ADD COLUMN passengers_logged   SMALLINT UNSIGNED NULL AFTER bus_status_at_start,
    ADD CONSTRAINT chk_trips_start_hour    CHECK (start_hour IS NULL OR start_hour BETWEEN 0 AND 23),
    ADD CONSTRAINT chk_trips_start_weekday CHECK (start_weekday IS NULL OR start_weekday BETWEEN 1 AND 7);

-- ROLLBACK (run manually, in this order, only if needed; the CHECKs must go
-- first because MySQL will not drop a column a CHECK still references):
-- ALTER TABLE trips DROP CHECK chk_trips_start_hour, DROP CHECK chk_trips_start_weekday;
-- ALTER TABLE trips DROP COLUMN passengers_logged, DROP COLUMN bus_status_at_start,
--     DROP COLUMN predicted_eta_min, DROP COLUMN start_weekday, DROP COLUMN start_hour;
