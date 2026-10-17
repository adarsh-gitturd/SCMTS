package handlers

import (
	"math"
	"strings"
	"testing"
)

func strPtr(s string) *string   { return &s }
func f64Ptr(v float64) *float64 { return &v }

func TestValidateStop(t *testing.T) {
	name := func(s string) adminStopRequest {
		return adminStopRequest{Name: strPtr(s), Lat: f64Ptr(13.0102), Lng: f64Ptr(80.2355)}
	}
	coords := func(lat, lng float64) adminStopRequest {
		return adminStopRequest{Name: strPtr("Library"), Lat: f64Ptr(lat), Lng: f64Ptr(lng)}
	}
	tests := []struct {
		name    string
		req     adminStopRequest
		wantOK  bool
		wantOut stopInput
	}{
		{"typical", name("Library"), true, stopInput{"Library", 13.0102, 80.2355}},
		{"trimmed", name("  Library \t"), true, stopInput{"Library", 13.0102, 80.2355}},
		{"empty name", name(""), false, stopInput{}},
		{"whitespace only", name(" \t\n "), false, stopInput{}},
		{"100 ascii", name(strings.Repeat("a", 100)), true, stopInput{strings.Repeat("a", 100), 13.0102, 80.2355}},
		{"101 ascii", name(strings.Repeat("a", 101)), false, stopInput{}},
		{"100 two-byte", name(strings.Repeat("é", 100)), true, stopInput{strings.Repeat("é", 100), 13.0102, 80.2355}},
		{"101 two-byte", name(strings.Repeat("é", 101)), false, stopInput{}},
		{"100 tamil", name(strings.Repeat("நூ", 50)), true, stopInput{strings.Repeat("நூ", 50), 13.0102, 80.2355}},
		{"100 emoji", name(strings.Repeat("🚌", 100)), true, stopInput{strings.Repeat("🚌", 100), 13.0102, 80.2355}},
		{"101 emoji", name(strings.Repeat("🚌", 101)), false, stopInput{}},
		{"inner tab", name("Main\tGate"), false, stopInput{}},
		{"inner newline", name("Main\nGate"), false, stopInput{}},
		{"NUL", name("Main\x00Gate"), false, stopInput{}},
		{"DEL", name("Main\x7fGate"), false, stopInput{}},
		{"C1 U+0085", name("Main\u0085Gate"), false, stopInput{}},
		{"lat 90", coords(90, 0), true, stopInput{"Library", 90, 0}},
		{"lat -90", coords(-90, 0), true, stopInput{"Library", -90, 0}},
		{"lat 90.000001", coords(90.000001, 0), false, stopInput{}},
		{"lat -90.000001", coords(-90.000001, 0), false, stopInput{}},
		{"lng 180", coords(0, 180), true, stopInput{"Library", 0, 180}},
		{"lng -180", coords(0, -180), true, stopInput{"Library", 0, -180}},
		{"lng 180.000001", coords(0, 180.000001), false, stopInput{}},
		{"lng -180.000001", coords(0, -180.000001), false, stopInput{}},
		{"lat NaN", coords(math.NaN(), 0), false, stopInput{}},
		{"lng NaN", coords(0, math.NaN()), false, stopInput{}},
		{"lat +Inf", coords(math.Inf(1), 0), false, stopInput{}},
		{"lng -Inf", coords(0, math.Inf(-1)), false, stopInput{}},
		{"lat 90.0000004 beyond", coords(90.0000004, 0), false, stopInput{}},
		{"round up", coords(13.01023456, 80.2355), true, stopInput{"Library", 13.010235, 80.2355}},
		{"round down", coords(13.0102341, -80.2355449), true, stopInput{"Library", 13.010234, -80.235545}},
		{"round to bound", coords(89.9999996, 0), true, stopInput{"Library", 90, 0}},
		{"missing name", adminStopRequest{Lat: f64Ptr(1), Lng: f64Ptr(1)}, false, stopInput{}},
		{"missing lat", adminStopRequest{Name: strPtr("A"), Lng: f64Ptr(1)}, false, stopInput{}},
		{"missing lng", adminStopRequest{Name: strPtr("A"), Lat: f64Ptr(1)}, false, stopInput{}},
		{"all missing", adminStopRequest{}, false, stopInput{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, msg := validateStop(tt.req)
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
			if out != tt.wantOut {
				t.Errorf("out = %+v, want %+v", out, tt.wantOut)
			}
		})
	}
}

func TestParseStopBody(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"typical", `{"name": "Library", "lat": 13.0102, "lng": 80.2355}`, true},
		{"unknown field ignored", `{"name": "Library", "lat": 13, "lng": 80, "id": 9}`, true},
		{"null name", `{"name": null, "lat": 13, "lng": 80}`, false},
		{"null lat", `{"name": "A", "lat": null, "lng": 80}`, false},
		{"missing lng", `{"name": "A", "lat": 13}`, false},
		{"name number", `{"name": 5, "lat": 13, "lng": 80}`, false},
		{"lat string", `{"name": "A", "lat": "13", "lng": 80}`, false},
		{"lat overflow", `{"name": "A", "lat": 1e400, "lng": 80}`, false},
		{"escaped control", `{"name": "A\u0000B", "lat": 13, "lng": 80}`, false},
		{"empty object", `{}`, false},
		{"malformed JSON", `{"name": "A",`, false},
		{"empty body", ``, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, msg := parseStopBody(strings.NewReader(tt.body))
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
		})
	}
}

func TestParseStopID(t *testing.T) {
	tests := []struct {
		raw    string
		wantOK bool
		want   int64
	}{
		{"1", true, 1},
		{"42", true, 42},
		{"4294967295", true, 4294967295},
		{"0", false, 0},
		{"-1", false, 0},
		{"abc", false, 0},
		{"1.5", false, 0},
		{"", false, 0},
		{"+1", false, 0},
		{" 1", false, 0},
		{"4294967296", false, 0},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			id, ok := parseStopID(tt.raw)
			if ok != tt.wantOK || id != tt.want {
				t.Errorf("parseStopID(%q) = %d, %v; want %d, %v", tt.raw, id, ok, tt.want, tt.wantOK)
			}
		})
	}
}
