package handlers

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"scmts/backend/hub"
	"scmts/backend/wsticket"
)

func TestParseOrigins(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    []string
		wantErr bool
	}{
		{"one", "http://localhost:5173", []string{"http://localhost:5173"}, false},
		{"several with spaces", " http://localhost:5173 , https://scmts.example.com ",
			[]string{"http://localhost:5173", "https://scmts.example.com"}, false},
		{"lowercased", "HTTP://LocalHost:5173", []string{"http://localhost:5173"}, false},
		{"empty parts skipped", "http://a.test,,", []string{"http://a.test"}, false},
		{"empty", "", nil, true},
		{"only commas", " , ,", nil, true},
		{"no scheme", "localhost:5173", nil, true},
		{"host only", "localhost", nil, true},
		{"ws scheme", "ws://localhost:5173", nil, true},
		{"path", "http://localhost:5173/app", nil, true},
		{"trailing slash", "http://localhost:5173/", nil, true},
		{"query", "http://localhost:5173?x=1", nil, true},
		{"user info", "http://u@localhost:5173", nil, true},
		{"wildcard", "http://*.example.com", nil, true},
		{"star", "*", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseOrigins(tt.in)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if !slices.Equal(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBusFeedRejectsBeforeUpgrade(t *testing.T) {
	const origin = "http://localhost:5173"
	tickets := wsticket.New()
	issue := func(role string) string {
		tk, err := tickets.Issue(1, role)
		if err != nil {
			t.Fatalf("Issue: %v", err)
		}
		return tk
	}

	// A stopped hub: a request that passes every check gets 503 from Join.
	h := hub.New(func(context.Context) (map[int64]hub.Bus, error) { return nil, nil }, 1, 10)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.Run(ctx)
	feed := BusFeed(tickets, h, []string{origin})

	used := issue("student")
	tickets.Redeem(used)

	tests := []struct {
		name   string
		origin string
		ticket string
		want   int
	}{
		{"missing origin", "", issue("student"), http.StatusForbidden},
		{"wrong origin", "http://evil.test", issue("student"), http.StatusForbidden},
		{"origin with other scheme", "https://localhost:5173", issue("student"), http.StatusForbidden},
		{"no ticket", origin, "", http.StatusUnauthorized},
		{"bad ticket", origin, "not-a-ticket", http.StatusUnauthorized},
		{"reused ticket", origin, used, http.StatusUnauthorized},
		{"driver role", origin, issue("driver"), http.StatusForbidden},
		{"student passes checks", origin, issue("student"), http.StatusServiceUnavailable},
		{"admin passes checks", origin, issue("admin"), http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/ws/buses?ticket="+tt.ticket, nil)
			req.Header.Set("Connection", "Upgrade")
			req.Header.Set("Upgrade", "websocket")
			req.Header.Set("Sec-WebSocket-Version", "13")
			req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			feed(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tt.want, rec.Body)
			}
		})
	}
}

// syncBuffer collects log output from several goroutines.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// TestBusFeedEndToEnd runs a real server and WebSocket client. The server
// timeouts are shorter than the test, so it also proves they are cleared.
func TestBusFeedEndToEnd(t *testing.T) {
	logs := &syncBuffer{}
	prev := log.Writer()
	log.SetOutput(logs)
	defer log.SetOutput(prev)

	const origin = "http://localhost:5173"
	var mu sync.Mutex
	lat := 10.0
	poll := func(context.Context) (map[int64]hub.Bus, error) {
		mu.Lock()
		defer mu.Unlock()
		lat += 0.0001 // bus 1 moves on every poll
		return map[int64]hub.Bus{1: {ID: 1, Lat: lat, Lng: 78.1, Status: "on_route", UpdatedAt: time.Now().UTC()}}, nil
	}
	h := hub.New(poll, 50*time.Millisecond, 10)
	hubCtx, stopHub := context.WithCancel(context.Background())
	defer stopHub()
	go h.Run(hubCtx)

	tickets := wsticket.New()
	srv := httptest.NewUnstartedServer(BusFeed(tickets, h, []string{origin}))
	srv.Config.ReadTimeout = 200 * time.Millisecond
	srv.Config.WriteTimeout = 200 * time.Millisecond
	srv.Start()
	defer srv.Close()

	ticket, err := tickets.Issue(7, "student")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/buses?ticket=" + ticket
	opts := &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, opts)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.CloseNow()

	_, msg, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if !strings.Contains(string(msg), `"type":"position","bus_id":1`) {
		t.Fatalf("snapshot = %s", msg)
	}

	// Updates keep flowing well past the server's Read/WriteTimeout.
	start := time.Now()
	for time.Since(start) < 600*time.Millisecond {
		if _, _, err := conn.Read(ctx); err != nil {
			t.Fatalf("read %v after connect: %v", time.Since(start), err)
		}
	}

	// Same ticket again: rejected before the upgrade.
	_, resp, err := websocket.Dial(ctx, url, opts)
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused ticket: err = %v, resp = %v, want 401", err, resp)
	}

	// Clients are read-only: sending data gets the socket closed.
	if err := conn.Write(ctx, websocket.MessageText, []byte("hi")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	for {
		_, _, err := conn.Read(ctx)
		if err == nil {
			continue // position updates still queued
		}
		if got := websocket.CloseStatus(err); got != websocket.StatusPolicyViolation {
			t.Fatalf("close status = %v (err %v), want PolicyViolation", got, err)
		}
		break
	}

	// Shutdown: stopping the hub ends every handler.
	stopHub()
	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := h.Wait(wctx); err != nil {
		t.Fatalf("Wait: %v", err)
	}

	out := logs.String()
	if !strings.Contains(out, "ws: connect user=7") {
		t.Errorf("connect not logged:\n%s", out)
	}
	if strings.Contains(out, ticket) {
		t.Errorf("ticket leaked into logs:\n%s", out)
	}
}
