package wsticket

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock is a settable clock, safe for concurrent use.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newTestStore() (*Store, *fakeClock) {
	c := &fakeClock{t: time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)}
	s := New()
	s.now = c.now
	return s, c
}

func TestRedeem(t *testing.T) {
	tests := []struct {
		name     string
		wait     time.Duration // clock advance between Issue and Redeem
		ticket   func(issued string) string
		redeemed bool // redeem once before the checked Redeem
		wantOK   bool
	}{
		{name: "valid", wantOK: true},
		{name: "just before expiry", wait: TTL - time.Millisecond, wantOK: true},
		{name: "at expiry", wait: TTL, wantOK: false},
		{name: "after expiry", wait: TTL + time.Second, wantOK: false},
		{name: "second redeem", redeemed: true, wantOK: false},
		{name: "unknown", ticket: func(string) string { return "not-a-ticket" }, wantOK: false},
		{name: "empty", ticket: func(string) string { return "" }, wantOK: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, clock := newTestStore()
			issued, err := s.Issue(42, "student")
			if err != nil {
				t.Fatalf("Issue: %v", err)
			}
			if len(issued) != 43 {
				t.Errorf("ticket length = %d, want 43", len(issued))
			}
			if tt.redeemed {
				if _, _, ok := s.Redeem(issued); !ok {
					t.Fatal("first Redeem failed")
				}
			}
			clock.advance(tt.wait)
			ticket := issued
			if tt.ticket != nil {
				ticket = tt.ticket(issued)
			}

			uid, role, ok := s.Redeem(ticket)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && (uid != 42 || role != "student") {
				t.Errorf("got (%d, %q), want (42, \"student\")", uid, role)
			}
			if !ok && (uid != 0 || role != "") {
				t.Errorf("failed Redeem returned (%d, %q), want zero values", uid, role)
			}
		})
	}
}

func TestIssueUnique(t *testing.T) {
	s, _ := newTestStore()
	a, err := s.Issue(1, "student")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	b, err := s.Issue(1, "student")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if a == b {
		t.Fatal("two Issue calls returned the same ticket")
	}
}

func TestCap(t *testing.T) {
	s, clock := newTestStore()
	for i := range MaxTickets {
		if _, err := s.Issue(int64(i), "student"); err != nil {
			t.Fatalf("Issue %d: %v", i, err)
		}
	}
	if _, err := s.Issue(1, "student"); !errors.Is(err, ErrFull) {
		t.Fatalf("Issue over cap: err = %v, want ErrFull", err)
	}

	// Once the old tickets expire, Issue frees space without waiting for Run.
	clock.advance(TTL)
	if _, err := s.Issue(1, "student"); err != nil {
		t.Fatalf("Issue after expiry: %v", err)
	}
	if n := len(s.tickets); n != 1 {
		t.Errorf("live tickets = %d, want 1", n)
	}
}

func TestRemoveExpired(t *testing.T) {
	s, clock := newTestStore()
	for i := range 3 {
		if _, err := s.Issue(int64(i), "student"); err != nil {
			t.Fatalf("Issue: %v", err)
		}
	}
	clock.advance(TTL / 2)
	live, err := s.Issue(99, "admin")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	clock.advance(TTL / 2) // first three expired, last one has 15s left

	s.removeExpired()

	if n := len(s.tickets); n != 1 {
		t.Fatalf("tickets after cleanup = %d, want 1", n)
	}
	if uid, role, ok := s.Redeem(live); !ok || uid != 99 || role != "admin" {
		t.Errorf("Redeem live = (%d, %q, %v), want (99, \"admin\", true)", uid, role, ok)
	}
}

func TestRunCleansAndStops(t *testing.T) {
	s, clock := newTestStore()
	if _, err := s.Issue(1, "student"); err != nil {
		t.Fatalf("Issue: %v", err)
	}
	clock.advance(TTL)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.Run(ctx, time.Millisecond)
		close(done)
	}()

	deadline := time.After(2 * time.Second)
	for {
		s.mu.Lock()
		n := len(s.tickets)
		s.mu.Unlock()
		if n == 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("Run did not remove the expired ticket")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop after cancel")
	}
}

func TestConcurrent(t *testing.T) {
	s, _ := newTestStore()

	t.Run("issue and redeem", func(t *testing.T) {
		var wg sync.WaitGroup
		for i := range 50 {
			wg.Add(1)
			go func(uid int64) {
				defer wg.Done()
				for range 20 {
					ticket, err := s.Issue(uid, "student")
					if err != nil {
						t.Errorf("Issue: %v", err)
						return
					}
					got, _, ok := s.Redeem(ticket)
					if !ok || got != uid {
						t.Errorf("Redeem = (%d, %v), want (%d, true)", got, ok, uid)
						return
					}
				}
			}(int64(i))
		}
		wg.Wait()
	})

	t.Run("one ticket redeemed once", func(t *testing.T) {
		ticket, err := s.Issue(7, "admin")
		if err != nil {
			t.Fatalf("Issue: %v", err)
		}
		var wins atomic.Int32
		var wg sync.WaitGroup
		for range 50 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, _, ok := s.Redeem(ticket); ok {
					wins.Add(1)
				}
			}()
		}
		wg.Wait()
		if n := wins.Load(); n != 1 {
			t.Fatalf("successful redeems = %d, want 1", n)
		}
	})
}
