// Command gentrips inserts synthetic trips (D3) for analytics and AI work,
// or removes them. Synthetic trips belong to synthetic students
// (synthetic-NN@synthetic.invalid) that can never log in; -delete removes
// exactly those students and their trips. The model is in gen.go.
//
// Without -yes nothing is written (dry run: summary only).
// Uses the same DB_* and CAMPUS_TZ environment variables as the server.
// Run from backend/:
//
//	go run ./cmd/gentrips                        # dry run, defaults
//	go run ./cmd/gentrips -yes                   # insert (refuses if synthetic data exists)
//	go run ./cmd/gentrips -reset -yes            # replace existing synthetic data
//	go run ./cmd/gentrips -delete                # show what -delete would remove
//	go run ./cmd/gentrips -delete -yes           # remove all synthetic data
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"
	_ "time/tzdata" // CAMPUS_TZ works without OS zone files

	"github.com/go-sql-driver/mysql"

	"scmts/backend/auth"
)

const (
	emailSuffix   = "@synthetic.invalid"
	emailPattern  = "%" + emailSuffix // LIKE pattern; the suffix has no wildcards
	batchSize     = 500               // 17 columns -> 8,500 placeholders per INSERT
	stmtTimeout   = 5 * time.Second
	deleteTimeout = 30 * time.Second // deleting up to 50,000 rows with indexes
)

// tripColumns is the INSERT column list; tripArgs must match its order.
const tripColumns = `student_id, origin_lat, origin_lng, dest_stop_id, bus_id, route_id, board_stop_id,
	status, rating, feedback, started_at, ended_at,
	start_hour, start_weekday, predicted_eta_min, bus_status_at_start, passengers_logged`

const tripPlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

func main() {
	if err := run(); err != nil {
		log.Fatalf("gentrips: %v", err)
	}
}

func run() error {
	days := flag.Int("days", 60, "days of history, from today-N to yesterday (1..365)")
	perDay := flag.Int("per-day", 40, "average trips on a weekday (1..500)")
	students := flag.Int("students", 20, "synthetic student accounts (1..100)")
	seed := flag.Int64("seed", 1, "random seed (same seed, same data)")
	yes := flag.Bool("yes", false, "actually write; without it this is a dry run")
	reset := flag.Bool("reset", false, "delete existing synthetic data first (same transaction)")
	del := flag.Bool("delete", false, "delete all synthetic data and exit")
	flag.Parse()

	switch {
	case *days < 1 || *days > 365:
		return errors.New("-days must be 1..365")
	case *perDay < 1 || *perDay > 500:
		return errors.New("-per-day must be 1..500")
	case *students < 1 || *students > 100:
		return errors.New("-students must be 1..100")
	case *reset && *del:
		return errors.New("use -reset or -delete, not both")
	}

	tz := getEnv("CAMPUS_TZ", "Asia/Kolkata")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return fmt.Errorf("CAMPUS_TZ %q is not a valid time zone: %w", tz, err)
	}

	db, addr, err := openDB()
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer db.Close()

	if err := checkColumns(db); err != nil {
		return err
	}
	var dbName string
	if err := queryRow(db, `SELECT DATABASE()`, nil, &dbName); err != nil {
		return fmt.Errorf("database name: %w", err)
	}
	synUsers, synTrips, realTrips, err := countData(db)
	if err != nil {
		return err
	}

	mode := "DRY RUN: nothing will be written. Add -yes to write."
	if *yes {
		mode = "WRITE MODE"
	}
	fmt.Println(mode)
	fmt.Printf("target: database %s on %s\n", dbName, addr)
	fmt.Printf("existing synthetic data: %d users, %d trips\n", synUsers, synTrips)
	fmt.Printf("real (non-synthetic) trips: %d\n", realTrips)

	if *del {
		if !*yes {
			fmt.Printf("-delete would remove %d trips and %d users. Add -yes to delete.\n", synTrips, synUsers)
			return nil
		}
		return deleteOnly(db)
	}

	all, err := loadRoutes(db)
	if err != nil {
		return err
	}
	routes, skipped := usableRoutes(all)
	if len(routes) == 0 {
		return errors.New("no route with at least 2 stops and a bus; nothing generated")
	}
	opts := Options{Days: *days, PerDay: *perDay, Students: *students}
	res, err := Generate(routes, opts, time.Now(), loc, *seed)
	if err != nil {
		return err
	}
	printSummary(res, routes, skipped, opts, tz, *seed)

	if !*yes {
		if synUsers > 0 || synTrips > 0 {
			fmt.Println("note: synthetic data exists; a real run needs -reset (or -delete first).")
		}
		return nil
	}
	if (synUsers > 0 || synTrips > 0) && !*reset {
		return fmt.Errorf("synthetic data already exists (%d users, %d trips): use -reset -yes to replace it or -delete -yes to remove it", synUsers, synTrips)
	}
	return insertAll(db, res.Trips, *students, *reset)
}

// openDB mirrors the server's settings (backend/db.go), including the UTC
// session time zone, so started_at/ended_at are written exactly as given.
// It returns host:port for display; the password is never returned.
func openDB() (*sql.DB, string, error) {
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
		return nil, "", errors.New("DB_USER is required")
	}

	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, "", fmt.Errorf("open db: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, "", fmt.Errorf("ping db: %w", err)
	}
	return db, mc.Addr, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// queryRow runs a single-row read with the statement timeout.
func queryRow(db *sql.DB, query string, args []any, dest ...any) error {
	ctx, cancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer cancel()
	return db.QueryRowContext(ctx, query, args...).Scan(dest...)
}

// checkColumns refuses to continue unless the 4.1 columns exist.
func checkColumns(db *sql.DB) error {
	var n int
	err := queryRow(db, `
		SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trips'
		  AND COLUMN_NAME IN ('start_hour', 'start_weekday', 'predicted_eta_min',
		                      'bus_status_at_start', 'passengers_logged')`, nil, &n)
	if err != nil {
		return fmt.Errorf("check columns: %w", err)
	}
	if n != 5 {
		return errors.New("trips is missing the 4.1 context columns: run the 4.1 migration first")
	}
	return nil
}

// countData returns synthetic users, synthetic trips and all other trips.
func countData(db *sql.DB) (synUsers, synTrips, realTrips int64, err error) {
	if err = queryRow(db, `SELECT COUNT(*) FROM users WHERE email LIKE ? AND role = 'student'`,
		[]any{emailPattern}, &synUsers); err != nil {
		return 0, 0, 0, fmt.Errorf("count synthetic users: %w", err)
	}
	if err = queryRow(db, `
		SELECT COALESCE(SUM(u.email LIKE ? AND u.role = 'student'), 0),
		       COALESCE(SUM(NOT (u.email LIKE ? AND u.role = 'student')), 0)
		FROM trips t JOIN users u ON u.id = t.student_id`,
		[]any{emailPattern, emailPattern}, &synTrips, &realTrips); err != nil {
		return 0, 0, 0, fmt.Errorf("count trips: %w", err)
	}
	return synUsers, synTrips, realTrips, nil
}

// loadRoutes reads every route's ordered stops and its buses (read-only).
func loadRoutes(db *sql.DB) ([]Route, error) {
	ctx, cancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx, `
		SELECT r.id, r.name, s.id, s.lat, s.lng
		FROM routes r
		LEFT JOIN route_stops rs ON rs.route_id = r.id
		LEFT JOIN stops s ON s.id = rs.stop_id
		ORDER BY r.id, rs.stop_order`)
	if err != nil {
		return nil, fmt.Errorf("load routes: %w", err)
	}
	defer rows.Close()
	var routes []Route
	index := map[int64]int{}
	for rows.Next() {
		var (
			id       int64
			name     string
			stopID   sql.NullInt64
			lat, lng sql.NullFloat64
		)
		if err := rows.Scan(&id, &name, &stopID, &lat, &lng); err != nil {
			return nil, fmt.Errorf("load routes: scan: %w", err)
		}
		i, ok := index[id]
		if !ok {
			i = len(routes)
			index[id] = i
			routes = append(routes, Route{ID: id, Name: name})
		}
		if stopID.Valid {
			routes[i].Stops = append(routes[i].Stops, Stop{ID: stopID.Int64, Lat: lat.Float64, Lng: lng.Float64})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load routes: rows: %w", err)
	}

	bctx, bcancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer bcancel()
	brows, err := db.QueryContext(bctx, `SELECT id, route_id FROM buses WHERE route_id IS NOT NULL ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load buses: %w", err)
	}
	defer brows.Close()
	for brows.Next() {
		var busID, routeID int64
		if err := brows.Scan(&busID, &routeID); err != nil {
			return nil, fmt.Errorf("load buses: scan: %w", err)
		}
		if i, ok := index[routeID]; ok {
			routes[i].Buses = append(routes[i].Buses, busID)
		}
	}
	if err := brows.Err(); err != nil {
		return nil, fmt.Errorf("load buses: rows: %w", err)
	}
	return routes, nil
}

func printSummary(res Result, routes []Route, skipped []string, opts Options, tz string, seed int64) {
	names := map[int64]string{}
	for _, r := range routes {
		names[r.ID] = r.Name
	}
	s := Summarize(res.Trips)
	fmt.Printf("campus zone: %s, seed %d\n", tz, seed)
	fmt.Printf("dates: %s .. %s (%d days: %d weekdays, %d weekend days)\n",
		res.From, res.To, opts.Days, res.Weekdays, res.WeekendDays)
	fmt.Printf("students: %d (synthetic-01..synthetic-%02d%s)\n", opts.Students, opts.Students, emailSuffix)
	fmt.Printf("trips: %d | completed %d | abandoned %d | rated %d | feedback %d | bus delayed at start %d | passengers NULL %d\n",
		s.Total, s.Completed, s.Abandoned, s.Rated, s.Feedback, s.Delayed, s.PassengersNull)
	fmt.Printf("ratings 1..5: %d %d %d %d %d\n", s.Ratings[1], s.Ratings[2], s.Ratings[3], s.Ratings[4], s.Ratings[5])
	fmt.Printf("worse route: %d %s (+%.0f min)\n", res.WorseRoute, names[res.WorseRoute], worseRouteExtraMin)
	if len(skipped) > 0 {
		fmt.Printf("skipped routes: %s\n", strings.Join(skipped, "; "))
	}
	fmt.Println("per route (avg delay over completed trips):")
	fmt.Println("  route  trips  completed  avg_delay_min  name")
	for _, rs := range s.PerRoute {
		fmt.Printf("  %5d  %5d  %9d  %13.1f  %s\n", rs.RouteID, rs.Trips, rs.Completed, rs.AvgDelay, names[rs.RouteID])
	}
	fmt.Println("per hour, campus time (avg delay over completed trips):")
	fmt.Println("  hour  trips  avg_delay_min")
	for h, hs := range s.PerHour {
		if hs.Trips > 0 {
			fmt.Printf("  %02d    %5d  %13.1f\n", h, hs.Trips, hs.AvgDelay)
		}
	}
}

// deleteSynthetic removes synthetic trips, then synthetic users (trips
// reference users ON DELETE RESTRICT). Only by email marker and role.
func deleteSynthetic(tx *sql.Tx) (trips, users int64, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), deleteTimeout)
	defer cancel()
	res, err := tx.ExecContext(ctx, `
		DELETE t FROM trips t JOIN users u ON u.id = t.student_id
		WHERE u.email LIKE ? AND u.role = 'student'`, emailPattern)
	if err != nil {
		return 0, 0, fmt.Errorf("delete synthetic trips: %w", err)
	}
	if trips, err = res.RowsAffected(); err != nil {
		return 0, 0, fmt.Errorf("delete synthetic trips: %w", err)
	}

	uctx, ucancel := context.WithTimeout(context.Background(), deleteTimeout)
	defer ucancel()
	res, err = tx.ExecContext(uctx, `DELETE FROM users WHERE email LIKE ? AND role = 'student'`, emailPattern)
	if err != nil {
		return 0, 0, fmt.Errorf("delete synthetic users: %w", err)
	}
	if users, err = res.RowsAffected(); err != nil {
		return 0, 0, fmt.Errorf("delete synthetic users: %w", err)
	}
	return trips, users, nil
}

func deleteOnly(db *sql.DB) error {
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() // no-op after Commit
	trips, users, err := deleteSynthetic(tx)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	fmt.Printf("deleted %d synthetic trips and %d synthetic users\n", trips, users)
	return nil
}

// unusableHash returns a bcrypt hash of 32 random bytes that are discarded,
// so no password can match it.
func unusableHash() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return auth.HashPassword(string(b))
}

func syntheticEmail(i int) string { return fmt.Sprintf("synthetic-%02d%s", i+1, emailSuffix) }

// insertAll writes the students and trips in ONE transaction (optionally
// after deleting old synthetic data in the same transaction). Any error
// rolls everything back, so a failed run leaves no partial data.
func insertAll(db *sql.DB, trips []Trip, students int, reset bool) error {
	log.Printf("hashing %d unusable passwords", students)
	hashes := make([]string, students)
	for i := range hashes {
		h, err := unusableHash()
		if err != nil {
			return fmt.Errorf("password hash: %w", err)
		}
		hashes[i] = h
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() // no-op after Commit

	if reset {
		t, u, err := deleteSynthetic(tx)
		if err != nil {
			return err
		}
		log.Printf("reset: deleted %d synthetic trips and %d synthetic users", t, u)
	}

	query, args := buildUsersInsert(hashes)
	if err := execTimeout(tx, query, args); err != nil {
		return fmt.Errorf("insert users: %w", err)
	}
	ids, err := studentIDs(tx, students)
	if err != nil {
		return err
	}
	log.Printf("inserted %d synthetic students", students)

	batches := (len(trips) + batchSize - 1) / batchSize
	for b := 0; b < batches; b++ {
		chunk := trips[b*batchSize : min((b+1)*batchSize, len(trips))]
		query, args := buildTripsInsert(chunk, ids)
		if err := execTimeout(tx, query, args); err != nil {
			return fmt.Errorf("insert trips batch %d/%d: %w", b+1, batches, err)
		}
		log.Printf("inserted batch %d/%d (%d trips)", b+1, batches, len(chunk))
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	fmt.Printf("done: inserted %d synthetic students and %d trips\n", students, len(trips))
	return nil
}

func execTimeout(tx *sql.Tx, query string, args []any) error {
	ctx, cancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer cancel()
	_, err := tx.ExecContext(ctx, query, args...)
	return err
}

// studentIDs reads back the new students' ids by email (not LastInsertId,
// which does not promise consecutive ids). ids[i] is synthetic-(i+1).
func studentIDs(tx *sql.Tx, students int) ([]int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), stmtTimeout)
	defer cancel()
	rows, err := tx.QueryContext(ctx,
		`SELECT id, email FROM users WHERE email LIKE ? AND role = 'student'`, emailPattern)
	if err != nil {
		return nil, fmt.Errorf("read student ids: %w", err)
	}
	defer rows.Close()
	byEmail := map[string]int64{}
	for rows.Next() {
		var id int64
		var email string
		if err := rows.Scan(&id, &email); err != nil {
			return nil, fmt.Errorf("read student ids: scan: %w", err)
		}
		byEmail[email] = id
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read student ids: rows: %w", err)
	}
	ids := make([]int64, students)
	for i := range ids {
		id, ok := byEmail[syntheticEmail(i)]
		if !ok {
			return nil, fmt.Errorf("read student ids: synthetic student %d not found", i+1)
		}
		ids[i] = id
	}
	return ids, nil
}

// buildUsersInsert builds one multi-row INSERT for the synthetic students.
func buildUsersInsert(hashes []string) (string, []any) {
	var sb strings.Builder
	sb.WriteString("INSERT INTO users (name, email, password_hash, role) VALUES ")
	args := make([]any, 0, 4*len(hashes))
	for i, h := range hashes {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(?, ?, ?, ?)")
		args = append(args, fmt.Sprintf("Synthetic Student %02d", i+1), syntheticEmail(i), h, "student")
	}
	return sb.String(), args
}

// buildTripsInsert builds one multi-row INSERT; the SQL holds only
// placeholders. ids maps Trip.Student to a user id.
func buildTripsInsert(trips []Trip, ids []int64) (string, []any) {
	var sb strings.Builder
	sb.WriteString("INSERT INTO trips (" + tripColumns + ") VALUES ")
	args := make([]any, 0, 17*len(trips))
	for i, t := range trips {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(tripPlaceholders)
		args = append(args, tripArgs(t, ids[t.Student])...)
	}
	return sb.String(), args
}

// tripArgs returns the values in tripColumns order; nil pointers become NULL.
func tripArgs(t Trip, studentID int64) []any {
	var endedAt, rating, feedback, passengers any
	if t.EndedAt != nil {
		endedAt = *t.EndedAt
	}
	if t.Rating != nil {
		rating = *t.Rating
	}
	if t.Feedback != nil {
		feedback = *t.Feedback
	}
	if t.Passengers != nil {
		passengers = *t.Passengers
	}
	return []any{
		studentID, t.OriginLat, t.OriginLng, t.DestStopID, t.BusID, t.RouteID, t.BoardStopID,
		t.Status, rating, feedback, t.StartedAt, endedAt,
		t.StartHour, t.StartWeekday, t.PredictedETA, t.BusStatus, passengers,
	}
}
