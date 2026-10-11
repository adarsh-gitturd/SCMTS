package handlers

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"time"
)

type bus struct {
	ID        int       `json:"id"`
	RouteID   *int      `json:"route_id"`
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Speed     float64   `json:"speed"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ListBuses returns buses with their live position (D2), optionally filtered by route.
// Buses without a bus_live row yet are left out (no position to show).
// GET /api/buses?route_id=1
func ListBuses(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := `
			SELECT b.id, b.route_id, l.lat, l.lng, l.speed, l.status, l.updated_at
			FROM buses b
			JOIN bus_live l ON l.bus_id = b.id`
		var args []any

		if v := r.URL.Query().Get("route_id"); v != "" {
			routeID, err := strconv.ParseUint(v, 10, 32)
			if err != nil || routeID == 0 {
				writeError(w, http.StatusBadRequest, "route_id must be a positive integer")
				return
			}
			query += ` WHERE b.route_id = ?`
			args = append(args, routeID)
		}
		query += ` ORDER BY b.id`

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, query, args...)
		if err != nil {
			log.Printf("buses: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		buses := []bus{}
		for rows.Next() {
			var (
				b       bus
				routeID sql.NullInt64
			)
			// Session time zone is UTC (db.go), so updated_at scans as UTC.
			if err := rows.Scan(&b.ID, &routeID, &b.Lat, &b.Lng, &b.Speed, &b.Status, &b.UpdatedAt); err != nil {
				log.Printf("buses: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if routeID.Valid {
				id := int(routeID.Int64)
				b.RouteID = &id
			}
			buses = append(buses, b)
		}
		if err := rows.Err(); err != nil {
			log.Printf("buses: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, buses)
	}
}
