// Package hub polls live bus data (D2) and fans changes out to WebSocket
// clients. One goroutine (Run) owns the client set and the last snapshot,
// and it polls the database only while at least one client is connected.
package hub

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"slices"
	"sync"
	"time"
)

// sendBuffer is how many batches a client may fall behind before it is dropped.
const sendBuffer = 16

var (
	ErrFull   = errors.New("hub: too many clients")
	ErrClosed = errors.New("hub: stopped")
)

// Bus is one bus_live row.
type Bus struct {
	ID        int64
	Lat       float64
	Lng       float64
	Speed     float64
	Status    string
	UpdatedAt time.Time
}

// PollFunc loads the current state of every bus, keyed by bus id.
type PollFunc func(ctx context.Context) (map[int64]Bus, error)

// Client is one subscriber. Each item on Send is a batch of JSON text
// frames, one bus per frame. The hub closes Send when it drops the client
// or stops; CloseReason then says why.
type Client struct {
	send        chan [][]byte
	closeReason string // written by the hub before close(send)
	leaveOnce   sync.Once
}

// Send returns the channel of frame batches for this client.
func (c *Client) Send() <-chan [][]byte { return c.send }

// CloseReason is only valid after Send has been closed.
func (c *Client) CloseReason() string { return c.closeReason }

type joinResult struct {
	c   *Client
	err error
}

// Hub fans out bus changes to clients. Create it with New and start Run.
type Hub struct {
	poll       PollFunc
	interval   time.Duration
	maxClients int

	join  chan chan joinResult
	leave chan *Client
	done  chan struct{} // closed when Run returns

	// One count per joined client, from Join until Leave. Add only runs in
	// the Run goroutine before done is closed, so Wait (after done) is safe.
	wg sync.WaitGroup
}

// New returns a hub that polls every interval while clients are connected.
func New(poll PollFunc, interval time.Duration, maxClients int) *Hub {
	return &Hub{
		poll:       poll,
		interval:   interval,
		maxClients: maxClients,
		join:       make(chan chan joinResult),
		leave:      make(chan *Client),
		done:       make(chan struct{}),
	}
}

// Join registers a new client. Its first batch is the full snapshot; after
// that it receives only changes. Every successful Join needs one Leave.
func (h *Hub) Join() (*Client, error) {
	reply := make(chan joinResult, 1)
	select {
	case h.join <- reply:
	case <-h.done:
		return nil, ErrClosed
	}
	r := <-reply
	return r.c, r.err
}

// Leave unregisters the client. It is safe to call more than once and
// after Run has stopped.
func (h *Hub) Leave(c *Client) {
	c.leaveOnce.Do(func() {
		select {
		case h.leave <- c:
		case <-h.done:
		}
		h.wg.Done()
	})
}

// Wait blocks until Run has stopped and every client has called Leave.
func (h *Hub) Wait(ctx context.Context) error {
	select {
	case <-h.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	all := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(all)
	}()
	select {
	case <-all:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Run is the hub goroutine. It returns when ctx is cancelled, after
// closing every client's Send channel.
func (h *Hub) Run(ctx context.Context) {
	clients := make(map[*Client]struct{})
	var snapshot map[int64]Bus
	var ticker *time.Ticker
	var tick <-chan time.Time // nil (blocks forever) while no clients

	drop := func(c *Client, reason string) {
		delete(clients, c)
		c.closeReason = reason
		close(c.send)
	}
	stopPolling := func() {
		if ticker != nil {
			ticker.Stop()
			ticker, tick = nil, nil
		}
		snapshot = nil
	}

	defer close(h.done)
	for {
		select {
		case <-ctx.Done():
			for c := range clients {
				drop(c, "server shutting down")
			}
			stopPolling()
			return

		case reply := <-h.join:
			if len(clients) >= h.maxClients {
				reply <- joinResult{err: ErrFull}
				continue
			}
			if len(clients) == 0 {
				// Snapshot is stale or empty while idle: refresh it now.
				// On error it stays empty and the first good tick sends every bus.
				snapshot = make(map[int64]Bus)
				if curr, err := h.load(ctx); err == nil {
					snapshot = curr
				}
				ticker = time.NewTicker(h.interval)
				tick = ticker.C
			}
			c := &Client{send: make(chan [][]byte, sendBuffer)}
			c.send <- encode(sorted(snapshot)) // fresh channel, cannot block
			clients[c] = struct{}{}
			h.wg.Add(1)
			reply <- joinResult{c: c}

		case c := <-h.leave:
			if _, ok := clients[c]; ok {
				drop(c, "client left")
			}
			if len(clients) == 0 {
				stopPolling()
			}

		case <-tick:
			curr, err := h.load(ctx)
			if err != nil {
				continue
			}
			changed := diff(snapshot, curr)
			snapshot = curr // disappeared buses drop out here
			if len(changed) == 0 {
				continue
			}
			frames := encode(changed)
			for c := range clients {
				select {
				case c.send <- frames:
				default:
					drop(c, "too slow")
				}
			}
			if len(clients) == 0 {
				stopPolling()
			}
		}
	}
}

// load runs one poll with a timeout and logs failures.
func (h *Hub) load(ctx context.Context) (map[int64]Bus, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	curr, err := h.poll(ctx)
	if err != nil {
		log.Printf("hub: poll: %v", err)
		return nil, err
	}
	return curr, nil
}

// diff returns the buses in curr that are new or differ from prev, sorted
// by id. Buses missing from curr are not reported.
func diff(prev, curr map[int64]Bus) []Bus {
	var changed []Bus
	for id, b := range curr {
		p, ok := prev[id]
		if !ok || p.Lat != b.Lat || p.Lng != b.Lng || p.Speed != b.Speed ||
			p.Status != b.Status || !p.UpdatedAt.Equal(b.UpdatedAt) {
			changed = append(changed, b)
		}
	}
	slices.SortFunc(changed, func(a, b Bus) int { return cmp.Compare(a.ID, b.ID) })
	return changed
}

// sorted returns every bus in m, sorted by id.
func sorted(m map[int64]Bus) []Bus {
	return diff(nil, m)
}

type position struct {
	Type   string  `json:"type"`
	BusID  int64   `json:"bus_id"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Speed  float64 `json:"speed"`
	Status string  `json:"status"`
	TS     string  `json:"ts"`
}

// encode turns each bus into one "position" JSON frame.
func encode(buses []Bus) [][]byte {
	frames := make([][]byte, 0, len(buses))
	for _, b := range buses {
		f, err := json.Marshal(position{
			Type:   "position",
			BusID:  b.ID,
			Lat:    b.Lat,
			Lng:    b.Lng,
			Speed:  b.Speed,
			Status: b.Status,
			TS:     b.UpdatedAt.UTC().Format(time.RFC3339),
		})
		if err != nil {
			// Cannot happen for these field types; skip rather than panic.
			log.Printf("hub: encode bus %d: %v", b.ID, err)
			continue
		}
		frames = append(frames, f)
	}
	return frames
}

// LoadBuses returns a PollFunc that reads every bus_live row.
func LoadBuses(db *sql.DB) PollFunc {
	return func(ctx context.Context) (map[int64]Bus, error) {
		rows, err := db.QueryContext(ctx, `
			SELECT bus_id, lat, lng, speed, status, updated_at
			FROM bus_live
			ORDER BY bus_id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		buses := make(map[int64]Bus)
		for rows.Next() {
			var b Bus
			// Session time zone is UTC (db.go), so updated_at scans as UTC.
			if err := rows.Scan(&b.ID, &b.Lat, &b.Lng, &b.Speed, &b.Status, &b.UpdatedAt); err != nil {
				return nil, err
			}
			buses[b.ID] = b
		}
		return buses, rows.Err()
	}
}
