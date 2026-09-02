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
)

var (
	errInvalidSemaphoreCapacity = errors.New("semaphore capacity must be positive")
	errInvalidResponseLimit     = errors.New("response size limit is invalid")
	errInvalidRequestTimeout    = errors.New("request timeout is invalid")
)

// Semaphore bounds concurrent work without reserving a slot for canceled
// waiters. Release is intentionally idempotent so it is safe to defer.
type Semaphore struct {
	slots chan struct{}
}

// NewSemaphore constructs a semaphore with capacity slots.
func NewSemaphore(capacity int) (*Semaphore, error) {
	if capacity <= 0 {
		return nil, errInvalidSemaphoreCapacity
	}
	return &Semaphore{slots: make(chan struct{}, capacity)}, nil
}

// Acquire waits for a slot or returns the context cancellation/deadline.
func (semaphore *Semaphore) Acquire(ctx context.Context) error {
	if semaphore == nil || semaphore.slots == nil {
		return errInvalidSemaphoreCapacity
	}
	if ctx == nil {
		return context.Canceled
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	select {
	case semaphore.slots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			semaphore.Release()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Release returns a slot. Releasing an empty semaphore is a no-op.
func (semaphore *Semaphore) Release() {
	if semaphore == nil || semaphore.slots == nil {
		return
	}
	select {
	case <-semaphore.slots:
	default:
	}
}

// ReadResponseBody reads at most maxBytes+1 bytes and rejects a body that is
// larger than maxBytes. The body is always closed; cancellation closes it too
// so a transport that unblocks on Close cannot leave a read goroutine behind.
func ReadResponseBody(ctx context.Context, body io.ReadCloser, maxBytes int64) ([]byte, error) {
	if ctx == nil || body == nil || maxBytes < 0 || maxBytes > maxResponseBodyBytes {
		return nil, errInvalidResponseLimit
	}

	var closeOnce sync.Once
	closeBody := func() {
		closeOnce.Do(func() { _ = body.Close() })
	}
	defer closeBody()

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
