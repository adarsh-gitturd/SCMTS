package handlers

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"time"

	"scmts/backend/auth"
)

type driverRouteStop struct {
	StopID int     `json:"stop_id"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Order  int     `json:"order"`
}

type driverRoute struct {
	ID    int               `json:"id"`
	Name  string            `json:"name"`
	Stops []driverRouteStop `json:"stops"`
}

type driverRouteResponse struct {
	BusID int          `json:"bus_id"`
	Plate string       `json:"plate"`
	Route *driverRoute `json:"route"` // null when the bus has no route
}

// DriverRoute returns the logged-in driver's bus and its route stops in order.
// The driver is taken from the token only, so a driver sees just their own bus.
// GET /api/driver/route
func DriverRoute(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driverID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		var (
			resp      driverRouteResponse
			routeID   sql.NullInt64
			routeName sql.NullString
		)
		err := db.QueryRowContext(ctx, `
			SELECT b.id, b.plate, r.id, r.name
			FROM buses b
			LEFT JOIN routes r ON r.id = b.route_id
			WHERE b.driver_id = ?`, driverID).Scan(&resp.BusID, &resp.Plate, &routeID, &routeName)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no bus assigned")
			return
		}
		if err != nil {
			log.Printf("driver route: bus lookup: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if !routeID.Valid {
			writeJSON(w, http.StatusOK, resp)
			return
		}

		rows, err := db.QueryContext(ctx, `
			SELECT rs.stop_id, s.name, s.lat, s.lng, rs.stop_order
			FROM route_stops rs
			JOIN stops s ON s.id = rs.stop_id
			WHERE rs.route_id = ?
			ORDER BY rs.stop_order`, routeID.Int64)
		if err != nil {
			log.Printf("driver route: stops query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		rt := &driverRoute{ID: int(routeID.Int64), Name: routeName.String, Stops: []driverRouteStop{}}
		for rows.Next() {
			var s driverRouteStop
			if err := rows.Scan(&s.StopID, &s.Name, &s.Lat, &s.Lng, &s.Order); err != nil {
				log.Printf("driver route: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			rt.Stops = append(rt.Stops, s)
		}
		if err := rows.Err(); err != nil {
			log.Printf("driver route: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		resp.Route = rt
		writeJSON(w, http.StatusOK, resp)
	}
}
