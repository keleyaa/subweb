package ratelimit

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
	"time"
)

func TestMemoryStoreIncrementsAndExpiresWindow(t *testing.T) {
	now := time.Unix(100, 0)
	store := newMemoryStore(func() time.Time { return now })

	for want := int64(1); want <= 2; want++ {
		got, err := store.Increment(context.Background(), "client", time.Minute)
		if err != nil {
			t.Fatalf("Increment() error = %v", err)
		}
		if got != want {
			t.Fatalf("Increment() = %d, want %d", got, want)
		}
	}

	now = now.Add(time.Minute)
	got, err := store.Increment(context.Background(), "client", time.Minute)
	if err != nil {
		t.Fatalf("Increment() after expiration error = %v", err)
	}
	if got != 1 {
		t.Fatalf("Increment() after expiration = %d, want 1", got)
	}
}

func TestMemoryStoreConcurrentIncrementsAreAtomic(t *testing.T) {
	store := NewMemoryStore()
	const workers = 64
	var wait sync.WaitGroup
	wait.Add(workers)
	results := make(chan int64, workers)
	for range workers {
		go func() {
			defer wait.Done()
			got, err := store.Increment(context.Background(), "client", time.Minute)
			if err != nil {
				t.Errorf("Increment() error = %v", err)
				return
			}
			results <- got
		}()
	}
	wait.Wait()
	close(results)

	seen := make(map[int64]bool, workers)
	for result := range results {
		seen[result] = true
	}
	if len(seen) != workers {
		t.Fatalf("saw %d unique counter values, want %d", len(seen), workers)
	}
}

func TestMemoryStoreRejectsInvalidWindowAndOverflow(t *testing.T) {
	store := NewMemoryStore()
	for _, window := range []time.Duration{0, -time.Second, 100 * 365 * 24 * time.Hour} {
		if _, err := store.Increment(context.Background(), "client", window); err == nil {
			t.Fatalf("Increment(%v) error = nil, want error", window)
		}
	}

	store.entries["full"] = memoryEntry{started: store.now(), count: math.MaxInt64}
	if _, err := store.Increment(context.Background(), "full", time.Hour); err == nil {
		t.Fatal("Increment() at MaxInt64 error = nil, want overflow error")
	}
}

func TestMemoryStoreHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewMemoryStore().Increment(ctx, "client", time.Minute); !errors.Is(err, context.Canceled) {
		t.Fatalf("Increment() error = %v, want context.Canceled", err)
	}
}

func TestRateLimiterRejectsAfterLimitAndReportsMetadata(t *testing.T) {
	limiter, err := NewRateLimiter(NewMemoryStore(), 2, time.Minute)
	if err != nil {
		t.Fatalf("NewRateLimiter() error = %v", err)
	}

	for wantRemaining := int64(1); wantRemaining >= 0; wantRemaining-- {
		result, err := limiter.Allow(context.Background(), "client")
		if err != nil {
			t.Fatalf("Allow() error = %v", err)
		}
		if !result.Allowed || result.Remaining != wantRemaining {
			t.Fatalf("Allow() = %+v, want allowed with remaining %d", result, wantRemaining)
		}
	}

	result, err := limiter.Allow(context.Background(), "client")
	if result.Allowed || result.Remaining != 0 || result.RetryAfter <= 0 {
		t.Fatalf("rejected Allow() = %+v, want denied with retry metadata", result)
	}
	assertRateLimitError(t, err, "rate_limited", 429)
}

func TestRateLimiterFailsClosedOnStoreError(t *testing.T) {
	limiter, err := NewRateLimiter(errorStore{}, 1, time.Minute)
	if err != nil {
		t.Fatalf("NewRateLimiter() error = %v", err)
	}
	result, err := limiter.Allow(context.Background(), "client")
	if result.Allowed || result.Remaining != 0 {
		t.Fatalf("Allow() = %+v, want denied", result)
	}
	assertRateLimitError(t, err, "rate_limit_unavailable", 503)
}

func TestRateLimiterRejectsInvalidConfiguration(t *testing.T) {
	for _, test := range []struct {
		limit  int64
		window time.Duration
	}{
		{limit: 0, window: time.Minute},
		{limit: -1, window: time.Minute},
		{limit: 1, window: 0},
		{limit: 1, window: -time.Second},
		{limit: 1, window: 100 * 365 * 24 * time.Hour},
	} {
		if _, err := NewRateLimiter(NewMemoryStore(), test.limit, test.window); err == nil {
			t.Fatalf("NewRateLimiter(%d, %v) error = nil, want error", test.limit, test.window)
		}
	}
}

type errorStore struct{}

func (errorStore) Increment(context.Context, string, time.Duration) (int64, error) {
	return 0, errors.New("store unavailable")
}

func assertRateLimitError(t *testing.T, err error, code string, status int) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want %s", code)
	}
	var policyErr PolicyError
	if !errors.As(err, &policyErr) {
		t.Fatalf("error = %T %v, want PolicyError", err, err)
	}
	if policyErr.Code != code || policyErr.Status != status {
		t.Fatalf("PolicyError = %+v, want code %q status %d", policyErr, code, status)
	}
}
