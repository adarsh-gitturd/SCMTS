// Package ranking holds the rule-based bus recommendation logic (MVP).
// Pure functions only: no database or HTTP code.
package ranking

import (
	"math"
	"sort"
)

const (
	earthRadiusM    = 6371000.0
	minSpeedKmh     = 10.0
	defaultSpeedKmh = 20.0
	maxResults      = 3
	statusOutOfServ = "out_of_service"
)

// Point is a lat/lng coordinate in degrees.
type Point struct {
	Lat float64
	Lng float64
}

// Stop is one stop on a route.
type Stop struct {
	ID  int64
	Pos Point
}

// Route is a route with its stops ordered by stop_order.
type Route struct {
	ID    int64
	Stops []Stop
}

// Bus combines buses + bus_live. RouteID 0 means no route (buses.route_id NULL).
type Bus struct {
	ID       int64
	RouteID  int64
	Pos      Point
	SpeedKmh float64
	Status   string // on_route | delayed | break | out_of_service
}

// Recommendation matches one item of the POST /trip/create response.
type Recommendation struct {
	BusID       int64 `json:"bus_id"`
	RouteID     int64 `json:"route_id"`
	BoardStopID int64 `json:"board_stop_id"`
	DistanceM   int   `json:"distance_m"`
	EtaMinutes  int   `json:"eta_minutes"`
	Rank        int   `json:"rank"`
}

// Haversine returns the great-circle distance in meters between a and b.
func Haversine(a, b Point) float64 {
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180

	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(h))
}

// Rank returns up to 3 recommendations, lowest ETA first.
// It never returns nil.
func Rank(origin Point, destinationStopID int64, buses []Bus, routes []Route) []Recommendation {
	routeByID := make(map[int64]Route, len(routes))
	for _, r := range routes {
		routeByID[r.ID] = r
	}

	recs := make([]Recommendation, 0)
	for _, b := range buses {
		if b.Status == statusOutOfServ || b.RouteID == 0 {
			continue
		}
		route, ok := routeByID[b.RouteID]
		if !ok {
			continue
		}

		destIdx := stopIndex(route.Stops, destinationStopID)
		if destIdx < 0 {
			continue
		}
		boardIdx := closestStopIndex(route.Stops, origin)
		if boardIdx < 0 || boardIdx > destIdx {
			continue
		}
		board := route.Stops[boardIdx]

		distanceM := int(math.Round(Haversine(b.Pos, board.Pos)))
		recs = append(recs, Recommendation{
			BusID:       b.ID,
			RouteID:     route.ID,
			BoardStopID: board.ID,
			DistanceM:   distanceM,
			EtaMinutes:  etaMinutes(distanceM, b.SpeedKmh),
		})
	}

	sort.Slice(recs, func(i, j int) bool {
		if recs[i].EtaMinutes != recs[j].EtaMinutes {
			return recs[i].EtaMinutes < recs[j].EtaMinutes
		}
		if recs[i].DistanceM != recs[j].DistanceM {
			return recs[i].DistanceM < recs[j].DistanceM
		}
		return recs[i].BusID < recs[j].BusID
	})

	if len(recs) > maxResults {
		recs = recs[:maxResults]
	}
	for i := range recs {
		recs[i].Rank = i + 1
	}
	return recs
}

// stopIndex returns the position of stopID in stops, or -1.
func stopIndex(stops []Stop, stopID int64) int {
	for i, s := range stops {
		if s.ID == stopID {
			return i
		}
	}
	return -1
}

// closestStopIndex returns the position of the stop nearest to p, or -1 if stops is empty.
func closestStopIndex(stops []Stop, p Point) int {
	best := -1
	bestDist := math.Inf(1)
	for i, s := range stops {
		if d := Haversine(p, s.Pos); d < bestDist {
			best, bestDist = i, d
		}
	}
	return best
}

// etaMinutes converts a distance to whole minutes (rounded up).
// Speeds below 10 km/h fall back to 20 km/h.
func etaMinutes(distanceM int, speedKmh float64) int {
	if speedKmh < minSpeedKmh {
		speedKmh = defaultSpeedKmh
	}
	metersPerMin := speedKmh * 1000 / 60
	return int(math.Ceil(float64(distanceM) / metersPerMin))
}
