// Command seeduser inserts a user with a bcrypt password hash, or with -reset
// replaces the password hash of an existing user.
//
// Uses the same DB_* environment variables as the server.
//
//	go run ./cmd/seeduser -name Asha -email asha@college.edu -password secret123 -role student
//	go run ./cmd/seeduser -reset -email asha@college.edu -password newpass123
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"

	"scmts/backend/auth"
)

func main() {
	name := flag.String("name", "", "user's display name (insert only)")
	email := flag.String("email", "", "login email")
	password := flag.String("password", "", "plain-text password (hashed with bcrypt)")
	role := flag.String("role", "", "student, driver or admin (insert only)")
	reset := flag.Bool("reset", false, "update password_hash of an existing user instead of inserting")
	flag.Parse()

	*email = strings.TrimSpace(*email)
	*name = strings.TrimSpace(*name)
	if *email == "" || *password == "" {
		log.Fatal("-email and -password are required")
	}
	if !*reset {
		if *name == "" {
			log.Fatal("-name is required")
		}
		switch *role {
		case "student", "driver", "admin":
		default:
			log.Fatal("-role must be student, driver or admin")
		}
	}

	hash, err := auth.HashPassword(*password)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	db, err := openDB()
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if *reset {
		res, err := db.ExecContext(ctx,
			`UPDATE users SET password_hash = ? WHERE email = ?`, hash, *email)
		if err != nil {
			log.Fatalf("update user: %v", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Fatalf("update user: %v", err)
		}
		if n == 0 {
			log.Fatalf("no user with email %s", *email)
		}
		fmt.Printf("password reset for %s\n", *email)
		return
	}

	res, err := db.ExecContext(ctx,
		`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
		*name, *email, hash, *role)
	var me *mysql.MySQLError
	if errors.As(err, &me) && me.Number == 1062 {
		log.Fatalf("a user with email %s already exists (use -reset to change the password)", *email)
	}
	if err != nil {
		log.Fatalf("insert user: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		log.Fatalf("insert user: %v", err)
	}
	fmt.Printf("created %s user %d (%s)\n", *role, id, *email)
}

// openDB mirrors the server's connection settings (backend/db.go).
func openDB() (*sql.DB, error) {
	mc := mysql.NewConfig()
	mc.User = os.Getenv("DB_USER")
	mc.Passwd = os.Getenv("DB_PASSWORD")
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(getEnv("DB_HOST", "127.0.0.1"), getEnv("DB_PORT", "3306"))
	mc.DBName = getEnv("DB_NAME", "scmts")
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
