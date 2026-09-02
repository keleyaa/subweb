package ratelimit

import (
	"context"
	"math"
	"sync"
	"time"
)

// MemoryStore is a process-local CounterStore for the simplified single-
// Gateway mode (SHORT_LINKS_ENABLED=false). It is not distributed and must not
// be used when multiple Gateway instances need a shared rate-limit view.
type MemoryStore struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
	now     func() time.Time
}

type memoryEntry struct {
	started time.Time
	count   int64
}

// NewMemoryStore constructs a process-local counter store using wall-clock time.
func NewMemoryStore() *MemoryStore {
	return newMemoryStore(time.Now)
}

func newMemoryStore(now func() time.Time) *MemoryStore {
	if now == nil {
		now = time.Now
	}
	return &MemoryStore{entries: make(map[string]memoryEntry), now: now}
}

// Increment atomically increments key, resetting it after window expires.
func (store *MemoryStore) Increment(ctx context.Context, key string, window time.Duration) (int64, error) {
	if store == nil || !validWindow(window) {
		return 0, errInvalidRateLimit
	}
	if ctx == nil {
		return 0, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.entries == nil {
		store.entries = make(map[string]memoryEntry)
	}
	now := time.Now()
	if store.now != nil {
		now = store.now()
	}

	entry, ok := store.entries[key]
	if !ok || !withinWindow(now, entry.started, window) {
		entry = memoryEntry{started: now}
	}
	if entry.count == math.MaxInt64 {
		return 0, errCounterOverflow
	}
	entry.count++
	store.entries[key] = entry
	return entry.count, nil
}

func validWindow(window time.Duration) bool {
	return window > 0 && window <= maxRateLimitWindow
}

func withinWindow(now, started time.Time, window time.Duration) bool {
	return !now.Before(started) && now.Sub(started) < window
}
