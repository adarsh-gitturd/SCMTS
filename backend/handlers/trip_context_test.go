package handlers

import (
	"testing"
	"time"
	_ "time/tzdata" // zones without OS zone files
)

func TestTripTimeContext(t *testing.T) {
	tests := []struct {
		name     string
		utc      string
		zone     string
		wantHour int
		wantWD   int
	}{
		{"UTC Friday is Saturday in Kolkata", "2026-10-16T20:00:00Z", "Asia/Kolkata", 1, 6},
		{"Sunday", "2026-10-18T04:00:00Z", "Asia/Kolkata", 9, 7},
		{"Monday", "2026-10-19T03:00:00Z", "Asia/Kolkata", 8, 1},
		{"hour 0 boundary", "2026-10-18T18:30:00Z", "Asia/Kolkata", 0, 1},
		{"hour 23 boundary", "2026-10-18T18:29:59Z", "Asia/Kolkata", 23, 7},
		{"other zone: previous day", "2026-10-17T02:00:00Z", "America/New_York", 22, 5},
		{"UTC zone", "2026-10-16T20:00:00Z", "UTC", 20, 5},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts, err := time.Parse(time.RFC3339, tc.utc)
			if err != nil {
				t.Fatalf("parse %q: %v", tc.utc, err)
			}
			loc, err := time.LoadLocation(tc.zone)
			if err != nil {
				t.Fatalf("load %q: %v", tc.zone, err)
			}
			hour, wd := tripTimeContext(ts, loc)
			if hour != tc.wantHour || wd != tc.wantWD {
				t.Errorf("tripTimeContext(%s, %s) = (%d, %d), want (%d, %d)",
					tc.utc, tc.zone, hour, wd, tc.wantHour, tc.wantWD)
			}
		})
	}
}
