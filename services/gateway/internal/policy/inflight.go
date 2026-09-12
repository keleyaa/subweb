package policy

import (
	"errors"
	"sync"
)

const maxInFlightGateCapacity = 100

var errInvalidInFlightGate = errors.New("in-flight gate capacity is invalid")

// InFlightGate bounds how many requests a single key may hold at the same time.
// Keys are opaque hashes and are never retained: an entry exists only while at
// least one request holds a slot, so the map cannot grow with idle keys.
type InFlightGate struct {
	limit  int
	mu     sync.Mutex
	counts map[string]int
}

// NewInFlightGate constructs a gate that admits limit concurrent holders per key.
func NewInFlightGate(limit int) (*InFlightGate, error) {
	if limit <= 0 || limit > maxInFlightGateCapacity {
		return nil, errInvalidInFlightGate
	}
	return &InFlightGate{limit: limit, counts: make(map[string]int)}, nil
}

// TryAcquire reserves one slot for key without waiting. The returned release
// function is idempotent and drops the key once its last holder finishes.
func (gate *InFlightGate) TryAcquire(key string) (func(), bool) {
	if gate == nil || key == "" || gate.limit <= 0 || gate.counts == nil {
		return nil, false
	}

	gate.mu.Lock()
	defer gate.mu.Unlock()
	if gate.counts[key] >= gate.limit {
		return nil, false
	}
	gate.counts[key]++

	var once sync.Once
	return func() {
		once.Do(func() {
			gate.mu.Lock()
			defer gate.mu.Unlock()
			remaining := gate.counts[key] - 1
			if remaining <= 0 {
				delete(gate.counts, key)
				return
			}
			gate.counts[key] = remaining
		})
	}, true
}

// trackedKeys reports how many distinct keys currently hold a slot.
func (gate *InFlightGate) trackedKeys() int {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return len(gate.counts)
}
