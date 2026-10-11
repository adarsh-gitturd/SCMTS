package main

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"time"

	"github.com/go-sql-driver/mysql"
)

// openDB connects to MySQL and verifies the connection with a ping.
func openDB(cfg Config) (*sql.DB, error) {
	mc := mysql.NewConfig()
	mc.User = cfg.DBUser
	mc.Passwd = cfg.DBPassword
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(cfg.DBHost, cfg.DBPort)
	mc.DBName = cfg.DBName
	mc.ParseTime = true
	mc.Loc = time.UTC
	// The driver runs SET time_zone on every new connection, so the whole pool
	// reads and writes TIMESTAMP columns in UTC. '+00:00' instead of 'UTC'
	// because named zones need MySQL's time zone tables loaded.
	mc.Params = map[string]string{"time_zone": "'+00:00'"}

	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return db, nil
}
