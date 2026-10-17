package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-sql-driver/mysql"

	"scmts/backend/auth"
)

// passengersMinGap is the shortest allowed time between two passenger logs
// from one driver; it stops a double-click from writing two rows.
const passengersMinGap = time.Second

// mysqlErrNoReferencedRow is MySQL error 1452: a foreign key check failed.
const mysqlErrNoReferencedRow = 1452

type driverPassengersRequest struct {
	Count  *int64 `json:"count"`
	StopID *int64 `json:"stop_id"`
}

type driverPassengersResponse struct {
	ID int64 `json:"id"`
}

// parsePassengers decodes and checks a passenger log body. msg is empty when
// valid. Decoding into int64 rejects 18.5, 18.0, 1e2 and "18".
func parsePassengers(body io.Reader) (count, stopID int64, msg string) {
	var req driverPassengersRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			switch typeErr.Field {
			case "count":
				return 0, 0, "count must be an integer between 0 and 200"
			case "stop_id":
				return 0, 0, "stop_id must be a positive integer"
			}
		}
		return 0, 0, "invalid JSON body"
	}
	if req.Count == nil || req.StopID == nil {
		return 0, 0, "count and stop_id are required"
	}
	count, stopID = *req.Count, *req.StopID
	switch {
	case count < 0 || count > 200:
		return 0, 0, "count must be an integer between 0 and 200"
	case stopID <= 0:
		return 0, 0, "stop_id must be a positive integer"
	}
	return count, stopID, ""
}

// DriverPassengers logs a passenger count for the logged-in driver's bus at a
// stop on that bus's route (D3, insert only). The bus and the route check are
// part of the write (INSERT ... SELECT); when nothing is inserted, a second
// query finds out why.
// POST /api/driver/passengers
func DriverPassengers(db *sql.DB) http.HandlerFunc {
	limiter := newRateLimiter(passengersMinGap, time.Now)
	return func(w http.ResponseWriter, r *http.Request) {
		driverID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		// Unknown fields are ignored; the server sets logged_at.
		r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
		count, stopID, msg := parsePassengers(r.Body)
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

		// At most one row: buses.driver_id and route_stops (route_id, stop_id) are unique.
		res, err := db.ExecContext(ctx, `
			INSERT INTO passenger_logs (bus_id, stop_id, driver_id, count, logged_at)
			SELECT b.id, rs.stop_id, b.driver_id, ?, CURRENT_TIMESTAMP
			  FROM buses b
			  JOIN route_stops rs ON rs.route_id = b.route_id AND rs.stop_id = ?
			 WHERE b.driver_id = ?`,
			count, stopID, driverID)
		var myErr *mysql.MySQLError
		if errors.As(err, &myErr) && myErr.Number == mysqlErrNoReferencedRow {
			// The stop (or bus) went away mid-insert: report why, not a 500.
			passengersRejected(ctx, db, w, driverID, stopID)
			return
		}
		if err != nil {
			log.Printf("driver passengers: insert: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Printf("driver passengers: rows affected: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if n == 0 {
			passengersRejected(ctx, db, w, driverID, stopID)
			return
		}
		id, err := res.LastInsertId()
		if err != nil {
			log.Printf("driver passengers: last insert id: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusCreated, driverPassengersResponse{ID: id})
	}
}

// passengersRejected writes the reason a passenger log was not inserted.
// Checked in order: bus, route, stop exists, stop on route.
func passengersRejected(ctx context.Context, db *sql.DB, w http.ResponseWriter, driverID, stopID int64) {
	var hasRoute, stopExists, onRoute bool
	err := db.QueryRowContext(ctx, `
		SELECT b.route_id IS NOT NULL,
		       EXISTS (SELECT 1 FROM stops WHERE id = ?),
		       EXISTS (SELECT 1 FROM route_stops WHERE route_id = b.route_id AND stop_id = ?)
		  FROM buses b
		 WHERE b.driver_id = ?`, stopID, stopID, driverID).Scan(&hasRoute, &stopExists, &onRoute)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeError(w, http.StatusNotFound, "no bus assigned")
	case err != nil:
		log.Printf("driver passengers: reason lookup: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	case !hasRoute:
		writeError(w, http.StatusConflict, "no route assigned")
	case !stopExists:
		writeError(w, http.StatusNotFound, "stop not found")
	case !onRoute:
		writeError(w, http.StatusBadRequest, "stop is not on your route")
	default:
		// Bus, route or stops changed between the two queries; the client can retry.
		log.Printf("driver passengers: insert skipped but all checks pass (driver %d, stop %d)", driverID, stopID)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
