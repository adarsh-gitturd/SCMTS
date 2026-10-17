package handlers

import (
	"math"
	"testing"
	"time"
)

func TestParseLocation(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	nan, inf := math.NaN(), math.Inf(1)

	tests := []struct {
		name            string
		lat, lng, speed *float64
		wantOK          bool
	}{
		{"typical", f(13.01), f(80.23), f(22), true},
		{"all minimums", f(-90), f(-180), f(0), true},
		{"all maximums", f(90), f(180), f(200), true},
		{"lat over", f(90.0001), f(0), f(0), false},
		{"lat under", f(-90.0001), f(0), f(0), false},
		{"lng over", f(0), f(180.0001), f(0), false},
		{"lng under", f(0), f(-180.0001), f(0), false},
		{"speed negative", f(0), f(0), f(-0.1), false},
		{"speed over", f(0), f(0), f(200.1), false},
		{"lat NaN", f(nan), f(0), f(0), false},
		{"lng NaN", f(0), f(nan), f(0), false},
		{"speed NaN", f(0), f(0), f(nan), false},
		{"lat +Inf", f(inf), f(0), f(0), false},
		{"lng -Inf", f(0), f(-inf), f(0), false},
		{"speed +Inf", f(0), f(0), f(inf), false},
		{"missing lat", nil, f(0), f(0), false},
		{"missing lng", f(0), nil, f(0), false},
		{"missing speed", f(0), f(0), nil, false},
		{"all missing", nil, nil, nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lat, lng, speed, msg := parseLocation(driverLocationRequest{Lat: tt.lat, Lng: tt.lng, Speed: tt.speed})
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
			if tt.wantOK && (lat != *tt.lat || lng != *tt.lng || speed != *tt.speed) {
				t.Fatalf("got %v, %v, %v", lat, lng, speed)
			}
		})
	}
}

func TestValidStatus(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"on_route", true},
		{"delayed", true},
		{"break", true},
		{"out_of_service", true},
		{"", false},
		{"Delayed", false},
		{"on route", false},
		{" delayed", false},
		{"delayed ", false},
		{"unknown", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := validStatus(tt.in); got != tt.want {
				t.Fatalf("validStatus(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestRateLimiter(t *testing.T) {
	start := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	now := start
	l := newRateLimiter(500*time.Millisecond, func() time.Time { return now })

	steps := []struct {
		name string
		at   time.Duration // since start
		key  int64
		want bool
	}{
		{"first write", 0, 1, true},
		{"too soon", 100 * time.Millisecond, 1, false},
		{"other driver unaffected", 100 * time.Millisecond, 2, true},
		{"just under gap", 499 * time.Millisecond, 1, false},
		{"exactly at gap", 500 * time.Millisecond, 1, true},
		{"rejected tries do not reset the timer", 999 * time.Millisecond, 1, false},
		{"gap after last allowed write", 1000 * time.Millisecond, 1, true},
	}
	for _, s := range steps {
		now = start.Add(s.at)
		if got := l.allow(s.key); got != s.want {
			t.Fatalf("%s: allow(%d) at %v = %v, want %v", s.name, s.key, s.at, got, s.want)
		}
	}
}
