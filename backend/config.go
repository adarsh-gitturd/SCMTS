package main

import (
	"errors"
	"fmt"
	"os"
	"time"
	_ "time/tzdata" // CAMPUS_TZ works without OS zone files
)

// Config holds settings read from environment variables.
type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	Port       string
	JWTSecret  string
	CampusLoc  *time.Location // CAMPUS_TZ, default Asia/Kolkata
}

func loadConfig() (Config, error) {
	cfg := Config{
		DBHost:     getEnv("DB_HOST", "127.0.0.1"),
		DBPort:     getEnv("DB_PORT", "3306"),
		DBUser:     os.Getenv("DB_USER"),
		DBPassword: os.Getenv("DB_PASSWORD"),
		DBName:     getEnv("DB_NAME", "scmts"),
		Port:       getEnv("PORT", "8080"),
		JWTSecret:  os.Getenv("JWT_SECRET"),
	}
	if cfg.DBUser == "" {
		return Config{}, errors.New("DB_USER is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	tz := getEnv("CAMPUS_TZ", "Asia/Kolkata")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return Config{}, fmt.Errorf("CAMPUS_TZ %q is not a valid time zone: %w", tz, err)
	}
	cfg.CampusLoc = loc
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
