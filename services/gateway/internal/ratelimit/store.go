package ratelimit

import (
	"context"
	"errors"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/policy"
)

// CounterStore atomically increments a key's counter for a fixed window.
// Implementations may be process-local or distributed; callers must not assume
// that a successful increment means the key is globally unique.
type CounterStore interface {
	Increment(ctx context.Context, key string, window time.Duration) (int64, error)
}

// RateLimitResult describes the decision made by a RateLimiter.
type RateLimitResult struct {
	Allowed    bool
	Remaining  int64
	RetryAfter time.Duration
}

// RateLimiter rejects requests once the configured counter reaches its limit.
type RateLimiter struct {
	store  CounterStore
	limit  int64
	window time.Duration
}

const (
	maxRateLimitWindow = 24 * time.Hour
	maxRateLimit       = 10_000
)

var (
	errInvalidRateLimit = errors.New("rate limiter configuration is invalid")
	errCounterOverflow  = errors.New("counter overflow")
)

// NewRateLimiter validates and constructs a rate limiter.
func NewRateLimiter(store CounterStore, limit int64, window time.Duration) (*RateLimiter, error) {
	if store == nil || limit <= 0 || limit > maxRateLimit || window <= 0 || window > maxRateLimitWindow {
		return nil, errInvalidRateLimit
	}
	return &RateLimiter{store: store, limit: limit, window: window}, nil
}

// Allow consumes one counter value and returns a sanitized policy error when
// the request is rejected. Store failures fail closed as a service-unavailable
// policy error rather than allowing an unmetered request through.
func (limiter *RateLimiter) Allow(ctx context.Context, key string) (RateLimitResult, error) {
	if limiter == nil || limiter.store == nil || limiter.limit <= 0 || limiter.limit > maxRateLimit || limiter.window <= 0 || limiter.window > maxRateLimitWindow {
		return RateLimitResult{}, policy.PolicyError{Code: "rate_limit_unavailable", Status: 503}
	}
	if ctx == nil {
		return RateLimitResult{}, policy.PolicyError{Code: "rate_limit_unavailable", Status: 503}
	}
	if err := ctx.Err(); err != nil {
		return RateLimitResult{}, err
	}

	count, err := limiter.store.Increment(ctx, key, limiter.window)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return RateLimitResult{}, ctxErr
		}
		return RateLimitResult{}, policy.PolicyError{Code: "rate_limit_unavailable", Status: 503}
	}
	if count <= 0 {
		return RateLimitResult{}, policy.PolicyError{Code: "rate_limit_unavailable", Status: 503}
	}
	if count <= limiter.limit {
		return RateLimitResult{Allowed: true, Remaining: limiter.limit - count}, nil
	}
	return RateLimitResult{Remaining: 0, RetryAfter: limiter.window}, policy.PolicyError{Code: "rate_limited", Status: 429}
}

// PolicyError keeps rate-limit errors compatible with the Gateway's sanitized
// HTTP error boundary without duplicating the policy error type.
type PolicyError = policy.PolicyError
