package handlers

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func intPtr(n int) *int { return &n }

func TestBuildFleet(t *testing.T) {
	now := time.Date(2026, 10, 17, 10, 56, 14, 0, time.UTC)
	upd := time.Date(2026, 10, 17, 10, 56, 11, 0, time.UTC)

	full := fleetRow{
		BusID:      sql.NullInt64{Int64: 1, Valid: true},
		Plate:      sql.NullString{String: "KL-07-CB-1101", Valid: true},
		RouteID:    sql.NullInt64{Int64: 1, Valid: true},
		RouteName:  sql.NullString{String: "Main Gate - Hostel", Valid: true},
		DriverID:   sql.NullInt64{Int64: 9, Valid: true},
		DriverName: sql.NullString{String: "Ravi", Valid: true},
		LiveBusID:  sql.NullInt64{Int64: 1, Valid: true},
		Lat:        sql.NullFloat64{Float64: 10.0436, Valid: true},
		Lng:        sql.NullFloat64{Float64: 76.3241, Valid: true},
		Speed:      sql.NullFloat64{Float64: 22, Valid: true},
		Status:     sql.NullString{String: "on_route", Valid: true},
		UpdatedAt:  sql.NullTime{Time: upd, Valid: true},
	}
	fullBus := fleetBus{
		BusID: 1, Plate: "KL-07-CB-1101",
		RouteID: intPtr(1), RouteName: strPtr("Main Gate - Hostel"),
		DriverID: intPtr(9), DriverName: strPtr("Ravi"),
		Live: &fleetLive{Lat: 10.0436, Lng: 76.3241, Speed: 22, Status: "on_route", UpdatedAt: upd},
	}

	bare := fleetRow{
		BusID: sql.NullInt64{Int64: 2, Valid: true},
		Plate: sql.NullString{String: "KL-07-CB-1102", Valid: true},
	}
	bareBus := fleetBus{BusID: 2, Plate: "KL-07-CB-1102"}

	// Live columns set but LiveBusID NULL: live must still be null.
	noLiveID := bare
	noLiveID.Lat = sql.NullFloat64{Float64: 10, Valid: true}
	noLiveID.Status = sql.NullString{String: "on_route", Valid: true}

	// Live row with lat 0: live must not be dropped.
	zeroLat := full
	zeroLat.Lat = sql.NullFloat64{Float64: 0, Valid: true}
	zeroLatBus := fullBus
	zeroLatBus.Live = &fleetLive{Lat: 0, Lng: 76.3241, Speed: 22, Status: "on_route", UpdatedAt: upd}

	tests := []struct {
		name string
		rows []fleetRow
		want []fleetBus
	}{
		{"nil rows", nil, []fleetBus{}},
		{"no buses row skipped", []fleetRow{{}}, []fleetBus{}},
		{"full row", []fleetRow{full}, []fleetBus{fullBus}},
		{"no live, route or driver", []fleetRow{bare}, []fleetBus{bareBus}},
		{"live decided by bus_live.bus_id", []fleetRow{noLiveID}, []fleetBus{bareBus}},
		{"lat zero keeps live", []fleetRow{zeroLat}, []fleetBus{zeroLatBus}},
		{"order kept", []fleetRow{full, bare}, []fleetBus{fullBus, bareBus}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildFleet(now, tt.rows)
			if !got.ServerTime.Equal(now) {
				t.Errorf("server_time = %v, want %v", got.ServerTime, now)
			}
			if got.Buses == nil {
				t.Fatal("buses is nil, want non-nil slice")
			}
			if !reflect.DeepEqual(got.Buses, tt.want) {
				t.Errorf("buses = %+v, want %+v", got.Buses, tt.want)
			}
		})
	}
}

func TestBuildFleetJSON(t *testing.T) {
	now := time.Date(2026, 10, 17, 10, 56, 14, 0, time.UTC)
	tests := []struct {
		name string
		rows []fleetRow
		want string
	}{
		{"empty fleet", nil, `{"server_time":"2026-10-17T10:56:14Z","buses":[]}`},
		{"bus with nulls", []fleetRow{{
			BusID: sql.NullInt64{Int64: 2, Valid: true},
			Plate: sql.NullString{String: "KL-07-CB-1102", Valid: true},
		}}, `{"server_time":"2026-10-17T10:56:14Z","buses":[{"bus_id":2,"plate":"KL-07-CB-1102",` +
			`"route_id":null,"route_name":null,"driver_id":null,"driver_name":null,"live":null}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(buildFleet(now, tt.rows))
			if err != nil {
				t.Fatal(err)
			}
			if got := string(b); got != tt.want {
				t.Errorf("json = %s\nwant   %s", got, tt.want)
			}
			for _, bad := range []string{"email", "password", "role"} {
				if strings.Contains(string(b), bad) {
					t.Errorf("json contains %q", bad)
				}
			}
		})
	}
}
