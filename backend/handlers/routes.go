package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type routeStop struct {
	StopID int `json:"stop_id"`
	Order  int `json:"order"`
}

type route struct {
	ID    int         `json:"id"`
	Name  string      `json:"name"`
	Stops []routeStop `json:"stops"`
}

type stop struct {
	ID   int     `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

// ListRoutes returns all routes with their stops in order.
// GET /api/routes
func ListRoutes(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, `
			SELECT r.id, r.name, rs.stop_id, rs.stop_order
			FROM routes r
			LEFT JOIN route_stops rs ON rs.route_id = r.id
			ORDER BY r.id, rs.stop_order`)
		if err != nil {
			log.Printf("routes: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		routes := []route{}
		for rows.Next() {
			var (
				id     int
				name   string
				stopID sql.NullInt64
				order  sql.NullInt64
			)
			if err := rows.Scan(&id, &name, &stopID, &order); err != nil {
				log.Printf("routes: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if len(routes) == 0 || routes[len(routes)-1].ID != id {
				routes = append(routes, route{ID: id, Name: name, Stops: []routeStop{}})
			}
			if stopID.Valid {
				last := &routes[len(routes)-1]
				last.Stops = append(last.Stops, routeStop{StopID: int(stopID.Int64), Order: int(order.Int64)})
			}
		}
		if err := rows.Err(); err != nil {
			log.Printf("routes: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, routes)
	}
}

// ListStops returns all stops.
// GET /api/stops
func ListStops(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, `SELECT id, name, lat, lng FROM stops ORDER BY id`)
		if err != nil {
			log.Printf("stops: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		stops := []stop{}
		for rows.Next() {
			var s stop
			if err := rows.Scan(&s.ID, &s.Name, &s.Lat, &s.Lng); err != nil {
				log.Printf("stops: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			stops = append(stops, s)
		}
		if err := rows.Err(); err != nil {
			log.Printf("stops: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, stops)
	}
}

// writeJSON sends v as a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write response: %v", err)
	}
}

// writeError sends the API error shape: { "error": "message" }.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
