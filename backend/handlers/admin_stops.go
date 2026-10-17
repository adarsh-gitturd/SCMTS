package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-sql-driver/mysql"
)

// mysqlErrRowIsReferenced is MySQL error 1451: a row is still used by a
// foreign key with ON DELETE RESTRICT.
const mysqlErrRowIsReferenced = 1451

// stopNameMax matches stops.name VARCHAR(100) (utf8mb4 counts characters).
const stopNameMax = 100

type adminStopRequest struct {
	Name *string  `json:"name"`
	Lat  *float64 `json:"lat"`
	Lng  *float64 `json:"lng"`
}

type adminStopCreated struct {
	ID int64 `json:"id"`
}

// stopInput is a validated stop body: name trimmed, lat/lng rounded to 6 decimals.
type stopInput struct {
	Name string
	Lat  float64
	Lng  float64
}

// parseStopID parses a {id} path value. ok is false unless it is an integer
// between 1 and the INT UNSIGNED maximum.
func parseStopID(raw string) (id int64, ok bool) {
	n, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || n == 0 {
		return 0, false
	}
	return int64(n), true
}

// parseStopBody decodes and checks a stop body. msg is empty when valid.
func parseStopBody(body io.Reader) (stopInput, string) {
	var req adminStopRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return stopInput{}, "invalid JSON body"
	}
	return validateStop(req)
}

// validateStop checks a decoded stop body. msg is empty when valid. Bounds
// are checked on the raw values, then lat/lng are rounded to fit DECIMAL(9,6).
func validateStop(req adminStopRequest) (stopInput, string) {
	if req.Name == nil || req.Lat == nil || req.Lng == nil {
		return stopInput{}, "name, lat and lng are required"
	}
	name := strings.TrimSpace(*req.Name)
	lat, lng := *req.Lat, *req.Lng
	switch {
	case name == "" || utf8.RuneCountInString(name) > stopNameMax:
		return stopInput{}, "name must be 1 to 100 characters"
	case strings.IndexFunc(name, unicode.IsControl) >= 0:
		return stopInput{}, "name must not contain control characters"
	case !finite(lat) || lat < -90 || lat > 90:
		return stopInput{}, "lat must be between -90 and 90"
	case !finite(lng) || lng < -180 || lng > 180:
		return stopInput{}, "lng must be between -180 and 180"
	}
	return stopInput{Name: name, Lat: round6(lat), Lng: round6(lng)}, ""
}

func round6(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}

// AdminCreateStop adds a stop to D1.
// POST /api/admin/stops
func AdminCreateStop(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
		in, msg := parseStopBody(r.Body)
		if msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		res, err := db.ExecContext(ctx,
			`INSERT INTO stops (name, lat, lng) VALUES (?, ?, ?)`, in.Name, in.Lat, in.Lng)
		if err != nil {
			log.Printf("admin create stop: insert: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		id, err := res.LastInsertId()
		if err != nil {
			log.Printf("admin create stop: last insert id: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusCreated, adminStopCreated{ID: id})
	}
}

// AdminUpdateStop replaces a stop's name, lat and lng in D1 and returns the
// row as stored. MySQL reports 0 affected rows when nothing changed, so
// existence comes from a SELECT in the same transaction; the UPDATE holds the
// row lock, so the SELECT sees exactly this request's write.
// PUT /api/admin/stops/{id}
func AdminUpdateStop(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseStopID(chi.URLParam(r, "id"))
		if !ok {
			writeError(w, http.StatusBadRequest, "id must be a positive integer")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
		in, msg := parseStopBody(r.Body)
		if msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("admin update stop: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		if _, err := tx.ExecContext(ctx,
			`UPDATE stops SET name = ?, lat = ?, lng = ? WHERE id = ?`,
			in.Name, in.Lat, in.Lng, id); err != nil {
			log.Printf("admin update stop: update: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		var s stop
		err = tx.QueryRowContext(ctx,
			`SELECT id, name, lat, lng FROM stops WHERE id = ?`, id).Scan(&s.ID, &s.Name, &s.Lat, &s.Lng)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "stop not found")
			return
		}
		if err != nil {
			log.Printf("admin update stop: select: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if err := tx.Commit(); err != nil {
			log.Printf("admin update stop: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, s)
	}
}

// AdminDeleteStop deletes a stop from D1. A stop used by route_stops,
// trips.dest_stop_id or passenger_logs is refused (409). On success MySQL
// also deletes saved_places for the stop (CASCADE) and sets
// trips.board_stop_id to NULL (SET NULL).
// DELETE /api/admin/stops/{id}
func AdminDeleteStop(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseStopID(chi.URLParam(r, "id"))
		if !ok {
			writeError(w, http.StatusBadRequest, "id must be a positive integer")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		res, err := db.ExecContext(ctx, `DELETE FROM stops WHERE id = ?`, id)
		var myErr *mysql.MySQLError
		if errors.As(err, &myErr) && myErr.Number == mysqlErrRowIsReferenced {
			writeError(w, http.StatusConflict, "stop is in use")
			return
		}
		if err != nil {
			log.Printf("admin delete stop: delete: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Printf("admin delete stop: rows affected: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if n == 0 {
			writeError(w, http.StatusNotFound, "stop not found")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
