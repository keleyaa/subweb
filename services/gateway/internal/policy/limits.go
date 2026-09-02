package policy

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"
)

const (
	maxResponseBodyBytes   int64         = 64 * 1024 * 1024
	maxTotalRequestTimeout time.Duration = time.Hour
	maxSemaphoreCapacity                 = 100
)

var (
	errInvalidSemaphoreCapacity = errors.New("semaphore capacity is invalid")
	errInvalidResponseLimit     = errors.New("response size limit is invalid")
	errInvalidRequestTimeout    = errors.New("request timeout is invalid")
)

// Semaphore bounds concurrent work without reserving a slot for canceled
// waiters. Each successful acquisition owns its idempotent release function.
type Semaphore struct {
	slots chan *semaphorePermit
}

type semaphorePermit struct {
	_ byte
}

// NewSemaphore constructs a semaphore with capacity slots.
func NewSemaphore(capacity int) (*Semaphore, error) {
	if capacity <= 0 || capacity > maxSemaphoreCapacity {
		return nil, errInvalidSemaphoreCapacity
	}
	slots := make(chan *semaphorePermit, capacity)
	for range capacity {
		slots <- &semaphorePermit{}
	}
	return &Semaphore{slots: slots}, nil
}

// TryAcquire takes a slot without waiting. It returns false when all slots are busy.
func (semaphore *Semaphore) TryAcquire() (func(), bool) {
	if semaphore == nil || semaphore.slots == nil {
		return nil, false
	}
	select {
	case permit := <-semaphore.slots:
		var releaseOnce sync.Once
		return func() {
			releaseOnce.Do(func() { semaphore.slots <- permit })
		}, true
	default:
		return nil, false
	}
}

// Acquire waits for a slot or returns the context cancellation/deadline.
func (semaphore *Semaphore) Acquire(ctx context.Context) (func(), error) {
	if semaphore == nil || semaphore.slots == nil {
		return nil, errInvalidSemaphoreCapacity
	}
	if ctx == nil {
		return nil, context.Canceled
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	select {
	case permit := <-semaphore.slots:
		if err := ctx.Err(); err != nil {
			semaphore.slots <- permit
			return nil, err
		}
		var releaseOnce sync.Once
		return func() {
			releaseOnce.Do(func() { semaphore.slots <- permit })
		}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// ReadResponseBody reads at most maxBytes+1 bytes and rejects a body that is
// larger than maxBytes. The body is always closed; cancellation closes it too
// so a transport that unblocks on Close cannot leave a read goroutine behind.
func ReadResponseBody(ctx context.Context, body io.ReadCloser, maxBytes int64) ([]byte, error) {
	var closeOnce sync.Once
	closeBody := func() {
		if body != nil {
			closeOnce.Do(func() { _ = body.Close() })
		}
	}
	defer closeBody()

	if ctx == nil || body == nil || maxBytes < 0 || maxBytes > maxResponseBodyBytes {
		return nil, errInvalidResponseLimit
	}

	if err := ctx.Err(); err != nil {
		closeBody()
		return nil, err
	}

	finished := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			closeBody()
		case <-finished:
		}
	}()
	defer close(finished)

	contents, err := io.ReadAll(io.LimitReader(body, maxBytes+1))
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maxBytes {
		return nil, PolicyError{Code: "response_too_large", Status: 413}
	}
	return contents, nil
}

// WithTotalTimeout applies one bounded deadline to all work derived from ctx.
func WithTotalTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc, error) {
	if ctx == nil || timeout <= 0 || timeout > maxTotalRequestTimeout {
		return nil, func() {}, errInvalidRequestTimeout
	}
	derived, cancel := context.WithTimeout(ctx, timeout)
	return derived, cancel, nil
}
