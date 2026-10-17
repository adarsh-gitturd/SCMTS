-- SCMTS schema (MySQL 8.0.16+, needed for CHECK constraints)
-- Run: mysql -u <user> -p scmts < db/schema.sql

-- Safe to re-run: existing tables and data are kept.
-- Re-running never adds columns to an existing table: upgrade existing
-- databases with the files in db/migrations/ (each run once).

SET NAMES utf8mb4;

-- ---------- D1: routes & stops ----------

CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('student', 'driver', 'admin') NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS routes (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_routes_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stops (
    id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    lat  DECIMAL(9,6) NOT NULL,
    lng  DECIMAL(9,6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS route_stops (
    route_id   INT UNSIGNED NOT NULL,
    stop_id    INT UNSIGNED NOT NULL,
    stop_order SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (route_id, stop_order),
    UNIQUE KEY uq_route_stops_route_stop (route_id, stop_id),
    KEY idx_route_stops_stop (stop_id),
    CONSTRAINT fk_route_stops_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE,
    CONSTRAINT fk_route_stops_stop  FOREIGN KEY (stop_id)  REFERENCES stops (id)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS buses (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plate     VARCHAR(20) NOT NULL,
    route_id  INT UNSIGNED NULL,
    driver_id INT UNSIGNED NULL,
    UNIQUE KEY uq_buses_plate (plate),
    UNIQUE KEY uq_buses_driver (driver_id),
    KEY idx_buses_route (route_id),
    CONSTRAINT fk_buses_route  FOREIGN KEY (route_id)  REFERENCES routes (id) ON DELETE SET NULL,
    CONSTRAINT fk_buses_driver FOREIGN KEY (driver_id) REFERENCES users (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- D2: live bus data (one row per bus, overwritten) ----------

CREATE TABLE IF NOT EXISTS bus_live (
    bus_id     INT UNSIGNED PRIMARY KEY,
    lat        DECIMAL(9,6) NOT NULL,
    lng        DECIMAL(9,6) NOT NULL,
    speed      DECIMAL(5,1) NOT NULL DEFAULT 0, -- km/h
    status     ENUM('on_route', 'delayed', 'break', 'out_of_service') NOT NULL DEFAULT 'out_of_service',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_bus_live_status (status),
    CONSTRAINT fk_bus_live_bus FOREIGN KEY (bus_id) REFERENCES buses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- D3: trip history (append-only) ----------

CREATE TABLE IF NOT EXISTS trips (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id    INT UNSIGNED NOT NULL,
    origin_lat    DECIMAL(9,6) NOT NULL,
    origin_lng    DECIMAL(9,6) NOT NULL,
    dest_stop_id  INT UNSIGNED NOT NULL,
    bus_id        INT UNSIGNED NULL,
    route_id      INT UNSIGNED NULL,
    board_stop_id INT UNSIGNED NULL,
    status        ENUM('started', 'completed') NOT NULL DEFAULT 'started',
    rating        TINYINT UNSIGNED NULL,
    feedback      VARCHAR(500) NULL,
    started_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at      TIMESTAMP NULL,
    start_hour          TINYINT UNSIGNED NULL,  -- 0..23, campus local time
    start_weekday       TINYINT UNSIGNED NULL,  -- ISO: 1=Mon .. 7=Sun
    predicted_eta_min   SMALLINT UNSIGNED NULL, -- eta_minutes of the top recommendation
    bus_status_at_start ENUM('on_route', 'delayed', 'break', 'out_of_service') NULL,
    passengers_logged   SMALLINT UNSIGNED NULL, -- latest passenger_logs count, last 30 min
    CONSTRAINT chk_trips_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT chk_trips_start_hour    CHECK (start_hour IS NULL OR start_hour BETWEEN 0 AND 23),
    CONSTRAINT chk_trips_start_weekday CHECK (start_weekday IS NULL OR start_weekday BETWEEN 1 AND 7),
    KEY idx_trips_student_started (student_id, started_at),
    KEY idx_trips_route_started (route_id, started_at),
    KEY idx_trips_started (started_at),
    CONSTRAINT fk_trips_student    FOREIGN KEY (student_id)    REFERENCES users (id)  ON DELETE RESTRICT,
    CONSTRAINT fk_trips_dest_stop  FOREIGN KEY (dest_stop_id)  REFERENCES stops (id)  ON DELETE RESTRICT,
    CONSTRAINT fk_trips_bus        FOREIGN KEY (bus_id)        REFERENCES buses (id)  ON DELETE SET NULL,
    CONSTRAINT fk_trips_route      FOREIGN KEY (route_id)      REFERENCES routes (id) ON DELETE SET NULL,
    CONSTRAINT fk_trips_board_stop FOREIGN KEY (board_stop_id) REFERENCES stops (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS passenger_logs (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bus_id    INT UNSIGNED NULL,
    stop_id   INT UNSIGNED NOT NULL,
    driver_id INT UNSIGNED NULL,
    count     SMALLINT UNSIGNED NOT NULL,
    logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_passenger_logs_bus_logged (bus_id, logged_at),
    KEY idx_passenger_logs_logged (logged_at),
    CONSTRAINT fk_passenger_logs_bus    FOREIGN KEY (bus_id)    REFERENCES buses (id) ON DELETE SET NULL,
    CONSTRAINT fk_passenger_logs_stop   FOREIGN KEY (stop_id)   REFERENCES stops (id) ON DELETE RESTRICT,
    CONSTRAINT fk_passenger_logs_driver FOREIGN KEY (driver_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Student extras ----------

CREATE TABLE IF NOT EXISTS saved_places (
    id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    name    VARCHAR(100) NOT NULL,
    stop_id INT UNSIGNED NOT NULL,
    UNIQUE KEY uq_saved_places_user_name (user_id, name),
    CONSTRAINT fk_saved_places_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_saved_places_stop FOREIGN KEY (stop_id) REFERENCES stops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS alerts (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type       ENUM('delay', 'arrival') NOT NULL,
    bus_id     INT UNSIGNED NOT NULL,
    message    VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_alerts_created (created_at),
    KEY idx_alerts_bus (bus_id),
    CONSTRAINT fk_alerts_bus FOREIGN KEY (bus_id) REFERENCES buses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
