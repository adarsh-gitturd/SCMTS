package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-sql-driver/mysql"
)

// mysqlErrDupEntry is MySQL error 1062: a unique key already has this value.
const mysqlErrDupEntry = 1062

const (
	// routeNameMax matches routes.name VARCHAR(100) (utf8mb4 counts characters).
	routeNameMax = 100
	// routeStopsMax is the most stops one route may have.
	routeStopsMax = 50
)

type adminRouteRequest struct {
	Name  *string `json:"name"`
	Stops []int64 `json:"stops"` // nil when missing or null; [] is a non-nil empty slice
}

type adminRouteCreated struct {
	ID int64 `json:"id"`
}

// routeInput is a validated route body: name trimmed, stop ids in route order.
type routeInput struct {
	Name  string
	Stops []int64
}

// parseRouteBody decodes and checks a route body. msg is empty when valid.
func parseRouteBody(body io.Reader) (routeInput, string) {
	var req adminRouteRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return routeInput{}, "invalid JSON body"
	}
	return validateRoute(req)
}

// validateRoute checks a decoded route body. msg is empty when valid.
func validateRoute(req adminRouteRequest) (routeInput, string) {
	if req.Name == nil || req.Stops == nil {
		return routeInput{}, "name and stops are required"
	}
	name := strings.TrimSpace(*req.Name)
	switch {
	case name == "" || utf8.RuneCountInString(name) > routeNameMax:
		return routeInput{}, "name must be 1 to 100 characters"
	case strings.IndexFunc(name, unicode.IsControl) >= 0:
		return routeInput{}, "name must not contain control characters"
	case len(req.Stops) > routeStopsMax:
		return routeInput{}, "at most 50 stops"
	}
	seen := make(map[int64]bool, len(req.Stops))
	for _, id := range req.Stops {
		if id < 1 || id > math.MaxUint32 {
			return routeInput{}, "stop ids must be positive integers"
		}
		if seen[id] {
			return routeInput{}, fmt.Sprintf("duplicate stop id %d", id)
		}
		seen[id] = true
	}
	return routeInput{Name: name, Stops: req.Stops}, ""
}

// buildRouteStopsInsert builds one multi-row INSERT for a route's stops;
// stop_order is the 1-based position in stops. The SQL holds only
// placeholders. Returns "" and nil args for an empty list.
func buildRouteStopsInsert(routeID int64, stops []int64) (string, []any) {
	if len(stops) == 0 {
		return "", nil
	}
	var sb strings.Builder
	sb.WriteString("INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES ")
	args := make([]any, 0, 3*len(stops))
	for i, stopID := range stops {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(?, ?, ?)")
		args = append(args, routeID, stopID, i+1)
	}
	return sb.String(), args
}

// isMySQLErr reports whether err is the MySQL error with the given number.
func isMySQLErr(err error, number uint16) bool {
	var myErr *mysql.MySQLError
	return errors.As(err, &myErr) && myErr.Number == number
}

// insertRouteStops writes a route's stops in tx. unknownStop is true when a
// stop id does not exist (MySQL 1452); err is then nil.
func insertRouteStops(ctx context.Context, tx *sql.Tx, routeID int64, stops []int64) (unknownStop bool, err error) {
	query, args := buildRouteStopsInsert(routeID, stops)
	if query == "" {
		return false, nil
	}
	_, err = tx.ExecContext(ctx, query, args...)
	if isMySQLErr(err, mysqlErrNoReferencedRow) {
		return true, nil
	}
	return false, err
}

// AdminCreateRoute adds a route and its ordered stops to D1 in one transaction.
// POST /api/admin/routes
func AdminCreateRoute(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
		in, msg := parseRouteBody(r.Body)
		if msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("admin create route: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		res, err := tx.ExecContext(ctx, `INSERT INTO routes (name) VALUES (?)`, in.Name)
		if isMySQLErr(err, mysqlErrDupEntry) {
			writeError(w, http.StatusConflict, "route name already exists")
			return
		}
		if err != nil {
			log.Printf("admin create route: insert route: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		id, err := res.LastInsertId()
		if err != nil {
			log.Printf("admin create route: last insert id: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		unknown, err := insertRouteStops(ctx, tx, id, in.Stops)
		if err != nil {
			log.Printf("admin create route: insert stops: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if unknown {
			writeError(w, http.StatusBadRequest, "unknown stop id")
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("admin create route: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusCreated, adminRouteCreated{ID: id})
	}
}

// AdminUpdateRoute replaces a route's name and stop list in one transaction
// and returns the route as stored. The route row is locked first, so
// concurrent writes to the same route run one after the other; any failure
// rolls back and leaves the route unchanged.
// PUT /api/admin/routes/{id}
func AdminUpdateRoute(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseStopID(chi.URLParam(r, "id"))
		if !ok {
			writeError(w, http.StatusBadRequest, "id must be a positive integer")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
		in, msg := parseRouteBody(r.Body)
		if msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("admin update route: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		var locked int64
		err = tx.QueryRowContext(ctx, `SELECT id FROM routes WHERE id = ? FOR UPDATE`, id).Scan(&locked)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
			return
		}
		if err != nil {
			log.Printf("admin update route: lock: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		// RowsAffected is 0 when the name is unchanged, so it is not used.
		_, err = tx.ExecContext(ctx, `UPDATE routes SET name = ? WHERE id = ?`, in.Name, id)
		if isMySQLErr(err, mysqlErrDupEntry) {
			writeError(w, http.StatusConflict, "route name already exists")
			return
		}
		if err != nil {
			log.Printf("admin update route: update name: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM route_stops WHERE route_id = ?`, id); err != nil {
			log.Printf("admin update route: delete stops: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		unknown, err := insertRouteStops(ctx, tx, id, in.Stops)
		if err != nil {
			log.Printf("admin update route: insert stops: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if unknown {
			writeError(w, http.StatusBadRequest, "unknown stop id")
			return
		}

		rt, err := loadRouteTx(ctx, tx, id)
		if err != nil {
			log.Printf("admin update route: select: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("admin update route: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, rt)
	}
}

// loadRouteTx reads one route with its stops in order (same shape as GET /api/routes).
func loadRouteTx(ctx context.Context, tx *sql.Tx, id int64) (route, error) {
	rt := route{ID: int(id), Stops: []routeStop{}}
	if err := tx.QueryRowContext(ctx, `SELECT name FROM routes WHERE id = ?`, id).Scan(&rt.Name); err != nil {
		return route{}, err
	}

	rows, err := tx.QueryContext(ctx,
		`SELECT stop_id, stop_order FROM route_stops WHERE route_id = ? ORDER BY stop_order`, id)
	if err != nil {
		return route{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var s routeStop
		if err := rows.Scan(&s.StopID, &s.Order); err != nil {
			return route{}, err
		}
		rt.Stops = append(rt.Stops, s)
	}
	if err := rows.Err(); err != nil {
		return route{}, err
	}
	return rt, nil
}

// AdminDeleteRoute deletes a route from D1. A route with buses assigned is
// refused (409). The route row is locked before the bus check: assigning a
// bus to the route takes a shared lock on that row (foreign key check), so a
// concurrent assignment either commits first and is seen by the check, or
// waits and then fails because the route is gone. On success MySQL deletes
// the route's route_stops (CASCADE) and sets trips.route_id to NULL (SET NULL).
// DELETE /api/admin/routes/{id}
func AdminDeleteRoute(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseStopID(chi.URLParam(r, "id"))
		if !ok {
			writeError(w, http.StatusBadRequest, "id must be a positive integer")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("admin delete route: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		var locked int64
		err = tx.QueryRowContext(ctx, `SELECT id FROM routes WHERE id = ? FOR UPDATE`, id).Scan(&locked)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
			return
		}
		if err != nil {
			log.Printf("admin delete route: lock: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		// A locking read sees the latest committed buses, not the snapshot.
		var busID int64
		err = tx.QueryRowContext(ctx,
			`SELECT id FROM buses WHERE route_id = ? LIMIT 1 FOR SHARE`, id).Scan(&busID)
		if err == nil {
			writeError(w, http.StatusConflict, "route has buses assigned")
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("admin delete route: bus check: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM routes WHERE id = ?`, id); err != nil {
			log.Printf("admin delete route: delete: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("admin delete route: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
