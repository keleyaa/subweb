package policy

import (
	"context"
	"errors"
	"io"
	"math"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewSemaphoreRejectsInvalidCapacity(t *testing.T) {
	for _, capacity := range []int{0, maxSemaphoreCapacity + 1, math.MaxInt} {
		if _, err := NewSemaphore(capacity); err == nil {
			t.Fatalf("NewSemaphore(%d) error = nil, want error", capacity)
		}
	}
}

func TestSemaphoreStartsWithDistinctPermits(t *testing.T) {
	semaphore, err := NewSemaphore(2)
	if err != nil {
		t.Fatalf("NewSemaphore() error = %v", err)
	}

	permitA := <-semaphore.slots
	permitB := <-semaphore.slots
	if permitA == permitB {
		t.Fatal("semaphore permits are not distinct")
	}
	semaphore.slots <- permitA
	semaphore.slots <- permitB
}

func TestSemaphoreCancellationWhileWaitingConsumesNoSlot(t *testing.T) {
	semaphore, err := NewSemaphore(1)
	if err != nil {
		t.Fatalf("NewSemaphore() error = %v", err)
	}
	releaseFirst, err := semaphore.Acquire(context.Background())
	if err != nil {
		t.Fatalf("first Acquire() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	acquired := make(chan struct {
		release func()
		err     error
	}, 1)
	go func() {
		release, err := semaphore.Acquire(ctx)
		acquired <- struct {
			release func()
			err     error
		}{release: release, err: err}
	}()
	cancel()

	result := <-acquired
	if !errors.Is(result.err, context.Canceled) {
		t.Fatalf("waiting Acquire() error = %v, want context.Canceled", result.err)
	}
	releaseFirst()

	releaseNext, err := semaphore.Acquire(context.Background())
	if err != nil {
		t.Fatalf("Acquire() after canceled waiter error = %v", err)
	}
	releaseNext()
}

func TestSemaphoreReleaseOnlyReleasesItsAcquisition(t *testing.T) {
	semaphore, err := NewSemaphore(1)
	if err != nil {
		t.Fatalf("NewSemaphore() error = %v", err)
	}

	releaseA, err := semaphore.Acquire(context.Background())
	if err != nil {
		t.Fatalf("Acquire(A) error = %v", err)
	}
	releaseA()
	releaseB, err := semaphore.Acquire(context.Background())
	if err != nil {
		t.Fatalf("Acquire(B) error = %v", err)
	}
	releaseA()

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if releaseC, err := semaphore.Acquire(ctx); !errors.Is(err, context.DeadlineExceeded) {
		if err == nil {
			releaseC()
		}
		t.Fatalf("Acquire(C) after duplicate release error = %v, want deadline exceeded", err)
	}

	releaseB()
	releaseC, err := semaphore.Acquire(context.Background())
	if err != nil {
		t.Fatalf("Acquire(C) after B release error = %v", err)
	}
	releaseC()
}

func TestReadResponseBodyAllowsEmptyAndExactLimit(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		max  int64
	}{
		{name: "empty", body: "", max: 0},
		{name: "exact", body: "four", max: 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := io.NopCloser(strings.NewReader(test.body))
			got, err := ReadResponseBody(context.Background(), body, test.max)
			if err != nil {
				t.Fatalf("ReadResponseBody() error = %v", err)
			}
			if string(got) != test.body {
				t.Fatalf("ReadResponseBody() = %q, want %q", got, test.body)
			}
		})
	}
}

func TestReadResponseBodyRejectsMaxPlusOneWithoutUnboundedRead(t *testing.T) {
	body := &trackingReadCloser{reader: strings.NewReader("12345")}
	_, err := ReadResponseBody(context.Background(), body, 4)
	assertPolicyError(t, err, "response_too_large", 413)
	if body.maxRead > 5 {
		t.Fatalf("reader received a read buffer of %d bytes, want at most 5", body.maxRead)
	}
}

func TestReadResponseBodyCancellationClosesBlockedBody(t *testing.T) {
	body := newBlockingReadCloser()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := ReadResponseBody(ctx, body, 16)
		result <- err
	}()

	<-body.started
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("ReadResponseBody() error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ReadResponseBody() did not stop after context cancellation")
	}
	select {
	case <-body.closed:
	default:
		t.Fatal("ReadResponseBody() did not close body on cancellation")
	}
}

func TestWithTotalTimeoutRejectsInvalidDurations(t *testing.T) {
	for _, timeout := range []time.Duration{0, -time.Second, 100 * 365 * 24 * time.Hour} {
		if _, _, err := WithTotalTimeout(context.Background(), timeout); err == nil {
			t.Fatalf("WithTotalTimeout(%v) error = nil, want error", timeout)
		}
	}
}

func TestWithTotalTimeoutCombinesParentContext(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	ctx, stop, err := WithTotalTimeout(parent, time.Second)
	if err != nil {
		t.Fatalf("WithTotalTimeout() error = %v", err)
	}
	defer stop()
	cancel()
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("derived context error = %v, want context.Canceled", ctx.Err())
	}
}

type trackingReadCloser struct {
	reader  io.Reader
	mu      sync.Mutex
	maxRead int
}

func (body *trackingReadCloser) Read(buffer []byte) (int, error) {
	body.mu.Lock()
	if len(buffer) > body.maxRead {
		body.maxRead = len(buffer)
	}
	body.mu.Unlock()
	return body.reader.Read(buffer)
}

func (body *trackingReadCloser) Close() error { return nil }

type blockingReadCloser struct {
	started chan struct{}
	closed  chan struct{}
	once    sync.Once
}

func newBlockingReadCloser() *blockingReadCloser {
	return &blockingReadCloser{started: make(chan struct{}), closed: make(chan struct{})}
}

func (body *blockingReadCloser) Read([]byte) (int, error) {
	body.once.Do(func() { close(body.started) })
	<-body.closed
	return 0, errors.New("body closed")
}

func (body *blockingReadCloser) Close() error {
	body.once.Do(func() { close(body.started) })
	select {
	case <-body.closed:
	default:
		close(body.closed)
	}
	return nil
}
