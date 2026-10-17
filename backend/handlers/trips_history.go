package handlers

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"scmts/backend/auth"
)

const (
	tripsLimitDefault = 50
	tripsLimitMax     = 100
)

type trip struct {
	ID                int64      `json:"id"`
	Status            string     `json:"status"`
	Destination       string     `json:"destination"`
	DestinationStopID int64      `json:"destination_stop_id"`
	RouteID           *int64     `json:"route_id"`
	BusID             *int64     `json:"bus_id"`
	BoardStopID       *int64     `json:"board_stop_id"`
	Rating            *int64     `json:"rating"`
	Feedback          *string    `json:"feedback"`
	StartedAt         time.Time  `json:"started_at"`
	EndedAt           *time.Time `json:"ended_at"`
}

// parseTripsLimit reads the ?limit= value: empty means the default,
// otherwise it must be an integer between 1 and tripsLimitMax.
func parseTripsLimit(raw string) (int, error) {
	if raw == "" {
		return tripsLimitDefault, nil
	}
	n, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || n < 1 || n > tripsLimitMax {
		return 0, errors.New("limit must be an integer between 1 and 100")
	}
	return int(n), nil
}

// ListTrips returns the logged-in student's trip history (D3), newest first.
// GET /api/trips?limit=50
func ListTrips(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studentID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		limit, err := parseTripsLimit(r.URL.Query().Get("limit"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, `
			SELECT t.id, t.status, s.name, t.dest_stop_id, t.route_id, t.bus_id,
			       t.board_stop_id, t.rating, t.feedback, t.started_at, t.ended_at
			FROM trips t
			JOIN stops s ON s.id = t.dest_stop_id
			WHERE t.student_id = ?
			ORDER BY t.started_at DESC, t.id DESC
			LIMIT ?`,
			studentID, limit)
		if err != nil {
			log.Printf("trips history: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		trips := []trip{}
		for rows.Next() {
			var (
				t                           trip
				routeID, busID, boardStopID sql.NullInt64
				rating                      sql.NullInt64
				feedback                    sql.NullString
				endedAt                     sql.NullTime
			)
			// Session time zone is UTC (db.go), so timestamps scan as UTC.
			if err := rows.Scan(&t.ID, &t.Status, &t.Destination, &t.DestinationStopID,
				&routeID, &busID, &boardStopID, &rating, &feedback, &t.StartedAt, &endedAt); err != nil {
				log.Printf("trips history: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			t.RouteID = nullInt64Ptr(routeID)
			t.BusID = nullInt64Ptr(busID)
			t.BoardStopID = nullInt64Ptr(boardStopID)
			t.Rating = nullInt64Ptr(rating)
			if feedback.Valid {
				t.Feedback = &feedback.String
			}
			if endedAt.Valid {
				t.EndedAt = &endedAt.Time
			}
			trips = append(trips, t)
		}
		if err := rows.Err(); err != nil {
			log.Printf("trips history: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, trips)
	}
}

// nullInt64Ptr turns a NULL column into nil so it encodes as JSON null.
func nullInt64Ptr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}
