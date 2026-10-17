package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"sync"
	"time"

	"scmts/backend/auth"
)

// locationMinGap is the shortest allowed time between two location writes
// from one driver. Normal clients send every ~3s.
const locationMinGap = 500 * time.Millisecond

type driverLocationRequest struct {
	Lat   *float64 `json:"lat"`
	Lng   *float64 `json:"lng"`
	Speed *float64 `json:"speed"` // km/h
}

type driverStatusRequest struct {
	Status *string `json:"status"`
}

type driverStatusResponse struct {
	BusID  int64  `json:"bus_id"`
	Status string `json:"status"`
}

// parseLocation checks a decoded location request. msg is empty when valid.
func parseLocation(req driverLocationRequest) (lat, lng, speed float64, msg string) {
	if req.Lat == nil || req.Lng == nil || req.Speed == nil {
		return 0, 0, 0, "lat, lng and speed are required"
	}
	lat, lng, speed = *req.Lat, *req.Lng, *req.Speed
	switch {
	case !finite(lat) || lat < -90 || lat > 90:
		return 0, 0, 0, "lat must be between -90 and 90"
	case !finite(lng) || lng < -180 || lng > 180:
		return 0, 0, 0, "lng must be between -180 and 180"
	case !finite(speed) || speed < 0 || speed > 200:
		return 0, 0, 0, "speed must be between 0 and 200"
	}
	return lat, lng, speed, ""
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// validStatus reports whether s is one of the bus_live.status values.
func validStatus(s string) bool {
	switch s {
	case "on_route", "delayed", "break", "out_of_service":
		return true
	}
	return false
}

// rateLimiter allows one event per key every gap. In memory, one process only.
// Rejected attempts do not reset the timer.
type rateLimiter struct {
	mu   sync.Mutex
	gap  time.Duration
	now  func() time.Time
	last map[int64]time.Time
}

func newRateLimiter(gap time.Duration, now func() time.Time) *rateLimiter {
	return &rateLimiter{gap: gap, now: now, last: make(map[int64]time.Time)}
}

func (l *rateLimiter) allow(key int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	t := l.now()
	if prev, ok := l.last[key]; ok && t.Sub(prev) < l.gap {
		return false
	}
	l.last[key] = t
	return true
}

// DriverLocation writes the logged-in driver's bus position to D2. The bus is
// looked up inside the write (INSERT ... SELECT), so a driver can only write
// the bus assigned to them at that moment. A new row starts out_of_service;
// an existing row keeps its status.
// POST /api/driver/location
func DriverLocation(db *sql.DB) http.HandlerFunc {
	limiter := newRateLimiter(locationMinGap, time.Now)
	return func(w http.ResponseWriter, r *http.Request) {
		driverID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		// Unknown fields (e.g. a client "timestamp") are ignored; the server sets updated_at.
		r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
		var req driverLocationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		lat, lng, speed, msg := parseLocation(req)
		if msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		if !limiter.allow(driverID) {
			writeError(w, http.StatusTooManyRequests, "too many updates")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		// updated_at is set explicitly: ON UPDATE only fires when a value changes.
		res, err := db.ExecContext(ctx, `
			INSERT INTO bus_live (bus_id, lat, lng, speed, status, updated_at)
			SELECT id, ?, ?, ?, 'out_of_service', CURRENT_TIMESTAMP
			  FROM buses WHERE driver_id = ?
			ON DUPLICATE KEY UPDATE lat = ?, lng = ?, speed = ?, updated_at = CURRENT_TIMESTAMP`,
			lat, lng, speed, driverID, lat, lng, speed)
		if err != nil {
			log.Printf("driver location: upsert: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Printf("driver location: rows affected: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if n > 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// 0 rows: either no bus, or a same-second write with identical values.
		var one int
		err = db.QueryRowContext(ctx, `SELECT 1 FROM buses WHERE driver_id = ?`, driverID).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no bus assigned")
			return
		}
		if err != nil {
			log.Printf("driver location: bus lookup: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// DriverStatus sets the status of the logged-in driver's bus in D2 and bumps
// updated_at. The bus needs a bus_live row first (lat/lng are NOT NULL).
// PATCH /api/driver/status
func DriverStatus(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driverID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
		var req driverStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.Status == nil || !validStatus(*req.Status) {
			writeError(w, http.StatusBadRequest, "status must be one of on_route, delayed, break, out_of_service")
			return
		}
		status := *req.Status

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("driver status: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		// FOR UPDATE locks the bus (no reassignment until commit) and its live row.
		var (
			busID   int64
			hasLive bool
		)
		err = tx.QueryRowContext(ctx, `
			SELECT b.id, l.bus_id IS NOT NULL
			  FROM buses b
			  LEFT JOIN bus_live l ON l.bus_id = b.id
			 WHERE b.driver_id = ?
			   FOR UPDATE`, driverID).Scan(&busID, &hasLive)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no bus assigned")
			return
		}
		if err != nil {
			log.Printf("driver status: bus lookup: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if !hasLive {
			writeError(w, http.StatusConflict, "send a location first")
			return
		}

		if _, err := tx.ExecContext(ctx,
			`UPDATE bus_live SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE bus_id = ?`,
			status, busID); err != nil {
			log.Printf("driver status: update: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if err := tx.Commit(); err != nil {
			log.Printf("driver status: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, driverStatusResponse{BusID: busID, Status: status})
	}
}
