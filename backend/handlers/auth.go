package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"scmts/backend/auth"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginUser struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type loginResponse struct {
	Token string    `json:"token"`
	User  loginUser `json:"user"`
}

// Login checks email and password and returns a signed token.
// Unknown email and wrong password give the same 401, and both run one bcrypt
// compare (against a dummy hash for unknown emails) so timing matches too.
// POST /auth/login (public)
func Login(db *sql.DB) (http.HandlerFunc, error) {
	dummyHash, err := auth.HashPassword("dummy password for timing")
	if err != nil {
		return nil, fmt.Errorf("login: dummy hash: %w", err)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		email := strings.TrimSpace(req.Email)
		if email == "" || req.Password == "" {
			writeError(w, http.StatusBadRequest, "email and password are required")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		var u loginUser
		var hash string
		err := db.QueryRowContext(ctx,
			`SELECT id, name, password_hash, role FROM users WHERE email = ?`, email,
		).Scan(&u.ID, &u.Name, &hash, &u.Role)
		if errors.Is(err, sql.ErrNoRows) {
			auth.CheckPassword(dummyHash, req.Password)
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		if err != nil {
			log.Printf("login: query user: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if !auth.CheckPassword(hash, req.Password) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}

		token, err := auth.NewToken(u.ID, u.Role)
		if err != nil {
			log.Printf("login: sign token for user %d: %v", u.ID, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		writeJSON(w, http.StatusOK, loginResponse{Token: token, User: u})
	}, nil
}
