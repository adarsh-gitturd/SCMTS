package handlers

import (
	"reflect"
	"strings"
	"testing"
)

// seq returns the stop ids 1..n.
func seq(n int) []int64 {
	s := make([]int64, n)
	for i := range s {
		s[i] = int64(i + 1)
	}
	return s
}

func TestValidateRoute(t *testing.T) {
	name := func(s string) adminRouteRequest {
		return adminRouteRequest{Name: strPtr(s), Stops: []int64{3, 5, 1}}
	}
	stops := func(ids []int64) adminRouteRequest {
		return adminRouteRequest{Name: strPtr("Main Gate - Hostel"), Stops: ids}
	}
	tests := []struct {
		name    string
		req     adminRouteRequest
		wantOK  bool
		wantOut routeInput
	}{
		{"typical", name("Main Gate - Hostel"), true, routeInput{"Main Gate - Hostel", []int64{3, 5, 1}}},
		{"trimmed", name("  Main Gate \t"), true, routeInput{"Main Gate", []int64{3, 5, 1}}},
		{"empty name", name(""), false, routeInput{}},
		{"whitespace only", name(" \t\n "), false, routeInput{}},
		{"100 ascii", name(strings.Repeat("a", 100)), true, routeInput{strings.Repeat("a", 100), []int64{3, 5, 1}}},
		{"101 ascii", name(strings.Repeat("a", 101)), false, routeInput{}},
		{"100 two-byte", name(strings.Repeat("é", 100)), true, routeInput{strings.Repeat("é", 100), []int64{3, 5, 1}}},
		{"101 two-byte", name(strings.Repeat("é", 101)), false, routeInput{}},
		{"100 tamil", name(strings.Repeat("நூ", 50)), true, routeInput{strings.Repeat("நூ", 50), []int64{3, 5, 1}}},
		{"100 emoji", name(strings.Repeat("🚌", 100)), true, routeInput{strings.Repeat("🚌", 100), []int64{3, 5, 1}}},
		{"101 emoji", name(strings.Repeat("🚌", 101)), false, routeInput{}},
		{"inner tab", name("Main\tGate"), false, routeInput{}},
		{"inner newline", name("Main\nGate"), false, routeInput{}},
		{"NUL", name("Main\x00Gate"), false, routeInput{}},
		{"DEL", name("Main\x7fGate"), false, routeInput{}},
		{"C1 U+0085", name("Main\u0085Gate"), false, routeInput{}},
		{"empty stops", stops([]int64{}), true, routeInput{"Main Gate - Hostel", []int64{}}},
		{"one stop", stops([]int64{7}), true, routeInput{"Main Gate - Hostel", []int64{7}}},
		{"50 stops", stops(seq(50)), true, routeInput{"Main Gate - Hostel", seq(50)}},
		{"51 stops", stops(seq(51)), false, routeInput{}},
		{"duplicate", stops([]int64{2, 4, 2}), false, routeInput{}},
		{"duplicate adjacent", stops([]int64{4, 4}), false, routeInput{}},
		{"id 0", stops([]int64{1, 0}), false, routeInput{}},
		{"negative id", stops([]int64{-3}), false, routeInput{}},
		{"max uint32", stops([]int64{4294967295}), true, routeInput{"Main Gate - Hostel", []int64{4294967295}}},
		{"above uint32", stops([]int64{4294967296}), false, routeInput{}},
		{"nil stops", stops(nil), false, routeInput{}},
		{"missing name", adminRouteRequest{Stops: []int64{1}}, false, routeInput{}},
		{"all missing", adminRouteRequest{}, false, routeInput{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, msg := validateRoute(tt.req)
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
			if !reflect.DeepEqual(out, tt.wantOut) {
				t.Errorf("out = %+v, want %+v", out, tt.wantOut)
			}
		})
	}
}

func TestParseRouteBody(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"typical", `{"name": "Main Gate - Hostel", "stops": [3, 5, 1]}`, true},
		{"empty stops", `{"name": "A", "stops": []}`, true},
		{"unknown field ignored", `{"name": "A", "stops": [1], "id": 9}`, true},
		{"missing stops", `{"name": "A"}`, false},
		{"null stops", `{"name": "A", "stops": null}`, false},
		{"missing name", `{"stops": [1]}`, false},
		{"null name", `{"name": null, "stops": [1]}`, false},
		{"stops not array", `{"name": "A", "stops": 1}`, false},
		{"fractional id", `{"name": "A", "stops": [1.5]}`, false},
		{"string id", `{"name": "A", "stops": ["3"]}`, false},
		{"null id", `{"name": "A", "stops": [1, null]}`, false}, // decodes as 0, rejected
		{"duplicate", `{"name": "A", "stops": [2, 2]}`, false},
		{"escaped control", `{"name": "A\u0000B", "stops": []}`, false},
		{"empty object", `{}`, false},
		{"malformed JSON", `{"name": "A",`, false},
		{"empty body", ``, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, msg := parseRouteBody(strings.NewReader(tt.body))
			if (msg == "") != tt.wantOK {
				t.Fatalf("msg = %q, wantOK %v", msg, tt.wantOK)
			}
		})
	}
}

func TestBuildRouteStopsInsert(t *testing.T) {
	tests := []struct {
		name     string
		stops    []int64
		wantArgs []any
	}{
		{"nil", nil, nil},
		{"empty", []int64{}, nil},
		{"one", []int64{7}, []any{int64(9), int64(7), 1}},
		{"order is 1-based position", []int64{3, 5, 1}, []any{
			int64(9), int64(3), 1,
			int64(9), int64(5), 2,
			int64(9), int64(1), 3,
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query, args := buildRouteStopsInsert(9, tt.stops)
			if len(tt.stops) == 0 {
				if query != "" || args != nil {
					t.Fatalf("got %q, %v; want empty", query, args)
				}
				return
			}
			if !strings.HasPrefix(query, "INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?, ?, ?)") {
				t.Errorf("query = %q", query)
			}
			if n := strings.Count(query, "?"); n != len(args) {
				t.Errorf("%d placeholders, %d args", n, len(args))
			}
			if !reflect.DeepEqual(args, tt.wantArgs) {
				t.Errorf("args = %v, want %v", args, tt.wantArgs)
			}
		})
	}

	// 50 stops: 150 placeholders and args, last order is 50.
	query, args := buildRouteStopsInsert(1, seq(50))
	if n := strings.Count(query, "?"); n != 150 || len(args) != 150 {
		t.Errorf("50 stops: %d placeholders, %d args; want 150", n, len(args))
	}
	if last := args[len(args)-1]; last != 50 {
		t.Errorf("50 stops: last order = %v, want 50", last)
	}
}
