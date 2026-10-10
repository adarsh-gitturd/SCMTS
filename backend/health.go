package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// healthHandler reports whether the server and database are reachable.
// GET /health (public, outside /api)
func healthHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		status := http.StatusOK
		body := map[string]string{"status": "ok", "db": "ok"}
		if err := db.PingContext(ctx); err != nil {
			log.Printf("health: db ping failed: %v", err)
			status = http.StatusServiceUnavailable
			body = map[string]string{"status": "error", "db": "unreachable"}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(body); err != nil {
			log.Printf("health: write response: %v", err)
		}
	}
}
