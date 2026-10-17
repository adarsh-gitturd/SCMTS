package handlers

import (
	"strings"
	"testing"
	"time"
)

func TestParsePassengers(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantOK     bool
		wantCount  int64
		wantStopID int64
	}{
		{"typical", `{"count": 18, "stop_id": 3}`, true, 18, 3},
		{"count 0", `{"count": 0, "stop_id": 3}`, true, 0, 3},
		{"count 200", `{"count": 200, "stop_id": 3}`, true, 200, 3},
		{"unknown field ignored", `{"count": 5, "stop_id": 1, "timestamp": "x"}`, true, 5, 1},
		{"count -1", `{"count": -1, "stop_id": 3}`, false, 0, 0},
		{"count 201", `{"count": 201, "stop_id": 3}`, false, 0, 0},
		{"missing count", `{"stop_id": 3}`, false, 0, 0},
		{"null count", `{"count": null, "stop_id": 3}`, false, 0, 0},
		{"missing stop_id", `{"count": 18}`, false, 0, 0},
		{"stop_id 0", `{"count": 18, "stop_id": 0}`, false, 0, 0},
		{"stop_id negative", `{"count": 18, "stop_id": -3}`, false, 0, 0},
		{"count float", `{"count": 18.5, "stop_id": 3}`, false, 0, 0},
		{"count 18.0", `{"count": 18.0, "stop_id": 3}`, false, 0, 0},
		{"count string", `{"count": "18", "stop_id": 3}`, false, 0, 0},
		{"stop_id float", `{"count": 18, "stop_id": 3.5}`, false, 0, 0},
		{"empty object", `{}`, false, 0, 0},
		{"malformed JSON", `{"count": 18,`, false, 0, 0},
		{"empty body", ``, false, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count, stopID, msg := parsePassengers(strings.NewReader(tt.body))
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
			if tt.wantOK && (count != tt.wantCount || stopID != tt.wantStopID) {
				t.Fatalf("got count %d, stop_id %d", count, stopID)
			}
		})
	}
}

func TestPassengersRateLimit(t *testing.T) {
	start := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	now := start
	l := newRateLimiter(passengersMinGap, func() time.Time { return now })

	steps := []struct {
		name string
		at   time.Duration // since start
		key  int64
		want bool
	}{
		{"first log", 0, 1, true},
		{"double-click", 200 * time.Millisecond, 1, false},
		{"other driver unaffected", 200 * time.Millisecond, 2, true},
		{"just under 1 s", 999 * time.Millisecond, 1, false},
		{"exactly 1 s", time.Second, 1, true},
	}
	for _, s := range steps {
		now = start.Add(s.at)
		if got := l.allow(s.key); got != s.want {
			t.Fatalf("%s: allow(%d) at %v = %v, want %v", s.name, s.key, s.at, got, s.want)
		}
	}
}
