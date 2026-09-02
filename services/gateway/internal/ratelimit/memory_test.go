package ratelimit

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
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

func TestMemoryStoreKeepsCountersSeparateForDifferentWindows(t *testing.T) {
	now := time.Unix(100, 0)
	store := newMemoryStore(func() time.Time { return now })
	longWindow := 10 * time.Minute
	shortWindow := time.Minute

	if got, err := store.Increment(context.Background(), "client", longWindow); err != nil || got != 1 {
		t.Fatalf("long-window initial Increment() = (%d, %v), want (1, nil)", got, err)
	}
	now = now.Add(2 * time.Minute)
	if got, err := store.Increment(context.Background(), "client", shortWindow); err != nil || got != 1 {
		t.Fatalf("short-window Increment() = (%d, %v), want (1, nil)", got, err)
	}
	if got, err := store.Increment(context.Background(), "client", longWindow); err != nil || got != 2 {
		t.Fatalf("long-window continued Increment() = (%d, %v), want (2, nil)", got, err)
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

	store.entries[memoryEntryKey{key: "full", window: time.Hour}] = memoryEntry{started: store.now(), count: math.MaxInt64}
	if _, err := store.Increment(context.Background(), "full", time.Hour); err == nil {
		t.Fatal("Increment() at MaxInt64 error = nil, want overflow error")
	}
}

func TestMemoryStoreCopiesShortKeysBeforeStoring(t *testing.T) {
	backing := strings.Repeat("client", 1<<20)
	key := backing[:len("client")]
	store := NewMemoryStore()
	window := time.Minute

	if _, err := store.Increment(context.Background(), key, window); err != nil {
		t.Fatalf("initial Increment() error = %v", err)
	}

	allocs := testing.AllocsPerRun(100, func() {
		if _, err := store.Increment(context.Background(), key, window); err != nil {
			t.Fatalf("repeated Increment() error = %v", err)
		}
	})
	if allocs == 0 {
		t.Fatalf("repeated Increment() allocations = %v, want a fresh key copy", allocs)
	}
}

func TestMemoryStoreRejectsOverlongKeysWithoutChangingState(t *testing.T) {
	store := NewMemoryStore()
	if _, err := store.Increment(context.Background(), "client", time.Minute); err != nil {
		t.Fatalf("initial Increment() error = %v", err)
	}
	longKey := strings.Repeat("k", 257)
	beforeEntries := len(store.entries)
	if _, err := store.Increment(context.Background(), longKey, time.Minute); err == nil {
		t.Error("Increment() with overlong key error = nil, want error")
	}
	if len(store.entries) != beforeEntries {
		t.Errorf("entries after overlong key = %d, want %d", len(store.entries), beforeEntries)
	}
	if got, err := store.Increment(context.Background(), "client", time.Minute); err != nil || got != 2 {
		t.Errorf("Increment() after rejected key = (%d, %v), want (2, nil)", got, err)
	}

	limiterStore := NewMemoryStore()
	limiter, err := NewRateLimiter(limiterStore, 1, time.Minute)
	if err != nil {
		t.Fatalf("NewRateLimiter() error = %v", err)
	}
	result, err := limiter.Allow(context.Background(), longKey)
	if result.Allowed || result.Remaining != 0 {
		t.Errorf("Allow() with overlong key = %+v, want unavailable", result)
	}
	assertRateLimitError(t, err, "rate_limit_unavailable", 503)
	if len(limiterStore.entries) != 0 {
		t.Errorf("entries after unavailable key = %d, want 0", len(limiterStore.entries))
	}
}

func TestMemoryStoreHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewMemoryStore().Increment(ctx, "client", time.Minute); !errors.Is(err, context.Canceled) {
		t.Fatalf("Increment() error = %v, want context.Canceled", err)
	}
}

func TestMemoryStoreCanceledWaiterDoesNotMutateAfterHeldLock(t *testing.T) {
	nowStarted := make(chan struct{})
	var nowStartedOnce sync.Once
	allowNow := make(chan struct{})
	store := newMemoryStore(func() time.Time {
		nowStartedOnce.Do(func() { close(nowStarted) })
		<-allowNow
		return time.Unix(100, 0)
	})

	firstResult := make(chan error, 1)
	go func() {
		_, err := store.Increment(context.Background(), "client", time.Minute)
		firstResult <- err
	}()
	<-nowStarted

	waiter := newAdmissionContext()
	waiterResult := make(chan error, 1)
	go func() {
		_, err := store.Increment(waiter, "waiter", time.Minute)
		waiterResult <- err
	}()
	select {
	case <-waiter.entered:
	case <-time.After(time.Second):
		waiter.cancel()
		close(allowNow)
		<-firstResult
		t.Fatal("canceled waiter did not reach admission wait")
	}

	waiter.cancel()
	select {
	case err := <-waiterResult:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled waiter error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		close(allowNow)
		<-firstResult
		t.Fatal("canceled waiter waited for held lock release")
	}

	close(allowNow)
	if err := <-firstResult; err != nil {
		t.Fatalf("first Increment() error = %v", err)
	}
	got, err := store.Increment(context.Background(), "next", time.Minute)
	if err != nil {
		t.Fatalf("Increment() after canceled waiter error = %v", err)
	}
	if got != 1 {
		t.Fatalf("Increment() after canceled waiter = %d, want 1", got)
	}
}

func TestMemoryStoreBoundsKeysAndCleansExpiredEntries(t *testing.T) {
	now := time.Unix(100, 0)
	store := newMemoryStore(func() time.Time { return now })
	for i := 0; i < maxMemoryStoreKeys; i++ {
		key := "client-" + strconv.Itoa(i)
		if _, err := store.Increment(context.Background(), key, time.Minute); err != nil {
			t.Fatalf("Increment(%q) error = %v", key, err)
		}
	}

	if _, err := store.Increment(context.Background(), "new", time.Minute); !errors.Is(err, errMemoryStoreFull) {
		t.Fatalf("Increment(new key at cap) error = %v, want key-cap error", err)
	}

	now = now.Add(time.Minute)
	got, err := store.Increment(context.Background(), "new", time.Minute)
	if err != nil {
		t.Fatalf("Increment(new key after expiration) error = %v", err)
	}
	if got != 1 {
		t.Fatalf("Increment(new key after expiration) = %d, want 1", got)
	}
	if len(store.entries) != 1 {
		t.Fatalf("entries after expiration cleanup = %d, want 1", len(store.entries))
	}
}

func TestRateLimiterAllowsMaximumFiniteLimit(t *testing.T) {
	if _, err := NewRateLimiter(NewMemoryStore(), 10_000, time.Minute); err != nil {
		t.Fatalf("NewRateLimiter(max finite limit) error = %v", err)
	}
	for _, limit := range []int64{10_001, math.MaxInt64} {
		if _, err := NewRateLimiter(NewMemoryStore(), limit, time.Minute); err == nil {
			t.Fatalf("NewRateLimiter(%d) error = nil, want error", limit)
		}
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

type admissionContext struct {
	done    chan struct{}
	entered chan struct{}
	once    sync.Once
}

func newAdmissionContext() *admissionContext {
	return &admissionContext{done: make(chan struct{}), entered: make(chan struct{})}
}

func (ctx *admissionContext) Deadline() (time.Time, bool) { return time.Time{}, false }

func (ctx *admissionContext) Done() <-chan struct{} {
	ctx.once.Do(func() { close(ctx.entered) })
	return ctx.done
}

func (ctx *admissionContext) Err() error {
	select {
	case <-ctx.done:
		return context.Canceled
	default:
		return nil
	}
}

func (ctx *admissionContext) Value(any) any { return nil }

func (ctx *admissionContext) cancel() {
	select {
	case <-ctx.done:
	default:
		close(ctx.done)
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
