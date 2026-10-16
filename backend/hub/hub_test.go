package hub

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 16, 8, 30, 0, 0, time.UTC)

func bus(id int64, lat float64, status string, ts time.Time) Bus {
	return Bus{ID: id, Lat: lat, Lng: 78.1, Speed: 25, Status: status, UpdatedAt: ts}
}

func ids(buses []Bus) []int64 {
	out := []int64{}
	for _, b := range buses {
		out = append(out, b.ID)
	}
	return out
}

func TestDiff(t *testing.T) {
	b1 := bus(1, 10.1, "on_route", t0)
	b2 := bus(2, 10.2, "on_route", t0)
	tests := []struct {
		name string
		prev map[int64]Bus
		curr map[int64]Bus
		want []int64
	}{
		{"no change", map[int64]Bus{1: b1, 2: b2}, map[int64]Bus{1: b1, 2: b2}, []int64{}},
		{"one bus moved", map[int64]Bus{1: b1, 2: b2},
			map[int64]Bus{1: bus(1, 10.15, "on_route", t0), 2: b2}, []int64{1}},
		{"status changed", map[int64]Bus{1: b1, 2: b2},
			map[int64]Bus{1: b1, 2: bus(2, 10.2, "delayed", t0)}, []int64{2}},
		{"only updated_at changed", map[int64]Bus{1: b1},
			map[int64]Bus{1: bus(1, 10.1, "on_route", t0.Add(3*time.Second))}, []int64{1}},
		{"same instant, other zone", map[int64]Bus{1: b1},
			map[int64]Bus{1: bus(1, 10.1, "on_route", t0.In(time.FixedZone("IST", 19800)))}, []int64{}},
		{"new bus appears", map[int64]Bus{1: b1}, map[int64]Bus{1: b1, 2: b2}, []int64{2}},
		{"bus disappears", map[int64]Bus{1: b1, 2: b2}, map[int64]Bus{1: b1}, []int64{}},
		{"empty prev (first snapshot)", map[int64]Bus{}, map[int64]Bus{2: b2, 1: b1}, []int64{1, 2}},
		{"nil prev", nil, map[int64]Bus{1: b1}, []int64{1}},
		{"empty curr", map[int64]Bus{1: b1, 2: b2}, map[int64]Bus{}, []int64{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ids(diff(tt.prev, tt.curr))
			if len(got) != len(tt.want) {
				t.Fatalf("diff = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("diff = %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestEncode(t *testing.T) {
	frames := encode([]Bus{{ID: 1, Lat: 10.123456, Lng: 78.123456, Speed: 25, Status: "on_route",
		UpdatedAt: t0.In(time.FixedZone("IST", 19800))}})
	want := `{"type":"position","bus_id":1,"lat":10.123456,"lng":78.123456,"speed":25,"status":"on_route","ts":"2026-10-16T08:30:00Z"}`
	if len(frames) != 1 || string(frames[0]) != want {
		t.Fatalf("encode = %q, want %q", frames, want)
	}
}

// fakeDB is a PollFunc with settable state, safe for concurrent use.
type fakeDB struct {
	mu    sync.Mutex
	buses map[int64]Bus
	err   error
	calls int
	bump  bool // move bus 1 on every poll
}

func (f *fakeDB) poll(ctx context.Context) (map[int64]Bus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	if f.bump {
		b := f.buses[1]
		b.Lat += 0.0001
		f.buses[1] = b
	}
	out := make(map[int64]Bus, len(f.buses))
	for k, v := range f.buses {
		out[k] = v
	}
	return out, nil
}

func (f *fakeDB) set(fn func(f *fakeDB)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *fakeDB) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func newFakeDB() *fakeDB {
	return &fakeDB{buses: map[int64]Bus{
		1: bus(1, 10.1, "on_route", t0),
		2: bus(2, 10.2, "on_route", t0),
	}}
}

const tick = 5 * time.Millisecond

// startHub runs a hub until the test ends.
func startHub(t *testing.T, db *fakeDB, max int) (*Hub, context.CancelFunc) {
	t.Helper()
	h := New(db.poll, tick, max)
	ctx, cancel := context.WithCancel(context.Background())
	go h.Run(ctx)
	t.Cleanup(func() {
		cancel()
		<-h.done
	})
	return h, cancel
}

// recv returns the next batch as bus ids, failing after a timeout.
func recv(t *testing.T, c *Client) []int64 {
	t.Helper()
	select {
	case frames, ok := <-c.Send():
		if !ok {
			t.Fatalf("send channel closed: %s", c.CloseReason())
		}
		var out []int64
		for _, f := range frames {
			var p position
			if err := json.Unmarshal(f, &p); err != nil {
				t.Fatalf("bad frame %s: %v", f, err)
			}
			out = append(out, p.BusID)
		}
		return out
	case <-time.After(2 * time.Second):
		t.Fatal("no batch received")
		return nil
	}
}

// expectNothing fails if a batch arrives within a few ticks.
func expectNothing(t *testing.T, c *Client) {
	t.Helper()
	select {
	case frames := <-c.Send():
		t.Fatalf("unexpected batch: %q", frames)
	case <-time.After(10 * tick):
	}
}

func TestSnapshotThenDiffs(t *testing.T) {
	db := newFakeDB()
	h, _ := startHub(t, db, 10)

	c, err := h.Join()
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	defer h.Leave(c)

	if got := recv(t, c); len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("snapshot = %v, want [1 2]", got)
	}
	expectNothing(t, c) // nothing changed: no duplicates of the snapshot

	db.set(func(f *fakeDB) { f.buses[1] = bus(1, 10.15, "on_route", t0.Add(time.Second)) })
	if got := recv(t, c); len(got) != 1 || got[0] != 1 {
		t.Fatalf("diff = %v, want [1]", got)
	}
	expectNothing(t, c)

	// A bus that disappears sends nothing, and comes back as new.
	db.set(func(f *fakeDB) { delete(f.buses, 2) })
	expectNothing(t, c)
	db.set(func(f *fakeDB) { f.buses[2] = bus(2, 10.2, "on_route", t0) })
	if got := recv(t, c); len(got) != 1 || got[0] != 2 {
		t.Fatalf("returning bus = %v, want [2]", got)
	}
}

func TestLateJoinerGetsCurrentSnapshot(t *testing.T) {
	db := newFakeDB()
	h, _ := startHub(t, db, 10)

	a, err := h.Join()
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	defer h.Leave(a)
	recv(t, a)

	db.set(func(f *fakeDB) { f.buses[3] = bus(3, 10.3, "on_route", t0) })
	if got := recv(t, a); len(got) != 1 || got[0] != 3 {
		t.Fatalf("diff = %v, want [3]", got)
	}

	b, err := h.Join()
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	defer h.Leave(b)
	if got := recv(t, b); len(got) != 3 {
		t.Fatalf("late snapshot = %v, want 3 buses", got)
	}
	expectNothing(t, b) // bus 3 is in the snapshot, not sent again
}

func TestPollsOnlyWhileClients(t *testing.T) {
	db := newFakeDB()
	h, _ := startHub(t, db, 10)

	time.Sleep(10 * tick)
	if n := db.callCount(); n != 0 {
		t.Fatalf("polls with no clients = %d, want 0", n)
	}

	c, err := h.Join()
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	if n := db.callCount(); n < 1 {
		t.Fatalf("polls right after first Join = %d, want at least 1", n)
	}
	time.Sleep(10 * tick)
	if n := db.callCount(); n < 3 {
		t.Fatalf("polls while connected = %d, want several", n)
	}

	h.Leave(c)
	after := db.callCount()
	time.Sleep(10 * tick)
	if n := db.callCount(); n != after {
		t.Fatalf("polls after last Leave went from %d to %d", after, n)
	}
}

func TestMaxClients(t *testing.T) {
	h, _ := startHub(t, newFakeDB(), 2)

	a, err := h.Join()
	if err != nil {
		t.Fatalf("Join a: %v", err)
	}
	b, err := h.Join()
	if err != nil {
		t.Fatalf("Join b: %v", err)
	}
	defer h.Leave(b)
	if _, err := h.Join(); !errors.Is(err, ErrFull) {
		t.Fatalf("Join over max: err = %v, want ErrFull", err)
	}
	h.Leave(a)
	c, err := h.Join()
	if err != nil {
		t.Fatalf("Join after Leave: %v", err)
	}
	h.Leave(c)
}

func TestSlowClientDropped(t *testing.T) {
	db := newFakeDB()
	db.bump = true // every poll is a change
	h, _ := startHub(t, db, 10)

	slow, err := h.Join()
	if err != nil {
		t.Fatalf("Join slow: %v", err)
	}
	defer h.Leave(slow)
	fast, err := h.Join()
	if err != nil {
		t.Fatalf("Join fast: %v", err)
	}

	var got int
	fastDone := make(chan struct{})
	go func() {
		defer close(fastDone)
		for range fast.Send() {
			got++
		}
	}()

	// Never read from slow; wait until the hub has had to drop it.
	deadline := time.After(5 * time.Second)
	for db.callCount() < sendBuffer+5 {
		select {
		case <-deadline:
			t.Fatal("hub stopped polling")
		case <-time.After(tick):
		}
	}

	drained := 0
	for range slow.Send() { // ends only if the hub closed the channel
		drained++
	}
	if slow.CloseReason() != "too slow" {
		t.Fatalf("slow CloseReason = %q, want \"too slow\"", slow.CloseReason())
	}
	if drained != sendBuffer {
		t.Errorf("slow client held %d batches, want %d", drained, sendBuffer)
	}

	h.Leave(fast)
	<-fastDone
	if got < sendBuffer+2 {
		t.Errorf("fast client got %d batches, want more than %d", got, sendBuffer+1)
	}
	if fast.CloseReason() != "client left" {
		t.Errorf("fast CloseReason = %q", fast.CloseReason())
	}
}

func TestPollErrors(t *testing.T) {
	db := newFakeDB()
	db.err = errors.New("db down")
	h, _ := startHub(t, db, 10)

	c, err := h.Join()
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	defer h.Leave(c)
	if got := recv(t, c); len(got) != 0 {
		t.Fatalf("snapshot with DB down = %v, want empty", got)
	}
	expectNothing(t, c)

	// Hub keeps running; the first good poll sends every bus.
	db.set(func(f *fakeDB) { f.err = nil })
	if got := recv(t, c); len(got) != 2 {
		t.Fatalf("after recovery = %v, want 2 buses", got)
	}
}

func TestShutdownAndLeaveOnce(t *testing.T) {
	h, cancel := startHub(t, newFakeDB(), 10)

	a, err := h.Join()
	if err != nil {
		t.Fatalf("Join a: %v", err)
	}
	b, err := h.Join()
	if err != nil {
		t.Fatalf("Join b: %v", err)
	}

	// Leave twice: wg.Done must run once (a second Done would panic
	// with a negative counter, or let Wait return too early below).
	h.Leave(a)
	h.Leave(a)

	cancel()
	for range b.Send() {
	}
	if b.CloseReason() != "server shutting down" {
		t.Fatalf("CloseReason = %q", b.CloseReason())
	}
	if _, err := h.Join(); !errors.Is(err, ErrClosed) {
		t.Fatalf("Join after stop: err = %v, want ErrClosed", err)
	}

	// b has not left yet, so Wait must not return.
	ctx, stop := context.WithTimeout(context.Background(), 10*tick)
	defer stop()
	if err := h.Wait(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Wait before b leaves: err = %v, want DeadlineExceeded", err)
	}

	h.Leave(b) // must not block after Run stopped
	h.Leave(b)
	ctx2, stop2 := context.WithTimeout(context.Background(), 2*time.Second)
	defer stop2()
	if err := h.Wait(ctx2); err != nil {
		t.Fatalf("Wait: %v", err)
	}
}
