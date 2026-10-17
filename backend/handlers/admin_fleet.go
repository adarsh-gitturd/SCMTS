package handlers

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"time"
)

// fleetQuery reads every bus with its live row, route and driver in one
// statement. The one-row derived table makes sure a row (and server_time)
// comes back even when there are no buses; that row has b.id NULL.
// Only u.name is selected from users. LIMIT 500 is a hard cap.
const fleetQuery = `
	SELECT n.server_time,
	       b.id, b.plate, b.route_id, r.name, b.driver_id, u.name,
	       l.bus_id, l.lat, l.lng, l.speed, l.status, l.updated_at
	FROM (SELECT CURRENT_TIMESTAMP AS server_time) n
	LEFT JOIN buses b    ON TRUE
	LEFT JOIN bus_live l ON l.bus_id = b.id
	LEFT JOIN routes r   ON r.id = b.route_id
	LEFT JOIN users u    ON u.id = b.driver_id
	ORDER BY b.id
	LIMIT 500`

type fleetLive struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Speed     float64   `json:"speed"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

type fleetBus struct {
	BusID      int        `json:"bus_id"`
	Plate      string     `json:"plate"`
	RouteID    *int       `json:"route_id"`
	RouteName  *string    `json:"route_name"`
	DriverID   *int       `json:"driver_id"`
	DriverName *string    `json:"driver_name"`
	Live       *fleetLive `json:"live"`
}

type fleetResponse struct {
	ServerTime time.Time  `json:"server_time"`
	Buses      []fleetBus `json:"buses"`
}

// fleetRow is one scanned row of fleetQuery (everything after server_time).
type fleetRow struct {
	BusID      sql.NullInt64
	Plate      sql.NullString
	RouteID    sql.NullInt64
	RouteName  sql.NullString
	DriverID   sql.NullInt64
	DriverName sql.NullString
	LiveBusID  sql.NullInt64
	Lat        sql.NullFloat64
	Lng        sql.NullFloat64
	Speed      sql.NullFloat64
	Status     sql.NullString
	UpdatedAt  sql.NullTime
}

// buildFleet turns scanned rows into the response. Buses is never nil, rows
// without a bus are skipped, and live is set only when the bus_live join
// matched (LiveBusID not NULL).
func buildFleet(serverTime time.Time, rows []fleetRow) fleetResponse {
	resp := fleetResponse{ServerTime: serverTime, Buses: []fleetBus{}}
	for _, row := range rows {
		if !row.BusID.Valid {
			continue
		}
		b := fleetBus{
			BusID:      int(row.BusID.Int64),
			Plate:      row.Plate.String,
			RouteID:    nullIntPtr(row.RouteID),
			RouteName:  nullStringPtr(row.RouteName),
			DriverID:   nullIntPtr(row.DriverID),
			DriverName: nullStringPtr(row.DriverName),
		}
		if row.LiveBusID.Valid {
			b.Live = &fleetLive{
				Lat:       row.Lat.Float64,
				Lng:       row.Lng.Float64,
				Speed:     row.Speed.Float64,
				Status:    row.Status.String,
				UpdatedAt: row.UpdatedAt.Time,
			}
		}
		resp.Buses = append(resp.Buses, b)
	}
	return resp
}

func nullIntPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func nullStringPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

// AdminFleet returns every bus with its live data (D2), route and driver
// name. Read-only. server_time is the database clock, comparable with
// updated_at.
// GET /api/admin/fleet
func AdminFleet(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, fleetQuery)
		if err != nil {
			log.Printf("admin fleet: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		var (
			serverTime time.Time
			scanned    = make([]fleetRow, 0, 16)
		)
		for rows.Next() {
			var f fleetRow
			// Session time zone is UTC (db.go), so both times scan as UTC.
			if err := rows.Scan(&serverTime,
				&f.BusID, &f.Plate, &f.RouteID, &f.RouteName, &f.DriverID, &f.DriverName,
				&f.LiveBusID, &f.Lat, &f.Lng, &f.Speed, &f.Status, &f.UpdatedAt); err != nil {
				log.Printf("admin fleet: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			scanned = append(scanned, f)
		}
		if err := rows.Err(); err != nil {
			log.Printf("admin fleet: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, buildFleet(serverTime, scanned))
	}
}
