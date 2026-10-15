// Package sim holds the GPS simulator's movement logic.
// Pure functions only: no database code.
package sim

import (
	"math"

	"scmts/backend/ranking"
)

// metresPerDegree is the length of one degree of latitude, using the same
// Earth radius as ranking.Haversine.
const metresPerDegree = 6371000.0 * math.Pi / 180

// RouteLength returns the total length in metres of the straight lines
// between consecutive stops.
func RouteLength(stops []ranking.Point) float64 {
	total := 0.0
	for i := 1; i < len(stops); i++ {
		total += ranking.Haversine(stops[i-1], stops[i])
	}
	return total
}

// Position returns where a bus is after travelling distance metres along
// stops. It starts at the first stop if forward is true, otherwise at the last
// stop, moves in straight lines between consecutive stops and turns around at
// either end (ping-pong). forwardNow is the direction of travel at that point.
// ok is false only for an empty route; a single-stop route returns that stop.
func Position(stops []ranking.Point, distance float64, forward bool) (pos ranking.Point, forwardNow bool, ok bool) {
	if len(stops) == 0 {
		return ranking.Point{}, forward, false
	}
	length := RouteLength(stops)
	if len(stops) == 1 || length == 0 {
		return stops[0], forward, true
	}

	// x is the position within one round trip [0, 2L): 0..L outbound, L..2L back.
	x := distance
	if !forward {
		x += length
	}
	x = math.Mod(x, 2*length)
	if x < 0 {
		x += 2 * length
	}
	along := x
	forwardNow = x < length
	if !forwardNow {
		along = 2*length - x
	}

	// Walk the legs. Linear lat/lng interpolation is accurate enough over
	// campus-sized legs.
	for i := 0; i < len(stops)-1; i++ {
		a, b := stops[i], stops[i+1]
		leg := ranking.Haversine(a, b)
		if along <= leg || i == len(stops)-2 {
			frac := 0.0
			if leg > 0 {
				frac = math.Min(along/leg, 1)
			}
			return ranking.Point{
				Lat: a.Lat + (b.Lat-a.Lat)*frac,
				Lng: a.Lng + (b.Lng-a.Lng)*frac,
			}, forwardNow, true
		}
		along -= leg
	}
	return stops[len(stops)-1], forwardNow, true // unreachable
}

// Offset moves p by northM metres north and eastM metres east (small distances only).
func Offset(p ranking.Point, northM, eastM float64) ranking.Point {
	return ranking.Point{
		Lat: p.Lat + northM/metresPerDegree,
		Lng: p.Lng + eastM/(metresPerDegree*math.Cos(p.Lat*math.Pi/180)),
	}
}
