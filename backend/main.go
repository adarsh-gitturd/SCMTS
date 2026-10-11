package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"scmts/backend/auth"
	"scmts/backend/handlers"
)

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := auth.SetSecret(cfg.JWTSecret); err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := openDB(cfg)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Get("/health", healthHandler(db))

	login, err := handlers.Login(db)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	r.Post("/auth/login", login)

	r.Route("/api", func(api chi.Router) {
		api.Use(auth.Middleware)

		// Any logged-in user.
		api.Get("/routes", handlers.ListRoutes(db))
		api.Get("/stops", handlers.ListStops(db))
		api.Get("/buses", handlers.ListBuses(db))

		student := api.With(auth.RequireRole("student"))
		student.Post("/trip/create", handlers.CreateTrip(db))
		student.Patch("/trip/{id}/complete", handlers.CompleteTrip(db))
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
