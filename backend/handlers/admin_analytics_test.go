package handlers

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
	_ "time/tzdata" // zones below load without OS zone files
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

func TestParseRange(t *testing.T) {
	kolkata := mustLoc(t, "Asia/Kolkata")
	newYork := mustLoc(t, "America/New_York")
	utc := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatalf("bad test time %q: %v", s, err)
		}
		return v
	}
	// 2026-10-16T20:00Z is already 01:30 on 17 October in Kolkata.
	now := utc("2026-10-16T20:00:00Z")

	tests := []struct {
		name               string
		from, to           string
		now                time.Time
		loc                *time.Location
		wantStart, wantEnd string
		wantFrom, wantTo   string
		wantErr            error
	}{
		{name: "defaults use campus date", now: now, loc: kolkata,
			wantStart: "2026-09-17T18:30:00Z", wantEnd: "2026-10-17T18:30:00Z",
			wantFrom: "2026-09-18", wantTo: "2026-10-17"},
		{name: "defaults in UTC are still 16 October", now: now, loc: time.UTC,
			wantStart: "2026-09-17T00:00:00Z", wantEnd: "2026-10-17T00:00:00Z",
			wantFrom: "2026-09-17", wantTo: "2026-10-16"},
		{name: "single day", from: "2026-10-17", to: "2026-10-17", now: now, loc: kolkata,
			wantStart: "2026-10-16T18:30:00Z", wantEnd: "2026-10-17T18:30:00Z",
			wantFrom: "2026-10-17", wantTo: "2026-10-17"},
		{name: "only to", to: "2026-10-10", now: now, loc: time.UTC,
			wantStart: "2026-09-11T00:00:00Z", wantEnd: "2026-10-11T00:00:00Z",
			wantFrom: "2026-09-11", wantTo: "2026-10-10"},
		{name: "only from", from: "2026-10-01", now: now, loc: kolkata,
			wantStart: "2026-09-30T18:30:00Z", wantEnd: "2026-10-17T18:30:00Z",
			wantFrom: "2026-10-01", wantTo: "2026-10-17"},
		{name: "366 days ok", from: "2025-10-17", to: "2026-10-17", now: now, loc: kolkata,
			wantStart: "2025-10-16T18:30:00Z", wantEnd: "2026-10-17T18:30:00Z",
			wantFrom: "2025-10-17", wantTo: "2026-10-17"},
		{name: "leap year 366 days ok", from: "2024-01-01", to: "2024-12-31", now: now, loc: time.UTC,
			wantStart: "2024-01-01T00:00:00Z", wantEnd: "2025-01-01T00:00:00Z",
			wantFrom: "2024-01-01", wantTo: "2024-12-31"},
		{name: "DST end is a 25h day", from: "2026-11-01", to: "2026-11-01", now: now, loc: newYork,
			wantStart: "2026-11-01T04:00:00Z", wantEnd: "2026-11-02T05:00:00Z",
			wantFrom: "2026-11-01", wantTo: "2026-11-01"},
		{name: "DST start is a 23h day", from: "2026-03-08", to: "2026-03-08", now: now, loc: newYork,
			wantStart: "2026-03-08T05:00:00Z", wantEnd: "2026-03-09T04:00:00Z",
			wantFrom: "2026-03-08", wantTo: "2026-03-08"},

		{name: "367 days", from: "2025-10-16", to: "2026-10-17", now: now, loc: kolkata, wantErr: errRangeLarge},
		{name: "from after to", from: "2026-10-10", to: "2026-10-09", now: now, loc: kolkata, wantErr: errToBefore},
		{name: "only from in the future", from: "2026-10-18", now: now, loc: kolkata, wantErr: errToBefore},
		{name: "month 13", from: "2026-13-01", now: now, loc: kolkata, wantErr: errBadFrom},
		{name: "no zero padding", from: "2026-1-5", now: now, loc: kolkata, wantErr: errBadFrom},
		{name: "not a date", to: "abc", now: now, loc: kolkata, wantErr: errBadTo},
		{name: "30 February", to: "2026-02-30", now: now, loc: kolkata, wantErr: errBadTo},
		{name: "datetime", to: "2026-10-01T00:00:00Z", now: now, loc: kolkata, wantErr: errBadTo},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			start, end, from, to, err := parseRange(tc.from, tc.to, tc.now, tc.loc)
			if tc.wantErr != nil {
				if err != tc.wantErr {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !start.Equal(utc(tc.wantStart)) || !end.Equal(utc(tc.wantEnd)) {
				t.Errorf("bounds = %s .. %s, want %s .. %s",
					start.Format(time.RFC3339), end.Format(time.RFC3339), tc.wantStart, tc.wantEnd)
			}
			if start.Location() != time.UTC || end.Location() != time.UTC {
				t.Errorf("bounds not in UTC: %v, %v", start.Location(), end.Location())
			}
			if from != tc.wantFrom || to != tc.wantTo {
				t.Errorf("dates = %s..%s, want %s..%s", from, to, tc.wantFrom, tc.wantTo)
			}
		})
	}
}

func TestRound1(t *testing.T) {
	tests := []struct {
		in   sql.NullFloat64
		want *float64
	}{
		{sql.NullFloat64{}, nil},
		{sql.NullFloat64{Float64: 4.25, Valid: true}, floatPtr(4.3)},
		{sql.NullFloat64{Float64: -2.25, Valid: true}, floatPtr(-2.3)},
		{sql.NullFloat64{Float64: 2.04, Valid: true}, floatPtr(2.0)},
		{sql.NullFloat64{Float64: 14.5, Valid: true}, floatPtr(14.5)},
		{sql.NullFloat64{Float64: 0, Valid: true}, floatPtr(0)},
	}
	for _, tc := range tests {
		got := round1(tc.in)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("round1(%+v) = %v, want %v", tc.in, deref(got), deref(tc.want))
		}
	}
}

func floatPtr(f float64) *float64 { return &f }

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestBuildRouteStats(t *testing.T) {
	empty, err := json.Marshal(buildRouteStats("2026-10-01", "2026-10-17", nil))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(empty), `"routes":[]`) {
		t.Errorf("empty routes = %s, want []", empty)
	}

	rows := []routeStatsRow{
		{RouteID: 1, RouteName: "Main Gate - Hostel", Trips: 320, RatedTrips: 120,
			AvgRating:      sql.NullFloat64{Float64: 4.1667, Valid: true},
			CompletedTrips: 150, TimedTrips: 90,
			AvgDurationMin:     sql.NullFloat64{Float64: 14.4833, Valid: true},
			AvgPredictedETAMin: sql.NullFloat64{Float64: 12.0889, Valid: true},
			AvgDelayMin:        sql.NullFloat64{Float64: -0.25, Valid: true}},
		{RouteID: 2, RouteName: "Library Loop", Trips: 3},
	}
	got := buildRouteStats("2026-10-01", "2026-10-17", rows)
	want := routeStatsResponse{From: "2026-10-01", To: "2026-10-17", Routes: []routeStats{
		{RouteID: 1, RouteName: "Main Gate - Hostel", Trips: 320, RatedTrips: 120,
			AvgRating: floatPtr(4.2), CompletedTrips: 150, TimedTrips: 90,
			AvgDurationMin: floatPtr(14.5), AvgPredictedETAMin: floatPtr(12.1), AvgDelayMin: floatPtr(-0.3)},
		{RouteID: 2, RouteName: "Library Loop", Trips: 3},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildRouteStats = %+v, want %+v", got, want)
	}

	b, err := json.Marshal(got.Routes[1])
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"avg_rating", "avg_duration_min", "avg_predicted_eta_min", "avg_delay_min"} {
		if !strings.Contains(string(b), `"`+k+`":null`) {
			t.Errorf("%s not null in %s", k, b)
		}
	}
}

func TestBuildDemand(t *testing.T) {
	empty, err := json.Marshal(buildDemand("2026-10-01", "2026-10-17", nil))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(empty), `"cells":[]`) || !strings.Contains(string(empty), `"trips_without_context":0`) {
		t.Errorf("empty demand = %s", empty)
	}

	n := func(v int64) sql.NullInt64 { return sql.NullInt64{Int64: v, Valid: true} }
	rows := []demandRow{
		{Trips: 10},               // both NULL (pre-4.1)
		{Weekday: n(3), Trips: 2}, // hour NULL
		{Hour: n(9), Trips: 1},    // weekday NULL
		{Weekday: n(1), Hour: n(8), Trips: 54},
		{Weekday: n(7), Hour: n(23), Trips: 4},
	}
	got := buildDemand("2026-10-01", "2026-10-17", rows)
	want := demandResponse{From: "2026-10-01", To: "2026-10-17",
		Cells: []demandCell{
			{Weekday: 1, Hour: 8, Trips: 54},
			{Weekday: 7, Hour: 23, Trips: 4},
		},
		TripsWithoutContext: 13,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildDemand = %+v, want %+v", got, want)
	}
}
