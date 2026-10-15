package sim

import (
	"math"
	"testing"

	"scmts/backend/ranking"
)

func TestPosition(t *testing.T) {
	// Three stops in a straight line north, two equal legs of ~111 m.
	a := ranking.Point{Lat: 10.000, Lng: 76.000}
	b := ranking.Point{Lat: 10.001, Lng: 76.000}
	c := ranking.Point{Lat: 10.002, Lng: 76.000}
	route := []ranking.Point{a, b, c}
	leg := ranking.Haversine(a, b)
	length := RouteLength(route)

	tests := []struct {
		name        string
		stops       []ranking.Point
		distance    float64
		forward     bool
		want        ranking.Point
		wantForward bool
		wantOK      bool
	}{
		{"start forward", route, 0, true, a, true, true},
		{"start backward", route, 0, false, c, false, true},
		{"midway between first two stops", route, leg / 2, true, ranking.Point{Lat: 10.0005, Lng: 76}, true, true},
		{"exactly on middle stop", route, leg, true, b, true, true},
		{"exactly on last stop turns around", route, length, true, c, false, true},
		{"past the end turns around", route, length + leg/2, true, ranking.Point{Lat: 10.0015, Lng: 76}, false, true},
		{"full round trip back at start", route, 2 * length, true, a, true, true},
		{"backward midway", route, leg / 2, false, ranking.Point{Lat: 10.0015, Lng: 76}, false, true},
		{"single stop", []ranking.Point{b}, 500, true, b, true, true},
		{"empty route", nil, 100, true, ranking.Point{}, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, gotForward, gotOK := Position(tt.stops, tt.distance, tt.forward)
			if gotOK != tt.wantOK {
				t.Fatalf("ok = %v, want %v", gotOK, tt.wantOK)
			}
			if gotForward != tt.wantForward {
				t.Errorf("forward = %v, want %v", gotForward, tt.wantForward)
			}
			if math.Abs(got.Lat-tt.want.Lat) > 1e-9 || math.Abs(got.Lng-tt.want.Lng) > 1e-9 {
				t.Errorf("pos = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestRouteLength(t *testing.T) {
	a := ranking.Point{Lat: 10.000, Lng: 76.000}
	b := ranking.Point{Lat: 10.001, Lng: 76.000}
	tests := []struct {
		name  string
		stops []ranking.Point
		want  float64
	}{
		{"empty", nil, 0},
		{"single stop", []ranking.Point{a}, 0},
		{"there and back", []ranking.Point{a, b, a}, 2 * ranking.Haversine(a, b)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RouteLength(tt.stops); math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("RouteLength = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestOffset(t *testing.T) {
	p := ranking.Point{Lat: 10.04, Lng: 76.32}
	tests := []struct {
		name         string
		north, east  float64
		wantDistance float64
	}{
		{"none", 0, 0, 0},
		{"3 m north", 3, 0, 3},
		{"3 m east", 0, 3, 3},
		{"100 m south-west", -60, -80, 100},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ranking.Haversine(p, Offset(p, tt.north, tt.east))
			if math.Abs(got-tt.wantDistance) > 0.01 {
				t.Errorf("moved %.4f m, want %.4f m", got, tt.wantDistance)
			}
		})
	}
}
