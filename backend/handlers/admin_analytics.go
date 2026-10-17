package handlers

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"math"
	"net/http"
	"time"
)

// dateLayout is the YYYY-MM-DD format of ?from= and ?to=.
const dateLayout = "2006-01-02"

// analyticsDefaultDays and analyticsMaxDays are inclusive calendar days.
const (
	analyticsDefaultDays = 30
	analyticsMaxDays     = 366
)

var (
	errBadFrom    = errors.New("from must be a date YYYY-MM-DD")
	errBadTo      = errors.New("to must be a date YYYY-MM-DD")
	errToBefore   = errors.New("to must not be before from")
	errRangeLarge = errors.New("range must be at most 366 days")
)

// routeStatsQuery aggregates trips per route in [start, endExcl). Only
// route_id, the route name and aggregates are selected (no per-trip or
// per-student columns). A trip is "timed" when it is completed and has
// ended_at and predicted_eta_min; the three timed averages use exactly that
// set. predicted_eta_min is cast to SIGNED so a negative delay does not hit
// the unsigned range error. Trips with route_id NULL never match the join.
const routeStatsQuery = `
	SELECT t.route_id, r.name,
	       COUNT(*),
	       COUNT(t.rating),
	       AVG(t.rating),
	       COUNT(CASE WHEN t.status = 'completed' THEN 1 END),
	       COUNT(CASE WHEN t.status = 'completed' AND t.ended_at IS NOT NULL
	                   AND t.predicted_eta_min IS NOT NULL THEN 1 END),
	       AVG(CASE WHEN t.status = 'completed' AND t.ended_at IS NOT NULL
	                 AND t.predicted_eta_min IS NOT NULL
	                THEN TIMESTAMPDIFF(SECOND, t.started_at, t.ended_at) / 60.0 END),
	       AVG(CASE WHEN t.status = 'completed' AND t.ended_at IS NOT NULL
	                 AND t.predicted_eta_min IS NOT NULL
	                THEN t.predicted_eta_min END),
	       AVG(CASE WHEN t.status = 'completed' AND t.ended_at IS NOT NULL
	                 AND t.predicted_eta_min IS NOT NULL
	                THEN TIMESTAMPDIFF(SECOND, t.started_at, t.ended_at) / 60.0
	                     - CAST(t.predicted_eta_min AS SIGNED) END)
	FROM trips t
	JOIN routes r ON r.id = t.route_id
	WHERE t.started_at >= ? AND t.started_at < ?
	GROUP BY t.route_id, r.name
	ORDER BY COUNT(*) DESC, t.route_id
	LIMIT 200`

// demandQuery counts trips per stored (start_weekday, start_hour) in
// [start, endExcl), all routes. Groups with a NULL in either column are
// pre-4.1 trips and go to trips_without_context. CHECK constraints allow at
// most 8 x 25 = 200 groups, so LIMIT 200 never cuts data.
const demandQuery = `
	SELECT start_weekday, start_hour, COUNT(*)
	FROM trips
	WHERE started_at >= ? AND started_at < ?
	GROUP BY start_weekday, start_hour
	ORDER BY start_weekday, start_hour
	LIMIT 200`

type routeStats struct {
	RouteID            int64    `json:"route_id"`
	RouteName          string   `json:"route_name"`
	Trips              int64    `json:"trips"`
	RatedTrips         int64    `json:"rated_trips"`
	AvgRating          *float64 `json:"avg_rating"`
	CompletedTrips     int64    `json:"completed_trips"`
	TimedTrips         int64    `json:"timed_trips"`
	AvgDurationMin     *float64 `json:"avg_duration_min"`
	AvgPredictedETAMin *float64 `json:"avg_predicted_eta_min"`
	AvgDelayMin        *float64 `json:"avg_delay_min"`
}

type routeStatsResponse struct {
	From   string       `json:"from"`
	To     string       `json:"to"`
	Routes []routeStats `json:"routes"`
}

// routeStatsRow is one scanned row of routeStatsQuery.
type routeStatsRow struct {
	RouteID            int64
	RouteName          string
	Trips              int64
	RatedTrips         int64
	AvgRating          sql.NullFloat64
	CompletedTrips     int64
	TimedTrips         int64
	AvgDurationMin     sql.NullFloat64
	AvgPredictedETAMin sql.NullFloat64
	AvgDelayMin        sql.NullFloat64
}

type demandCell struct {
	Weekday int   `json:"weekday"`
	Hour    int   `json:"hour"`
	Trips   int64 `json:"trips"`
}

type demandResponse struct {
	From                string       `json:"from"`
	To                  string       `json:"to"`
	Cells               []demandCell `json:"cells"`
	TripsWithoutContext int64        `json:"trips_without_context"`
}

// demandRow is one scanned row of demandQuery.
type demandRow struct {
	Weekday sql.NullInt64
	Hour    sql.NullInt64
	Trips   int64
}

// parseDate parses a strict YYYY-MM-DD civil date (as UTC midnight).
func parseDate(s string) (time.Time, bool) {
	t, err := time.Parse(dateLayout, s)
	if err != nil || t.Format(dateLayout) != s {
		return time.Time{}, false
	}
	return t, true
}

// parseRange turns optional ?from= and ?to= (inclusive campus dates) into
// UTC bounds [startUTC, endExclUTC). Empty means missing: to defaults to
// today's campus date, from to 29 days before to. endExclUTC is the start of
// the local day after to, so DST days are 23 or 25 hours long.
func parseRange(from, to string, now time.Time, loc *time.Location) (startUTC, endExclUTC time.Time, fromStr, toStr string, err error) {
	y, m, d := now.In(loc).Date()
	toD := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	if to != "" {
		var ok bool
		if toD, ok = parseDate(to); !ok {
			return time.Time{}, time.Time{}, "", "", errBadTo
		}
	}
	fromD := toD.AddDate(0, 0, -(analyticsDefaultDays - 1))
	if from != "" {
		var ok bool
		if fromD, ok = parseDate(from); !ok {
			return time.Time{}, time.Time{}, "", "", errBadFrom
		}
	}
	if toD.Before(fromD) {
		return time.Time{}, time.Time{}, "", "", errToBefore
	}
	// Civil dates are UTC midnights, so the difference is whole days.
	if toD.Sub(fromD).Hours()/24+1 > analyticsMaxDays {
		return time.Time{}, time.Time{}, "", "", errRangeLarge
	}
	startUTC = time.Date(fromD.Year(), fromD.Month(), fromD.Day(), 0, 0, 0, 0, loc).UTC()
	endExclUTC = time.Date(toD.Year(), toD.Month(), toD.Day()+1, 0, 0, 0, 0, loc).UTC()
	return startUTC, endExclUTC, fromD.Format(dateLayout), toD.Format(dateLayout), nil
}

// round1 rounds to 1 decimal; NULL stays nil.
func round1(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	r := math.Round(v.Float64*10) / 10
	return &r
}

// buildRouteStats turns scanned rows into the response. Routes is never nil
// and averages are rounded to 1 decimal or null.
func buildRouteStats(from, to string, rows []routeStatsRow) routeStatsResponse {
	resp := routeStatsResponse{From: from, To: to, Routes: []routeStats{}}
	for _, row := range rows {
		resp.Routes = append(resp.Routes, routeStats{
			RouteID:            row.RouteID,
			RouteName:          row.RouteName,
			Trips:              row.Trips,
			RatedTrips:         row.RatedTrips,
			AvgRating:          round1(row.AvgRating),
			CompletedTrips:     row.CompletedTrips,
			TimedTrips:         row.TimedTrips,
			AvgDurationMin:     round1(row.AvgDurationMin),
			AvgPredictedETAMin: round1(row.AvgPredictedETAMin),
			AvgDelayMin:        round1(row.AvgDelayMin),
		})
	}
	return resp
}

// buildDemand turns scanned rows into the response. Cells is never nil;
// groups with a NULL weekday or hour are summed into TripsWithoutContext.
func buildDemand(from, to string, rows []demandRow) demandResponse {
	resp := demandResponse{From: from, To: to, Cells: []demandCell{}}
	for _, row := range rows {
		if !row.Weekday.Valid || !row.Hour.Valid {
			resp.TripsWithoutContext += row.Trips
			continue
		}
		resp.Cells = append(resp.Cells, demandCell{
			Weekday: int(row.Weekday.Int64),
			Hour:    int(row.Hour.Int64),
			Trips:   row.Trips,
		})
	}
	return resp
}

// AdminAnalyticsRoutes returns per-route trip aggregates (D3) for a campus
// date range. Read-only, aggregates only.
// GET /api/admin/analytics/routes?from=YYYY-MM-DD&to=YYYY-MM-DD
func AdminAnalyticsRoutes(db *sql.DB, loc *time.Location) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		start, end, from, to, err := parseRange(q.Get("from"), q.Get("to"), time.Now(), loc)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, routeStatsQuery, start, end)
		if err != nil {
			log.Printf("admin analytics routes: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		scanned := make([]routeStatsRow, 0, 16)
		for rows.Next() {
			var s routeStatsRow
			if err := rows.Scan(&s.RouteID, &s.RouteName, &s.Trips, &s.RatedTrips, &s.AvgRating,
				&s.CompletedTrips, &s.TimedTrips, &s.AvgDurationMin, &s.AvgPredictedETAMin,
				&s.AvgDelayMin); err != nil {
				log.Printf("admin analytics routes: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			scanned = append(scanned, s)
		}
		if err := rows.Err(); err != nil {
			log.Printf("admin analytics routes: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, buildRouteStats(from, to, scanned))
	}
}

// AdminAnalyticsDemand returns trip counts per stored (weekday, hour) (D3)
// for a campus date range, plus the number of trips without that context.
// Read-only, aggregates only.
// GET /api/admin/analytics/demand?from=YYYY-MM-DD&to=YYYY-MM-DD
func AdminAnalyticsDemand(db *sql.DB, loc *time.Location) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		start, end, from, to, err := parseRange(q.Get("from"), q.Get("to"), time.Now(), loc)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := db.QueryContext(ctx, demandQuery, start, end)
		if err != nil {
			log.Printf("admin analytics demand: query: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		defer rows.Close()

		scanned := make([]demandRow, 0, 64)
		for rows.Next() {
			var d demandRow
			if err := rows.Scan(&d.Weekday, &d.Hour, &d.Trips); err != nil {
				log.Printf("admin analytics demand: scan: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			scanned = append(scanned, d)
		}
		if err := rows.Err(); err != nil {
			log.Printf("admin analytics demand: rows: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		writeJSON(w, http.StatusOK, buildDemand(from, to, scanned))
	}
}
