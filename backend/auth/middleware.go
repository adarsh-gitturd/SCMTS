package auth

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"strings"
)

type ctxKey struct{}

type ctxUser struct {
	id   int64
	role string
}

// Middleware requires a valid "Authorization: Bearer <token>" header and puts
// the user id and role into the request context. Otherwise it returns 401.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
		if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		claims, err := ParseToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), ctxKey{}, ctxUser{id: claims.UserID, role: claims.Role})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRole allows only users whose role is one of roles (403 otherwise).
// It must run after Middleware; without a user in the context it returns 401.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, role, ok := UserFromContext(r.Context())
			if !ok {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			if !slices.Contains(roles, role) {
				writeError(w, http.StatusForbidden, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserFromContext returns the user id and role set by Middleware.
func UserFromContext(ctx context.Context) (userID int64, role string, ok bool) {
	u, ok := ctx.Value(ctxKey{}).(ctxUser)
	return u.id, u.role, ok
}

// writeError sends the API error shape. Same as handlers.writeError, which
// can't be imported here (handlers imports auth).
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": msg}); err != nil {
		log.Printf("write response: %v", err)
	}
}
