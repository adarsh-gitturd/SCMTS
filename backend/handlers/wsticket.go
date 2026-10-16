package handlers

import (
	"errors"
	"log"
	"net/http"

	"scmts/backend/auth"
	"scmts/backend/wsticket"
)

type wsTicketResponse struct {
	Ticket    string `json:"ticket"`
	ExpiresIn int    `json:"expires_in"`
}

// IssueWSTicket returns a one-time ticket for opening a WebSocket.
// User id and role come from the token, never from the body.
// POST /api/ws-ticket
func IssueWSTicket(store *wsticket.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, role, ok := auth.UserFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		ticket, err := store.Issue(userID, role)
		if errors.Is(err, wsticket.ErrFull) {
			log.Printf("wsticket: store full")
			writeError(w, http.StatusServiceUnavailable, "too many requests, try again")
			return
		}
		if err != nil {
			log.Printf("wsticket: issue: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, wsTicketResponse{Ticket: ticket, ExpiresIn: int(wsticket.TTL.Seconds())})
	}
}
