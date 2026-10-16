// Package wsticket issues short-lived, one-time tickets for opening a
// WebSocket. Browsers can't send an Authorization header on a WebSocket
// handshake, so the client gets a ticket from an authenticated endpoint
// and passes it in the WebSocket URL instead.
package wsticket

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

const (
	// TTL is how long a ticket stays valid after Issue.
	TTL = 30 * time.Second
	// MaxTickets caps the number of live tickets in the store.
	MaxTickets = 10000
)

// ErrFull is returned by Issue when MaxTickets live tickets exist.
var ErrFull = errors.New("wsticket: too many live tickets")

type entry struct {
	userID    int64
	role      string
	expiresAt time.Time
}

// Store holds issued tickets in memory. It is safe for concurrent use.
type Store struct {
	mu      sync.Mutex
	tickets map[string]entry
	now     func() time.Time // injectable clock for tests
}

// New returns an empty store that uses the real clock.
func New() *Store {
	return &Store{tickets: make(map[string]entry), now: time.Now}
}

// Issue creates a random one-time ticket for the user, valid for TTL.
func (s *Store) Issue(userID int64, role string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	ticket := base64.RawURLEncoding.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if len(s.tickets) >= MaxTickets {
		// Expired tickets may still be waiting for the background sweep.
		s.removeExpiredLocked(now)
		if len(s.tickets) >= MaxTickets {
			return "", ErrFull
		}
	}
	s.tickets[ticket] = entry{userID: userID, role: role, expiresAt: now.Add(TTL)}
	return ticket, nil
}

// Redeem consumes a ticket. It returns ok=false for unknown, expired or
// already-used tickets. The ticket is deleted in every case, so a second
// Redeem always fails.
func (s *Store) Redeem(ticket string) (userID int64, role string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, found := s.tickets[ticket]
	if !found {
		return 0, "", false
	}
	delete(s.tickets, ticket)
	if !s.now().Before(e.expiresAt) {
		return 0, "", false
	}
	return e.userID, e.role, true
}

// Run removes expired tickets every interval until ctx is cancelled.
// Start it with `go store.Run(ctx, interval)`.
func (s *Store) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.removeExpired()
		}
	}
}

// removeExpired deletes every expired ticket.
func (s *Store) removeExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeExpiredLocked(s.now())
}

// removeExpiredLocked is removeExpired for callers that hold s.mu.
func (s *Store) removeExpiredLocked(now time.Time) {
	for k, e := range s.tickets {
		if !now.Before(e.expiresAt) {
			delete(s.tickets, k)
		}
	}
}
