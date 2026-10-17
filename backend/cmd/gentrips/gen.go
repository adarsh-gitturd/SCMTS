package main

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"
)

// Generation model. Every number that shapes the data is here; the code
// below only combines them. Times are campus local (CAMPUS_TZ).
const (
	maxTotalTrips = 50000

	// Day volume: weekdays get -per-day on average, weekends weekendFactor
	// of that; each day is scaled by a uniform factor in 1 +/- dayJitter.
	weekendFactor = 0.30
	dayJitter     = 0.15

	// Trips start in [windowStartMin, windowEndMin) minutes after local midnight.
	windowStartMin = 6*60 + 30 // 06:30
	windowEndMin   = 21*60 + 30

	// bus_status_at_start: delayed with these probabilities (rush hours are
	// the hours with rushExtraMin > 0), otherwise on_route. Never break or
	// out_of_service: those buses are not recommended.
	delayedProbRush  = 0.22
	delayedProbOther = 0.07

	// Delay in minutes = rushExtraMin[hour] + worseRouteExtraMin (one route
	// picked by the seed) + delayedExtraMin (status delayed) + noise, where
	// noise ~ N(0, noiseSD) clamped to +/- noiseMaxMin. Negative = early.
	worseRouteExtraMin = 4.0
	delayedExtraMin    = 3.0
	noiseSD            = 1.5
	noiseMaxMin        = 6.0

	// predicted_eta_min is a WHOLE-TRIP estimate (unlike real trips, where it
	// is the bus's ETA to the boarding stop): etaWaitMin + route distance from
	// board to destination stop at etaSpeedKmh, rounded, clamped to etaMin..etaMax.
	etaWaitMin  = 3.0
	etaSpeedKmh = 20.0
	etaMin      = 3
	etaMax      = 25

	// Outcomes. Duration = predicted ETA + delay, at least minDurationSec.
	completedProb  = 0.92 // the rest stay 'started' (abandoned), ended_at NULL
	ratedProb      = 0.45 // of completed trips
	feedbackProb   = 0.10 // of rated trips
	ratingNoiseSD  = 0.7
	minDurationSec = 60

	// passengers_logged: NULL with passengersNullProb ("no log in the last 30
	// minutes"), else passengersBase + passengersPeak*hourWeight/maxHourWeight
	// + N(0, passengersSD), clamped to 0..passengersMax.
	passengersNullProb = 0.25
	passengersBase     = 8.0
	passengersPeak     = 30.0
	passengersSD       = 5.0
	passengersMax      = 45

	// Origins are the board stop plus a random offset of at most originMaxM.
	originMaxM = 140.0

	// Route popularity: each route gets weight popMin + popSpan*U(0,1) from the seed.
	popMin  = 0.6
	popSpan = 0.8
)

// hourWeight is the relative demand per start hour (same shape every day).
// Hours 6 and 21 only cover 06:30-06:59 and 21:00-21:29. Peaks: 08-09,
// 13, 17-18; low late evening.
var hourWeight = [24]float64{
	6: 2, 7: 6, 8: 10, 9: 8, 10: 4, 11: 4, 12: 6, 13: 8,
	14: 5, 15: 5, 16: 7, 17: 10, 18: 8, 19: 4, 20: 2, 21: 1,
}

const maxHourWeight = 10.0

// rushExtraMin is the extra delay (minutes) in rush hours; > 0 marks a rush hour.
var rushExtraMin = [24]float64{8: 4, 9: 2, 13: 2, 17: 5, 18: 3}

// ratingMeans maps a delay to a mean rating: the first row with
// delay <= maxDelay applies. Bigger delays give worse ratings.
var ratingMeans = []struct{ maxDelay, mean float64 }{
	{0, 4.5}, {2, 4.0}, {5, 3.2}, {8, 2.4}, {math.Inf(1), 1.7},
}

// Fixed feedback phrases (never random text). slowFeedback is used only when
// the delay is over slowFeedbackMin minutes.
var neutralFeedback = []string{
	"Smooth ride.", "No issues.", "Bus was a bit crowded.", "Arrived as shown in the app.",
}

const (
	slowFeedback    = "Took longer than expected."
	slowFeedbackMin = 5.0
)

// Stop is a route stop with its coordinates.
type Stop struct {
	ID       int64
	Lat, Lng float64
}

// Route is a route with its stops in order and the buses assigned to it.
type Route struct {
	ID    int64
	Name  string
	Stops []Stop
	Buses []int64
}

// Options are the validated command-line sizes.
type Options struct {
	Days     int // dates from today-Days to yesterday (campus)
	PerDay   int // average trips on a weekday
	Students int // synthetic accounts; Trip.Student is 0..Students-1
}

// Trip is one generated trip. Nil pointers are NULL in the database.
type Trip struct {
	Student                 int // index into the synthetic students
	OriginLat, OriginLng    float64
	RouteID, BusID          int64
	BoardIdx, DestIdx       int // positions in the route's stops
	BoardStopID, DestStopID int64
	Status                  string // completed or started
	StartedAt               time.Time
	EndedAt                 *time.Time
	StartHour, StartWeekday int
	PredictedETA            int
	BusStatus               string
	Rating                  *int
	Feedback                *string
	Passengers              *int
}

// Result is the generated data plus what the summary needs.
type Result struct {
	Trips       []Trip // sorted by StartedAt
	From, To    string // campus dates, YYYY-MM-DD
	Weekdays    int
	WeekendDays int
	WorseRoute  int64
}

// usableRoutes keeps routes with at least 2 stops and a bus; skipped holds
// "id name (reason)" for the rest.
func usableRoutes(all []Route) (usable []Route, skipped []string) {
	for _, r := range all {
		switch {
		case len(r.Stops) < 2:
			skipped = append(skipped, fmt.Sprintf("%d %s (%d stop)", r.ID, r.Name, len(r.Stops)))
		case len(r.Buses) == 0:
			skipped = append(skipped, fmt.Sprintf("%d %s (no bus)", r.ID, r.Name))
		default:
			usable = append(usable, r)
		}
	}
	return usable, skipped
}

// timeContext returns the hour (0..23) and ISO weekday (1=Mon..7=Sun) of t
// in loc, like handlers.tripTimeContext.
func timeContext(t time.Time, loc *time.Location) (hour, isoWeekday int) {
	lt := t.In(loc)
	wd := int(lt.Weekday())
	if wd == 0 {
		wd = 7
	}
	return lt.Hour(), wd
}

// dayFactor is the volume factor of a weekday (1.0 Mon-Fri, weekendFactor Sat/Sun).
func dayFactor(wd time.Weekday) float64 {
	if wd == time.Saturday || wd == time.Sunday {
		return weekendFactor
	}
	return 1.0
}

// hourWindow returns the start-minute range [lo, hi) of hour h inside the
// daily window; lo >= hi means the hour gets no trips.
func hourWindow(h int) (lo, hi int) {
	return max(h*60, windowStartMin), min((h+1)*60, windowEndMin)
}

// pickWeighted returns an index with probability proportional to w[i].
func pickWeighted(rng *rand.Rand, w []float64) int {
	total := 0.0
	for _, v := range w {
		total += v
	}
	x := rng.Float64() * total
	for i, v := range w {
		if x < v {
			return i
		}
		x -= v
	}
	return len(w) - 1
}

// modelDelay draws the delay in minutes (see the constants above).
func modelDelay(rng *rand.Rand, hour int, worseRoute, delayed bool) float64 {
	d := rushExtraMin[hour]
	if worseRoute {
		d += worseRouteExtraMin
	}
	if delayed {
		d += delayedExtraMin
	}
	noise := math.Max(-noiseMaxMin, math.Min(noiseMaxMin, rng.NormFloat64()*noiseSD))
	return d + noise
}

// modelRating draws a rating 1..5 whose mean falls as the delay grows.
func modelRating(rng *rand.Rand, delay float64) int {
	mean := ratingMeans[len(ratingMeans)-1].mean
	for _, row := range ratingMeans {
		if delay <= row.maxDelay {
			mean = row.mean
			break
		}
	}
	r := int(math.Round(mean + rng.NormFloat64()*ratingNoiseSD))
	return max(1, min(5, r))
}

// haversineM is the great-circle distance in metres.
func haversineM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthR = 6371000.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthR * math.Asin(math.Sqrt(a))
}

// etaMinutes is the whole-trip ETA over stops (board first, destination last).
func etaMinutes(stops []Stop) int {
	dist := 0.0
	for i := 1; i < len(stops); i++ {
		dist += haversineM(stops[i-1].Lat, stops[i-1].Lng, stops[i].Lat, stops[i].Lng)
	}
	eta := int(math.Round(etaWaitMin + dist/(etaSpeedKmh*1000/60)))
	return max(etaMin, min(etaMax, eta))
}

// round6 rounds to 6 decimals (DECIMAL(9,6)).
func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }

// Generate builds the trips for opts from the usable routes, deterministic
// for a given seed, now and loc. Nothing is in the future: the last date is
// yesterday (campus) and no ended_at is after now.
func Generate(routes []Route, opts Options, now time.Time, loc *time.Location, seed int64) (Result, error) {
	if len(routes) == 0 {
		return Result{}, errors.New("no route with at least 2 stops and a bus")
	}
	rng := rand.New(rand.NewSource(seed))

	pop := make([]float64, len(routes))
	for i := range pop {
		pop[i] = popMin + popSpan*rng.Float64()
	}
	worse := rng.Intn(len(routes))
	hours := hourWeight[:]

	// Day counts first, so the cap is checked before any trip is built.
	type day struct {
		y    int
		m    time.Month
		d, n int
	}
	ty, tm, td := now.In(loc).Date()
	days := make([]day, 0, opts.Days)
	res := Result{WorseRoute: routes[worse].ID}
	total := 0
	for i := opts.Days; i >= 1; i-- {
		// Noon avoids DST gaps when normalising the date.
		date := time.Date(ty, tm, td-i, 12, 0, 0, 0, loc)
		f := dayFactor(date.Weekday())
		if f < 1 {
			res.WeekendDays++
		} else {
			res.Weekdays++
		}
		n := int(math.Round(float64(opts.PerDay) * f * (1 - dayJitter + 2*dayJitter*rng.Float64())))
		y, m, d := date.Date()
		days = append(days, day{y, m, d, n})
		total += n
	}
	if total > maxTotalTrips {
		return Result{}, fmt.Errorf("%d trips is over the cap of %d: lower -days or -per-day", total, maxTotalTrips)
	}
	if len(days) > 0 {
		first, last := days[0], days[len(days)-1]
		res.From = time.Date(first.y, first.m, first.d, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		res.To = time.Date(last.y, last.m, last.d, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}

	res.Trips = make([]Trip, 0, total)
	for _, dy := range days {
		for k := 0; k < dy.n; k++ {
			h := pickWeighted(rng, hours)
			lo, hi := hourWindow(h)
			minute := lo + rng.Intn(hi-lo)
			local := time.Date(dy.y, dy.m, dy.d, minute/60, minute%60, rng.Intn(60), 0, loc)
			t := Trip{StartedAt: local.UTC()}
			t.StartHour, t.StartWeekday = timeContext(t.StartedAt, loc)

			ri := pickWeighted(rng, pop)
			r := routes[ri]
			t.RouteID = r.ID
			t.BusID = r.Buses[rng.Intn(len(r.Buses))]
			t.BoardIdx = rng.Intn(len(r.Stops) - 1)
			t.DestIdx = t.BoardIdx + 1 + rng.Intn(len(r.Stops)-1-t.BoardIdx)
			board := r.Stops[t.BoardIdx]
			t.BoardStopID, t.DestStopID = board.ID, r.Stops[t.DestIdx].ID

			dist := originMaxM * math.Sqrt(rng.Float64())
			angle := 2 * math.Pi * rng.Float64()
			t.OriginLat = round6(board.Lat + dist*math.Cos(angle)/111320)
			t.OriginLng = round6(board.Lng + dist*math.Sin(angle)/(111320*math.Cos(board.Lat*math.Pi/180)))

			t.PredictedETA = etaMinutes(r.Stops[t.BoardIdx : t.DestIdx+1])
			pDelayed := delayedProbOther
			if rushExtraMin[t.StartHour] > 0 {
				pDelayed = delayedProbRush
			}
			delayed := rng.Float64() < pDelayed
			t.BusStatus = "on_route"
			if delayed {
				t.BusStatus = "delayed"
			}
			delay := modelDelay(rng, t.StartHour, ri == worse, delayed)

			t.Status = "started"
			if rng.Float64() < completedProb {
				sec := max(minDurationSec, int(math.Round((float64(t.PredictedETA)+delay)*60)))
				end := t.StartedAt.Add(time.Duration(sec) * time.Second)
				if !end.After(now) {
					t.Status = "completed"
					t.EndedAt = &end
				}
			}
			if t.Status == "completed" && rng.Float64() < ratedProb {
				rating := modelRating(rng, delay)
				t.Rating = &rating
				if rng.Float64() < feedbackProb {
					fb := neutralFeedback[rng.Intn(len(neutralFeedback))]
					if delay > slowFeedbackMin {
						fb = slowFeedback
					}
					t.Feedback = &fb
				}
			}
			if rng.Float64() >= passengersNullProb {
				p := passengersBase + passengersPeak*hourWeight[t.StartHour]/maxHourWeight + rng.NormFloat64()*passengersSD
				n := max(0, min(passengersMax, int(math.Round(p))))
				t.Passengers = &n
			}
			t.Student = rng.Intn(opts.Students)
			res.Trips = append(res.Trips, t)
		}
	}
	sort.SliceStable(res.Trips, func(i, j int) bool { return res.Trips[i].StartedAt.Before(res.Trips[j].StartedAt) })
	return res, nil
}

// storedDelayMin is the delay 4.2-A analytics will see:
// (ended_at - started_at) in minutes - predicted_eta_min.
func storedDelayMin(t Trip) float64 {
	return t.EndedAt.Sub(t.StartedAt).Minutes() - float64(t.PredictedETA)
}

// RouteStat and HourStat are summary rows; AvgDelay is over completed trips.
type RouteStat struct {
	RouteID   int64
	Trips     int
	Completed int
	AvgDelay  float64
}

type HourStat struct {
	Trips     int
	Completed int
	AvgDelay  float64
}

// Summary holds the dry-run numbers.
type Summary struct {
	Total, Completed, Abandoned, Rated, Feedback, PassengersNull, Delayed int
	Ratings                                                               [6]int // index 1..5
	PerRoute                                                              []RouteStat
	PerHour                                                               [24]HourStat
}

// Summarize counts the generated trips; PerRoute is ordered by route id.
func Summarize(trips []Trip) Summary {
	var s Summary
	routes := map[int64]*RouteStat{}
	for _, t := range trips {
		s.Total++
		if t.BusStatus == "delayed" {
			s.Delayed++
		}
		if t.Passengers == nil {
			s.PassengersNull++
		}
		rs := routes[t.RouteID]
		if rs == nil {
			rs = &RouteStat{RouteID: t.RouteID}
			routes[t.RouteID] = rs
		}
		rs.Trips++
		hs := &s.PerHour[t.StartHour]
		hs.Trips++
		if t.Status != "completed" {
			s.Abandoned++
			continue
		}
		s.Completed++
		d := storedDelayMin(t)
		rs.Completed++
		rs.AvgDelay += d
		hs.Completed++
		hs.AvgDelay += d
		if t.Rating != nil {
			s.Rated++
			s.Ratings[*t.Rating]++
		}
		if t.Feedback != nil {
			s.Feedback++
		}
	}
	for _, rs := range routes {
		if rs.Completed > 0 {
			rs.AvgDelay /= float64(rs.Completed)
		}
		s.PerRoute = append(s.PerRoute, *rs)
	}
	sort.Slice(s.PerRoute, func(i, j int) bool { return s.PerRoute[i].RouteID < s.PerRoute[j].RouteID })
	for h := range s.PerHour {
		if s.PerHour[h].Completed > 0 {
			s.PerHour[h].AvgDelay /= float64(s.PerHour[h].Completed)
		}
	}
	return s
}
