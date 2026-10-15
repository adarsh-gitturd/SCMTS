// Command gpssim simulates driver GPS broadcasts: it moves every active bus
// along its route (ping-pong between the first and last stop) and updates
// lat, lng, speed and updated_at in bus_live every tick. It never changes the
// status column; drivers own it. Status is re-read every tick.
//
// Uses the same DB_* environment variables as the server. Run from backend/:
//
//	go run ./cmd/gpssim                          # every 3s until Ctrl-C
//	go run ./cmd/gpssim -interval 1s -speedup 10 # faster, for testing
//	go run ./cmd/gpssim -once                    # single tick, then exit
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"

	"scmts/backend/ranking"
	"scmts/backend/sim"
)

const (
	onRouteKmh    = 25.0
	delayedKmh    = 12.0
	speedJitter   = 0.10 // +-10%
	gpsNoiseM     = 3.0
	tickTimeout   = 5 * time.Second
	statusOnRoute = "on_route"
	statusDelayed = "delayed"
	statusBreak   = "break"
	statusOOS     = "out_of_service"
)

// bus is the simulator's state for one bus that has a usable route.
type bus struct {
	id            int64
	stops         []ranking.Point
	length        float64 // route length in metres
	odometer      float64 // metres along the round trip [0, 2*length), starting forward
	lastStatus    string
	missingLogged bool
}

func main() {
	interval := flag.Duration("interval", 3*time.Second, "time between ticks")
	speedup := flag.Float64("speedup", 1, "movement multiplier (speed column is not multiplied)")
	once := flag.Bool("once", false, "run a single tick and exit")
	flag.Parse()

	if *interval <= 0 {
		log.Fatal("-interval must be > 0")
	}
	if *speedup <= 0 {
		log.Fatal("-speedup must be > 0")
	}

	db, err := openDB()
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	buses, err := setup(db)
	if err != nil {
		log.Fatalf("setup: %v", err)
	}
	log.Printf("simulating %d bus(es), interval %s, speedup %g", len(buses), *interval, *speedup)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tick(db, buses, *interval, *speedup)
	if *once {
		return
	}

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Print("shutting down")
			return
		case <-ticker.C:
			// tick uses its own context, so Ctrl-C lets the current tick finish.
			tick(db, buses, *interval, *speedup)
		}
	}
}

// setup loads routes, buses and their current status, logs one line per
// skipped bus and returns the buses that can move, with staggered starts.
func setup(db *sql.DB) ([]*bus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), tickTimeout)
	defer cancel()

	routes, err := loadRoutes(ctx, db)
	if err != nil {
		return nil, err
	}
	statuses, err := loadStatuses(ctx, db)
	if err != nil {
		return nil, err
	}

	rows, err := db.QueryContext(ctx, `SELECT id, route_id FROM buses ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load buses: %w", err)
	}
	defer rows.Close()

	var buses []*bus
	byRoute := make(map[int64][]*bus)
	for rows.Next() {
		var id int64
		var routeID sql.NullInt64
		if err := rows.Scan(&id, &routeID); err != nil {
			return nil, fmt.Errorf("load buses: %w", err)
		}
		if !routeID.Valid {
			log.Printf("bus %d: skipped, no route", id)
			continue
		}
		stops := routes[routeID.Int64]
		if len(stops) < 2 {
			log.Printf("bus %d: skipped, route %d has %d stop(s), needs at least 2", id, routeID.Int64, len(stops))
			continue
		}

		b := &bus{id: id, stops: stops, length: sim.RouteLength(stops)}
		status, ok := statuses[id]
		switch {
		case !ok:
			log.Printf("bus %d: no bus_live row, skipped until one exists", id)
			b.missingLogged = true
		case status == statusOOS:
			log.Printf("bus %d: skipped, status out_of_service", id)
		}
		b.lastStatus = status
		buses = append(buses, b)
		byRoute[routeID.Int64] = append(byRoute[routeID.Int64], b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load buses: %w", err)
	}

	// Stagger: bus i of n on a route starts i*L/n along the outbound leg, so
	// buses on the same route never start at the same spot.
	for _, group := range byRoute {
		for i, b := range group {
			b.odometer = float64(i) * b.length / float64(len(group))
		}
	}
	return buses, nil
}

// loadRoutes returns each route's stop coordinates in stop order.
func loadRoutes(ctx context.Context, db *sql.DB) (map[int64][]ranking.Point, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT rs.route_id, s.lat, s.lng
		   FROM route_stops rs
		   JOIN stops s ON s.id = rs.stop_id
		  ORDER BY rs.route_id, rs.stop_order`)
	if err != nil {
		return nil, fmt.Errorf("load routes: %w", err)
	}
	defer rows.Close()

	routes := make(map[int64][]ranking.Point)
	for rows.Next() {
		var routeID int64
		var p ranking.Point
		if err := rows.Scan(&routeID, &p.Lat, &p.Lng); err != nil {
			return nil, fmt.Errorf("load routes: %w", err)
		}
		routes[routeID] = append(routes[routeID], p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load routes: %w", err)
	}
	return routes, nil
}

// loadStatuses returns bus_live.status by bus id. Buses without a row are absent.
func loadStatuses(ctx context.Context, db *sql.DB) (map[int64]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT bus_id, status FROM bus_live`)
	if err != nil {
		return nil, fmt.Errorf("load statuses: %w", err)
	}
	defer rows.Close()

	statuses := make(map[int64]string)
	for rows.Next() {
		var id int64
		var status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, fmt.Errorf("load statuses: %w", err)
		}
		statuses[id] = status
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load statuses: %w", err)
	}
	return statuses, nil
}

// tick moves every bus one step and writes its bus_live row. Errors are
// logged; the next tick tries again.
func tick(db *sql.DB, buses []*bus, interval time.Duration, speedup float64) {
	ctx, cancel := context.WithTimeout(context.Background(), tickTimeout)
	defer cancel()

	statuses, err := loadStatuses(ctx, db)
	if err != nil {
		log.Printf("tick: %v", err)
		return
	}

	updated := 0
	for _, b := range buses {
		status, ok := statuses[b.id]
		if !ok {
			if !b.missingLogged {
				log.Printf("bus %d: no bus_live row, skipped until one exists", b.id)
				b.missingLogged = true
			}
			continue
		}
		b.missingLogged = false
		if status != b.lastStatus {
			if b.lastStatus != "" {
				log.Printf("bus %d: status %s -> %s", b.id, b.lastStatus, status)
			}
			b.lastStatus = status
		}

		var kmh float64
		switch status {
		case statusOnRoute:
			kmh = jitter(onRouteKmh)
		case statusDelayed:
			kmh = jitter(delayedKmh)
		case statusBreak:
			kmh = 0 // parked: same position, speed 0, fresh updated_at
		default: // out_of_service or unknown
			continue
		}

		b.odometer += kmh / 3.6 * interval.Seconds() * speedup
		b.odometer = math.Mod(b.odometer, 2*b.length)
		pos, _, ok := sim.Position(b.stops, b.odometer, true)
		if !ok {
			continue
		}
		if kmh > 0 {
			pos = sim.Offset(pos, noise(), noise())
		}

		_, err := db.ExecContext(ctx,
			`UPDATE bus_live SET lat = ?, lng = ?, speed = ?, updated_at = CURRENT_TIMESTAMP
			  WHERE bus_id = ?`,
			round(pos.Lat, 6), round(pos.Lng, 6), round(kmh, 1), b.id)
		if err != nil {
			log.Printf("bus %d: update: %v", b.id, err)
			continue
		}
		updated++
	}
	log.Printf("tick: updated %d bus(es)", updated)
}

// jitter returns base varied by up to +-speedJitter.
func jitter(base float64) float64 {
	return base * (1 + speedJitter*(2*rand.Float64()-1))
}

// noise returns a GPS error in metres, uniform in +-gpsNoiseM.
func noise() float64 {
	return gpsNoiseM * (2*rand.Float64() - 1)
}

func round(v float64, decimals int) float64 {
	p := math.Pow(10, float64(decimals))
	return math.Round(v*p) / p
}

// openDB mirrors the server's connection settings (backend/db.go).
func openDB() (*sql.DB, error) {
	mc := mysql.NewConfig()
	mc.User = os.Getenv("DB_USER")
	mc.Passwd = os.Getenv("DB_PASSWORD")
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(getEnv("DB_HOST", "127.0.0.1"), getEnv("DB_PORT", "3306"))
	mc.DBName = getEnv("DB_NAME", "scmts")
	mc.ParseTime = true
	mc.Loc = time.UTC
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	if mc.User == "" {
		return nil, errors.New("DB_USER is required")
	}

	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return db, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
