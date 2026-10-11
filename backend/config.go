package main

import (
	"errors"
	"os"
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
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
