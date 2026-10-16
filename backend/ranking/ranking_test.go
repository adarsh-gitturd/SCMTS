package ranking

import (
	"math"
	"reflect"
	"testing"
)

// Stops lie on one meridian, 0.01° lat (~1112 m) apart.
var (
	s1 = Stop{ID: 1, Pos: Point{13.000, 80.000}}
	s2 = Stop{ID: 2, Pos: Point{13.010, 80.000}}
	s3 = Stop{ID: 3, Pos: Point{13.020, 80.000}}
	s4 = Stop{ID: 4, Pos: Point{13.030, 80.000}}

	route1 = Route{ID: 1, Stops: []Stop{s1, s2, s3, s4}}
	route2 = Route{ID: 2, Stops: []Stop{s1, s2}} // no stop 3 or 4

	originNearS2 = Point{13.0101, 80.000}
)

func TestHaversine(t *testing.T) {
	got := Haversine(Point{13.000, 80.000}, Point{13.010, 80.000})
	if math.Abs(got-1111.95) > 0.5 {
		t.Fatalf("Haversine = %.2f m, want ~1111.95 m", got)
	}
	if d := Haversine(s1.Pos, s1.Pos); d != 0 {
		t.Fatalf("Haversine(same point) = %v, want 0", d)
	}
}

func TestRank(t *testing.T) {
	tests := []struct {
		name   string
		destID int64
		buses  []Bus
		want   []Recommendation
	}{
		{
			name:   "normal: top 3 by ETA, slow bus uses 20 km/h",
			destID: 4,
			buses: []Bus{
				{ID: 4, RouteID: 1, Pos: Point{12.990, 80.000}, SpeedKmh: 30, Status: "on_route"}, // 2224 m, 5 min
				{ID: 3, RouteID: 1, Pos: Point{13.000, 80.000}, SpeedKmh: 5, Status: "delayed"},   // 1112 m @20 km/h, 4 min
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "on_route"}, // 556 m, 2 min
				{ID: 2, RouteID: 1, Pos: Point{13.000, 80.000}, SpeedKmh: 30, Status: "on_route"}, // 1112 m, 3 min
			},
			want: []Recommendation{
				{BusID: 1, RouteID: 1, BoardStopID: 2, DistanceM: 556, EtaMinutes: 2, Rank: 1},
				{BusID: 2, RouteID: 1, BoardStopID: 2, DistanceM: 1112, EtaMinutes: 3, Rank: 2},
				{BusID: 3, RouteID: 1, BoardStopID: 2, DistanceM: 1112, EtaMinutes: 4, Rank: 3},
			},
		},
		{
			name:   "out_of_service bus skipped",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "out_of_service"},
				{ID: 2, RouteID: 1, Pos: Point{13.000, 80.000}, SpeedKmh: 30, Status: "on_route"},
			},
			want: []Recommendation{
				{BusID: 2, RouteID: 1, BoardStopID: 2, DistanceM: 1112, EtaMinutes: 3, Rank: 1},
			},
		},
		{
			name:   "break bus skipped",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "break"},
				{ID: 2, RouteID: 1, Pos: Point{13.000, 80.000}, SpeedKmh: 30, Status: "on_route"},
			},
			want: []Recommendation{
				{BusID: 2, RouteID: 1, BoardStopID: 2, DistanceM: 1112, EtaMinutes: 3, Rank: 1},
			},
		},
		{
			name:   "delayed bus still recommended",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "delayed"},
			},
			want: []Recommendation{
				{BusID: 1, RouteID: 1, BoardStopID: 2, DistanceM: 556, EtaMinutes: 2, Rank: 1},
			},
		},
		{
			name:   "only bus on route is on break",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "break"},
			},
			want: []Recommendation{},
		},
		{
			name:   "bus on route without destination skipped",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 2, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "on_route"},
				{ID: 2, RouteID: 1, Pos: Point{13.000, 80.000}, SpeedKmh: 30, Status: "on_route"},
			},
			want: []Recommendation{
				{BusID: 2, RouteID: 1, BoardStopID: 2, DistanceM: 1112, EtaMinutes: 3, Rank: 1},
			},
		},
		{
			name:   "destination before board stop skipped",
			destID: 1, // board stop is s2, which comes after s1
			buses: []Bus{
				{ID: 1, RouteID: 1, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "on_route"},
			},
			want: []Recommendation{},
		},
		{
			name:   "bus with no route skipped",
			destID: 4,
			buses: []Bus{
				{ID: 1, RouteID: 0, Pos: Point{13.005, 80.000}, SpeedKmh: 30, Status: "on_route"},
			},
			want: []Recommendation{},
		},
		{
			name:   "empty result when no buses",
			destID: 4,
			buses:  nil,
			want:   []Recommendation{},
		},
	}

	routes := []Route{route1, route2}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Rank(originNearS2, tt.destID, tt.buses, routes)
			if got == nil {
				t.Fatal("Rank returned nil, want non-nil slice")
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Rank =\n  %+v\nwant\n  %+v", got, tt.want)
			}
		})
	}
}

func TestIsRecommendable(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{"on_route", true},
		{"delayed", true},
		{"break", false},
		{"out_of_service", false},
		// Unknown and empty values stay eligible (behaviour before break was added).
		{"", true},
		{"parked", true},
	}
	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			if got := isRecommendable(tt.status); got != tt.want {
				t.Errorf("isRecommendable(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}
