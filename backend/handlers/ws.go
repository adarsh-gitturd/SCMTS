package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/coder/websocket"

	"scmts/backend/hub"
	"scmts/backend/wsticket"
)

const (
	wsWriteTimeout = 5 * time.Second
	wsPingInterval = 30 * time.Second
	wsPingTimeout  = 10 * time.Second
	wsReadLimit    = 128 // clients are read-only; anything bigger closes the socket
)

// ParseOrigins parses ALLOWED_ORIGINS: comma-separated "scheme://host[:port]"
// entries. It returns them lowercased, and an error if none are given.
func ParseOrigins(s string) ([]string, error) {
	var origins []string
	for part := range strings.SplitSeq(s, ",") {
		o := strings.ToLower(strings.TrimSpace(part))
		if o == "" {
			continue
		}
		// The websocket library matches patterns with path.Match.
		if strings.ContainsAny(o, `*?[\`) {
			return nil, fmt.Errorf("origin %q: wildcards are not allowed", o)
		}
		u, err := url.Parse(o)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("origin %q: want scheme://host[:port]", o)
		}
		origins = append(origins, o)
	}
	if len(origins) == 0 {
		return nil, errors.New("ALLOWED_ORIGINS is required")
	}
	return origins, nil
}

// BusFeed streams live bus positions (D2) over a WebSocket. Auth is a
// one-time ticket from POST /api/ws-ticket, because browsers cannot send
// an Authorization header here. Every check runs before the upgrade.
// The URL carries the ticket, so it must never be logged.
// GET /ws/buses?ticket=...
func BusFeed(tickets *wsticket.Store, h *hub.Hub, origins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !slices.Contains(origins, strings.ToLower(r.Header.Get("Origin"))) {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}

		userID, role, ok := tickets.Redeem(r.URL.Query().Get("ticket"))
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if role != "student" && role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}

		client, err := h.Join()
		if err != nil {
			// ErrFull or ErrClosed; the ticket is already used up.
			writeError(w, http.StatusServiceUnavailable, "too many connections, try again")
			return
		}
		defer h.Leave(client)

		// net/http clears http.Server's Read/WriteTimeout deadlines when
		// Accept hijacks the connection; per-write timeouts and pings below
		// take over. TestBusFeedEndToEnd guards this.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: origins})
		if err != nil {
			// Accept has already written the HTTP error response.
			log.Printf("ws: accept user=%d: %v", userID, err)
			return
		}
		conn.SetReadLimit(wsReadLimit)
		log.Printf("ws: connect user=%d role=%s", userID, role)

		reason := serveBusFeed(r.Context(), conn, client)
		log.Printf("ws: disconnect user=%d: %s", userID, reason)
	}
}

// serveBusFeed writes the client's batches and pings until something ends
// the connection. It returns why, and only after the reader has stopped.
func serveBusFeed(ctx context.Context, conn *websocket.Conn, client *hub.Client) string {
	// Reader: needed so close and pong frames are processed. Clients are
	// read-only, so any data message closes the connection.
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		if _, _, err := conn.Read(ctx); err != nil {
			return
		}
		_ = conn.Close(websocket.StatusPolicyViolation, "read-only")
	}()

	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case frames, ok := <-client.Send():
			if !ok {
				code := websocket.StatusGoingAway
				if client.CloseReason() == "too slow" {
					code = websocket.StatusPolicyViolation
				}
				_ = conn.Close(code, client.CloseReason())
				<-readDone
				return client.CloseReason()
			}
			for _, f := range frames {
				wctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
				err := conn.Write(wctx, websocket.MessageText, f)
				cancel()
				if err != nil {
					_ = conn.CloseNow()
					<-readDone
					return "write failed"
				}
			}

		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, wsPingTimeout)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				_ = conn.CloseNow()
				<-readDone
				return "no pong"
			}

		case <-readDone:
			_ = conn.CloseNow()
			return "closed by client"
		}
	}
}
