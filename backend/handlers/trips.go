package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"scmts/backend/auth"
	"scmts/backend/ranking"
)

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
		studentID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

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
			studentID, lat, lng, destID, busID, routeID, boardStopID)
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

type completeTripRequest struct {
	Rating   *int    `json:"rating"`
	Feedback *string `json:"feedback"`
}

type completeTripResponse struct {
	TripID int64  `json:"trip_id"`
	Status string `json:"status"`
}

// CompleteTrip sets the rating, feedback and end time of a started trip (D3).
// The UPDATE only matches trips that are not completed yet, so a rating
// is saved at most once even under concurrent requests.
// PATCH /api/trip/{id}/complete
func CompleteTrip(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studentID, _, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		tripID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || tripID <= 0 {
			writeError(w, http.StatusBadRequest, "id must be a positive integer")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req completeTripRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.Rating == nil {
			writeError(w, http.StatusBadRequest, "rating is required")
			return
		}
		if *req.Rating < 1 || *req.Rating > 5 {
			writeError(w, http.StatusBadRequest, "rating must be between 1 and 5")
			return
		}

		// Empty or whitespace-only feedback is stored as NULL.
		var feedback any
		if req.Feedback != nil {
			f := strings.TrimSpace(*req.Feedback)
			if utf8.RuneCountInString(f) > 500 {
				writeError(w, http.StatusBadRequest, "feedback must be at most 500 characters")
				return
			}
			if f != "" {
				feedback = f
			}
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		res, err := db.ExecContext(ctx, `
			UPDATE trips
			SET rating = ?, feedback = ?, ended_at = CURRENT_TIMESTAMP, status = 'completed'
			WHERE id = ? AND student_id = ? AND status <> 'completed'`,
			*req.Rating, feedback, tripID, studentID)
		if err != nil {
			log.Printf("trips: complete update: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Printf("trips: complete rows affected: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if n == 1 {
			writeJSON(w, http.StatusOK, completeTripResponse{TripID: tripID, Status: "completed"})
			return
		}

		// Nothing updated: find out whether the trip is missing or already completed.
		// Trips of other students count as missing.
		var status string
		err = db.QueryRowContext(ctx,
			`SELECT status FROM trips WHERE id = ? AND student_id = ?`,
			tripID, studentID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "trip not found")
			return
		}
		if err != nil {
			log.Printf("trips: complete lookup: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if status == "completed" {
			writeError(w, http.StatusConflict, "trip already completed")
			return
		}
		log.Printf("trips: complete: trip %d not updated, status %q", tripID, status)
		writeError(w, http.StatusInternalServerError, "internal error")
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
