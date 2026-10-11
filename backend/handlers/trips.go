package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"scmts/backend/ranking"
)

// TODO task 3.7: take user ID from the auth token
const tempStudentID = 1

type createTripRequest struct {
	Origin *struct {
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	} `json:"origin"`
	Destination *struct {
		StopID *int64 `json:"stop_id"`
	} `json:"destination"`
}

type createTripResponse struct {
	TripID          int64                    `json:"trip_id"`
	Recommendations []ranking.Recommendation `json:"recommendations"`
}

// CreateTrip records a trip (D3) and returns ranked bus recommendations.
// The stop check, the D1/D2 reads and the INSERT run in one transaction,
// so the ranking and the stored trip come from the same snapshot.
// POST /api/trip/create
func CreateTrip(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req createTripRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.Origin == nil || req.Origin.Lat == nil || req.Origin.Lng == nil ||
			req.Destination == nil || req.Destination.StopID == nil {
			writeError(w, http.StatusBadRequest, "origin.lat, origin.lng and destination.stop_id are required")
			return
		}
		lat, lng, destID := *req.Origin.Lat, *req.Origin.Lng, *req.Destination.StopID
		if lat < -90 || lat > 90 {
			writeError(w, http.StatusBadRequest, "origin.lat must be between -90 and 90")
			return
		}
		if lng < -180 || lng > 180 {
			writeError(w, http.StatusBadRequest, "origin.lng must be between -180 and 180")
			return
		}
		if destID <= 0 {
			writeError(w, http.StatusBadRequest, "destination.stop_id must be a positive integer")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("trips: begin: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		// No-op after a successful Commit.
		defer func() { _ = tx.Rollback() }()

		// FOR SHARE keeps the stop from being deleted before the INSERT.
		var found int64
		err = tx.QueryRowContext(ctx, `SELECT id FROM stops WHERE id = ? FOR SHARE`, destID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "destination stop not found")
			return
		}
		if err != nil {
			log.Printf("trips: stop lookup: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		buses, err := loadRankingBuses(ctx, tx)
		if err != nil {
			log.Printf("trips: load buses: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		routes, err := loadRankingRoutes(ctx, tx)
		if err != nil {
			log.Printf("trips: load routes: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		recs := ranking.Rank(ranking.Point{Lat: lat, Lng: lng}, destID, buses, routes)

		// Store the top pick, or NULLs when nothing qualifies.
		var busID, routeID, boardStopID any
		if len(recs) > 0 {
			busID, routeID, boardStopID = recs[0].BusID, recs[0].RouteID, recs[0].BoardStopID
		}
		res, err := tx.ExecContext(ctx, `
			INSERT INTO trips (student_id, origin_lat, origin_lng, dest_stop_id, bus_id, route_id, board_stop_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			tempStudentID, lat, lng, destID, busID, routeID, boardStopID)
		if err != nil {
			log.Printf("trips: insert: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		tripID, err := res.LastInsertId()
		if err != nil {
			log.Printf("trips: last insert id: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("trips: commit: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusCreated, createTripResponse{TripID: tripID, Recommendations: recs})
	}
}

// loadRankingBuses reads the same bus + live data as GET /buses.
func loadRankingBuses(ctx context.Context, tx *sql.Tx) ([]ranking.Bus, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT b.id, b.route_id, l.lat, l.lng, l.speed, l.status
		FROM buses b
		JOIN bus_live l ON l.bus_id = b.id
		ORDER BY b.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buses []ranking.Bus
	for rows.Next() {
		var (
			b       ranking.Bus
			routeID sql.NullInt64
		)
		if err := rows.Scan(&b.ID, &routeID, &b.Pos.Lat, &b.Pos.Lng, &b.SpeedKmh, &b.Status); err != nil {
			return nil, err
		}
		if routeID.Valid {
			b.RouteID = routeID.Int64
		}
		buses = append(buses, b)
	}
	return buses, rows.Err()
}

// loadRankingRoutes reads every route's stops with coordinates, in stop order.
func loadRankingRoutes(ctx context.Context, tx *sql.Tx) ([]ranking.Route, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT rs.route_id, s.id, s.lat, s.lng
		FROM route_stops rs
		JOIN stops s ON s.id = rs.stop_id
		ORDER BY rs.route_id, rs.stop_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []ranking.Route
	for rows.Next() {
		var (
			routeID int64
			s       ranking.Stop
		)
		if err := rows.Scan(&routeID, &s.ID, &s.Pos.Lat, &s.Pos.Lng); err != nil {
			return nil, err
		}
		if len(routes) == 0 || routes[len(routes)-1].ID != routeID {
			routes = append(routes, ranking.Route{ID: routeID})
		}
		last := &routes[len(routes)-1]
		last.Stops = append(last.Stops, s)
	}
	return routes, rows.Err()
}
