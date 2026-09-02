package ratelimit

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"
)

const (
	maxMemoryStoreKeys     = 10_000
	maxMemoryStoreKeyBytes = 256
)

var (
	errMemoryStoreFull       = errors.New("memory store key limit reached")
	errMemoryStoreKeyTooLong = errors.New("memory store key is too long")
)

// MemoryStore is a process-local CounterStore for the simplified single-
// Gateway mode (SHORT_LINKS_ENABLED=false). It is not distributed and must not
// be used when multiple Gateway instances need a shared rate-limit view.
type MemoryStore struct {
	admissionOnce sync.Once
	admission     chan struct{}
	entries       map[memoryEntryKey]memoryEntry
	now           func() time.Time
}

type memoryEntryKey struct {
	key    string
	window time.Duration
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
	return &MemoryStore{entries: make(map[memoryEntryKey]memoryEntry), now: now}
}

// Increment atomically increments key, resetting it after window expires.
func (store *MemoryStore) Increment(ctx context.Context, key string, window time.Duration) (int64, error) {
	if store == nil || !validWindow(window) {
		return 0, errInvalidRateLimit
	}
	if len(key) > maxMemoryStoreKeyBytes {
		return 0, errMemoryStoreKeyTooLong
	}
	if ctx == nil {
		return 0, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	store.admissionOnce.Do(func() {
		store.admission = make(chan struct{}, 1)
		store.admission <- struct{}{}
	})
	select {
	case <-store.admission:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	defer func() { store.admission <- struct{}{} }()

	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if store.entries == nil {
		store.entries = make(map[memoryEntryKey]memoryEntry)
	}
	now := time.Now()
	if store.now != nil {
		now = store.now()
	}

	expired := make([]memoryEntryKey, 0)
	for entryKey, entry := range store.entries {
		if !withinWindow(now, entry.started, entryKey.window) {
			expired = append(expired, entryKey)
		}
	}
	for _, entryKey := range expired {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		delete(store.entries, entryKey)
	}

	entryKey := memoryEntryKey{key: key, window: window}
	entry, ok := store.entries[entryKey]
	if !ok || !withinWindow(now, entry.started, window) {
		entry = memoryEntry{started: now}
	}
	if !ok && len(store.entries) >= maxMemoryStoreKeys {
		return 0, errMemoryStoreFull
	}
	if entry.count == math.MaxInt64 {
		return 0, errCounterOverflow
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	entry.count++
	store.entries[entryKey] = entry
	return entry.count, nil
}

func validWindow(window time.Duration) bool {
	return window > 0 && window <= maxRateLimitWindow
}

func withinWindow(now, started time.Time, window time.Duration) bool {
	return !now.Before(started) && now.Sub(started) < window
}
