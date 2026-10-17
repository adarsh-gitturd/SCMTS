package main

import (
	"math"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"time"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

// testRoutes: three routes near campus, 2-5 stops, 1-2 buses each.
func testRoutes() []Route {
	return []Route{
		{ID: 1, Name: "R1", Buses: []int64{1, 2}, Stops: []Stop{
			{10, 10.0400, 76.3200}, {11, 10.0450, 76.3250}, {12, 10.0500, 76.3300}, {13, 10.0560, 76.3350}, {14, 10.0700, 76.3500}}},
		{ID: 2, Name: "R2", Buses: []int64{3}, Stops: []Stop{
			{20, 10.0300, 76.3100}, {21, 10.0350, 76.3150}, {22, 10.0420, 76.3180}}},
		{ID: 5, Name: "R5", Buses: []int64{7}, Stops: []Stop{
			{50, 10.0600, 76.3000}, {51, 10.0610, 76.3020}}},
	}
}

// now is 00:30 on Sat 17 Oct 2026 in Kolkata, so yesterday ends ~2 h earlier.
var testNow = time.Date(2026, 10, 16, 19, 0, 0, 0, time.UTC)

func TestUsableRoutes(t *testing.T) {
	all := append(testRoutes(),
		Route{ID: 8, Name: "One stop", Buses: []int64{9}, Stops: []Stop{{80, 10, 76}}},
		Route{ID: 9, Name: "No bus", Stops: []Stop{{90, 10, 76}, {91, 10.01, 76}}})
	usable, skipped := usableRoutes(all)
	if len(usable) != 3 {
		t.Errorf("usable = %d routes, want 3", len(usable))
	}
	want := []string{"8 One stop (1 stop)", "9 No bus (no bus)"}
	if !reflect.DeepEqual(skipped, want) {
		t.Errorf("skipped = %q, want %q", skipped, want)
	}
}

func TestDemandWeights(t *testing.T) {
	if got := dayFactor(time.Saturday) / dayFactor(time.Monday); got != 0.30 {
		t.Errorf("Saturday/Monday factor = %v, want 0.30", got)
	}
	if dayFactor(time.Sunday) != dayFactor(time.Saturday) || dayFactor(time.Friday) != 1 {
		t.Error("weekend factors differ or Friday is not 1")
	}
	for _, peak := range []int{8, 13, 17} {
		for _, night := range []int{20, 21} {
			if hourWeight[peak] <= 2*hourWeight[night] {
				t.Errorf("peak hour %d weight %v not well above night hour %d weight %v",
					peak, hourWeight[peak], night, hourWeight[night])
			}
		}
	}
	for h, w := range hourWeight {
		lo, hi := hourWindow(h)
		if w > 0 && lo >= hi {
			t.Errorf("hour %d has weight %v but an empty window", h, w)
		}
		if w == 0 && lo < hi {
			t.Errorf("hour %d is inside the window but has weight 0", h)
		}
		if w > maxHourWeight {
			t.Errorf("hour %d weight %v > maxHourWeight", h, w)
		}
	}
}

func TestTimeContext(t *testing.T) {
	kolkata := mustLoc(t, "Asia/Kolkata")
	tests := []struct {
		utc           string
		loc           *time.Location
		hour, weekday int
	}{
		// Sunday 20:00 UTC is already Monday 01:30 in Kolkata.
		{"2026-10-11T20:00:00Z", kolkata, 1, 1},
		// Saturday 18:29:59 UTC is Saturday 23:59:59; one second later Sunday (7).
		{"2026-10-17T18:29:59Z", kolkata, 23, 6},
		{"2026-10-17T18:30:00Z", kolkata, 0, 7},
		{"2026-10-12T02:30:00Z", kolkata, 8, 1},
		{"2026-10-12T02:30:00Z", time.UTC, 2, 1},
	}
	for _, tc := range tests {
		ts, err := time.Parse(time.RFC3339, tc.utc)
		if err != nil {
			t.Fatal(err)
		}
		h, wd := timeContext(ts, tc.loc)
		if h != tc.hour || wd != tc.weekday {
			t.Errorf("timeContext(%s, %s) = %d, %d; want %d, %d", tc.utc, tc.loc, h, wd, tc.hour, tc.weekday)
		}
	}
}

func TestStartTimes(t *testing.T) {
	// Auckland (UTC+13 in October): local mornings are the previous UTC day,
	// so the stored weekday must follow the local date, not the UTC date.
	for _, zone := range []string{"Asia/Kolkata", "Pacific/Auckland", "America/New_York"} {
		t.Run(zone, func(t *testing.T) {
			loc := mustLoc(t, zone)
			res, err := Generate(testRoutes(), Options{Days: 30, PerDay: 100, Students: 5}, testNow, loc, 7)
			if err != nil {
				t.Fatal(err)
			}
			ty, tm, td := testNow.In(loc).Date()
			today := time.Date(ty, tm, td, 0, 0, 0, 0, loc)
			first := time.Date(ty, tm, td-30, 0, 0, 0, 0, loc)
			prevUTCDay := 0
			for _, tr := range res.Trips {
				lt := tr.StartedAt.In(loc)
				m := lt.Hour()*60 + lt.Minute()
				if m < windowStartMin || m >= windowEndMin {
					t.Fatalf("start %s outside 06:30-21:30", lt)
				}
				if !tr.StartedAt.Before(today) || tr.StartedAt.Before(first) {
					t.Fatalf("start %s not in [today-30, today)", lt)
				}
				if tr.StartedAt.Location() != time.UTC {
					t.Fatalf("StartedAt not UTC: %v", tr.StartedAt.Location())
				}
				wantWd := int(lt.Weekday())
				if wantWd == 0 {
					wantWd = 7
				}
				if tr.StartHour != lt.Hour() || tr.StartWeekday != wantWd {
					t.Fatalf("context %d/%d for local %s", tr.StartHour, tr.StartWeekday, lt)
				}
				if tr.StartedAt.Day() != lt.Day() {
					prevUTCDay++
				}
			}
			if zone == "Pacific/Auckland" && prevUTCDay == 0 {
				t.Error("expected some Auckland trips on the previous UTC day")
			}
		})
	}
}

func meanDelay(n int, hour int, worse, delayed bool) float64 {
	rng := rand.New(rand.NewSource(42))
	sum := 0.0
	for i := 0; i < n; i++ {
		sum += modelDelay(rng, hour, worse, delayed)
	}
	return sum / float64(n)
}

func TestDelayModel(t *testing.T) {
	const n = 10000
	base := meanDelay(n, 20, false, false)
	tests := []struct {
		name     string
		got      float64
		wantDiff float64
	}{
		{"rush 17:00 vs night 20:00", meanDelay(n, 17, false, false), rushExtraMin[17]},
		{"worse route", meanDelay(n, 20, true, false), worseRouteExtraMin},
		{"status delayed", meanDelay(n, 20, false, true), delayedExtraMin},
	}
	if math.Abs(base) > 0.1 {
		t.Errorf("night, normal route, on_route mean = %.2f, want about 0", base)
	}
	for _, tc := range tests {
		if diff := tc.got - base; math.Abs(diff-tc.wantDiff) > 0.15 {
			t.Errorf("%s: mean %.2f - base %.2f = %.2f, want about %.1f", tc.name, tc.got, base, diff, tc.wantDiff)
		}
	}
	// Noise can make a delay negative (early) and is clamped.
	rng := rand.New(rand.NewSource(1))
	neg := false
	for i := 0; i < n; i++ {
		d := modelDelay(rng, 20, false, false)
		if d < 0 {
			neg = true
		}
		if math.Abs(d) > noiseMaxMin {
			t.Fatalf("delay %.2f beyond noise clamp", d)
		}
	}
	if !neg {
		t.Error("no negative delays")
	}
}

func TestRatingFollowsDelay(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	avg := func(delay float64) float64 {
		sum := 0
		for i := 0; i < 5000; i++ {
			r := modelRating(rng, delay)
			if r < 1 || r > 5 {
				t.Fatalf("rating %d out of 1..5", r)
			}
			sum += r
		}
		return float64(sum) / 5000
	}
	early, late := avg(-1), avg(10)
	if early <= late+1.5 {
		t.Errorf("avg rating early %.2f, late %.2f: want early much higher", early, late)
	}
}

func TestGeneratedTripInvariants(t *testing.T) {
	loc := mustLoc(t, "Asia/Kolkata")
	routes := testRoutes()
	res, err := Generate(routes, Options{Days: 90, PerDay: 150, Students: 20}, testNow, loc, 11)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Trips) < 10000 {
		t.Fatalf("only %d trips, want >= 10000", len(res.Trips))
	}
	byID := map[int64]Route{}
	for _, r := range routes {
		byID[r.ID] = r
	}
	students := map[int]bool{}
	for i, tr := range res.Trips {
		r := byID[tr.RouteID]
		switch {
		case i > 0 && tr.StartedAt.Before(res.Trips[i-1].StartedAt):
			t.Fatalf("trip %d: not sorted by started_at", i)
		case tr.StartHour < 0 || tr.StartHour > 23 || tr.StartWeekday < 1 || tr.StartWeekday > 7:
			t.Fatalf("trip %d: hour %d weekday %d", i, tr.StartHour, tr.StartWeekday)
		case tr.BoardIdx >= tr.DestIdx || tr.DestIdx >= len(r.Stops):
			t.Fatalf("trip %d: board %d dest %d of %d stops", i, tr.BoardIdx, tr.DestIdx, len(r.Stops))
		case tr.BoardStopID != r.Stops[tr.BoardIdx].ID || tr.DestStopID != r.Stops[tr.DestIdx].ID:
			t.Fatalf("trip %d: stop ids do not match the route", i)
		case !contains(r.Buses, tr.BusID):
			t.Fatalf("trip %d: bus %d not on route %d", i, tr.BusID, tr.RouteID)
		case tr.BusStatus != "on_route" && tr.BusStatus != "delayed":
			t.Fatalf("trip %d: bus status %q", i, tr.BusStatus)
		case tr.PredictedETA < etaMin || tr.PredictedETA > etaMax:
			t.Fatalf("trip %d: eta %d", i, tr.PredictedETA)
		case tr.Passengers != nil && (*tr.Passengers < 0 || *tr.Passengers > passengersMax):
			t.Fatalf("trip %d: passengers %d", i, *tr.Passengers)
		case tr.Student < 0 || tr.Student >= 20:
			t.Fatalf("trip %d: student %d", i, tr.Student)
		}
		if d := haversineM(r.Stops[tr.BoardIdx].Lat, r.Stops[tr.BoardIdx].Lng, tr.OriginLat, tr.OriginLng); d > 150 {
			t.Fatalf("trip %d: origin %.0f m from board stop", i, d)
		}
		switch tr.Status {
		case "completed":
			if tr.EndedAt == nil || !tr.EndedAt.After(tr.StartedAt) || tr.EndedAt.After(testNow) {
				t.Fatalf("trip %d: completed with ended_at %v (start %v)", i, tr.EndedAt, tr.StartedAt)
			}
			if tr.EndedAt.Sub(tr.StartedAt) < minDurationSec*time.Second {
				t.Fatalf("trip %d: duration under 1 minute", i)
			}
		case "started":
			if tr.EndedAt != nil || tr.Rating != nil {
				t.Fatalf("trip %d: started trip has ended_at or rating", i)
			}
		default:
			t.Fatalf("trip %d: status %q", i, tr.Status)
		}
		if tr.Rating != nil && (*tr.Rating < 1 || *tr.Rating > 5) {
			t.Fatalf("trip %d: rating %d", i, *tr.Rating)
		}
		if tr.Feedback != nil && tr.Rating == nil {
			t.Fatalf("trip %d: feedback without rating", i)
		}
		if tr.Feedback != nil && *tr.Feedback != slowFeedback && !containsStr(neutralFeedback, *tr.Feedback) {
			t.Fatalf("trip %d: feedback %q not from the fixed list", i, *tr.Feedback)
		}
		students[tr.Student] = true
	}

	// Rough shares (the model's documented rates) and the worse route.
	s := Summarize(res.Trips)
	share := func(n, of int) float64 { return float64(n) / float64(of) }
	checks := []struct {
		name    string
		got, lo float64
		hi      float64
	}{
		{"completed", share(s.Completed, s.Total), 0.90, 0.94},
		{"rated of completed", share(s.Rated, s.Completed), 0.42, 0.48},
		{"delayed at start", share(s.Delayed, s.Total), 0.12, 0.18},
		{"passengers NULL", share(s.PassengersNull, s.Total), 0.22, 0.28},
	}
	for _, c := range checks {
		if c.got < c.lo || c.got > c.hi {
			t.Errorf("%s share = %.3f, want %.2f..%.2f", c.name, c.got, c.lo, c.hi)
		}
	}
	for _, rs := range s.PerRoute {
		if rs.RouteID != res.WorseRoute {
			worse := s.PerRoute[indexOfRoute(s.PerRoute, res.WorseRoute)]
			if worse.AvgDelay < rs.AvgDelay+3 {
				t.Errorf("worse route %d avg delay %.2f not ~4 above route %d (%.2f)",
					worse.RouteID, worse.AvgDelay, rs.RouteID, rs.AvgDelay)
			}
		}
	}
	if s.PerHour[17].AvgDelay <= s.PerHour[20].AvgDelay+3 {
		t.Errorf("17:00 avg delay %.2f not above 20:00 %.2f", s.PerHour[17].AvgDelay, s.PerHour[20].AvgDelay)
	}
	if len(students) != 20 {
		t.Errorf("trips use %d of 20 students", len(students))
	}
}

func TestGenerateDeterministic(t *testing.T) {
	loc := mustLoc(t, "Asia/Kolkata")
	opts := Options{Days: 14, PerDay: 40, Students: 10}
	a, err := Generate(testRoutes(), opts, testNow, loc, 5)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Generate(testRoutes(), opts, testNow, loc, 5)
	c, _ := Generate(testRoutes(), opts, testNow, loc, 6)
	if !reflect.DeepEqual(a, b) {
		t.Error("same seed gave different output")
	}
	if reflect.DeepEqual(a.Trips, c.Trips) {
		t.Error("different seed gave the same output")
	}
}

func TestGenerateLimits(t *testing.T) {
	loc := mustLoc(t, "Asia/Kolkata")
	if _, err := Generate(testRoutes(), Options{Days: 365, PerDay: 500, Students: 1}, testNow, loc, 1); err == nil ||
		!strings.Contains(err.Error(), "cap") {
		t.Errorf("over the cap: err = %v, want cap error", err)
	}
	if _, err := Generate(nil, Options{Days: 1, PerDay: 1, Students: 1}, testNow, loc, 1); err == nil {
		t.Error("no routes: want error")
	}
	res, err := Generate(testRoutes(), Options{Days: 1, PerDay: 10, Students: 1}, testNow, loc, 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.From != "2026-10-16" || res.To != "2026-10-16" {
		t.Errorf("1 day = %s..%s, want yesterday 2026-10-16 only", res.From, res.To)
	}
}

func TestBuildTripsInsert(t *testing.T) {
	loc := mustLoc(t, "Asia/Kolkata")
	res, err := Generate(testRoutes(), Options{Days: 3, PerDay: 10, Students: 2}, testNow, loc, 1)
	if err != nil {
		t.Fatal(err)
	}
	query, args := buildTripsInsert(res.Trips, []int64{901, 902})
	cols := strings.Count(tripColumns, ",") + 1
	if cols != 17 || strings.Count(tripPlaceholders, "?") != cols {
		t.Fatalf("columns %d, placeholders %d", cols, strings.Count(tripPlaceholders, "?"))
	}
	if strings.Count(query, "?") != len(args) || len(args) != cols*len(res.Trips) {
		t.Errorf("placeholders %d, args %d, trips %d", strings.Count(query, "?"), len(args), len(res.Trips))
	}
	if batchSize*cols > 65535 {
		t.Errorf("a full batch needs %d placeholders, over MySQL's 65535", batchSize*cols)
	}
	for i, tr := range res.Trips {
		row := args[i*cols : (i+1)*cols]
		if row[0] != []int64{901, 902}[tr.Student] {
			t.Fatalf("row %d student_id %v", i, row[0])
		}
		if (tr.EndedAt == nil) != (row[11] == nil) || (tr.Rating == nil) != (row[8] == nil) {
			t.Fatalf("row %d: NULLs not kept", i)
		}
	}
}

func contains(s []int64, v int64) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func containsStr(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func indexOfRoute(s []RouteStat, id int64) int {
	for i, r := range s {
		if r.RouteID == id {
			return i
		}
	}
	return -1
}
