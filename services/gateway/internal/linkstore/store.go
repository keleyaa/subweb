// Package linkstore persists short-link mappings for the embedded short-link
// service. It replaces the previous MyUrls + Redis dependency while keeping the
// same externally observable contract.
package linkstore

import (
	"context"
	"errors"
	"time"
)

// Errors returned by Store implementations.
var (
	// ErrNotFound reports an unknown, expired, or already-cleaned code.
	ErrNotFound = errors.New("linkstore: link not found")
	// ErrAliasUnavailable reports a requested alias that is already taken or invalid.
	ErrAliasUnavailable = errors.New("linkstore: alias unavailable")
	// ErrCodeExhausted reports that code generation could not find a free code.
	ErrCodeExhausted = errors.New("linkstore: code generation exhausted")
	// ErrInvalidTarget reports an empty or oversized target URL.
	ErrInvalidTarget = errors.New("linkstore: invalid target")
)

// Link is a stored short-link mapping.
type Link struct {
	Code      string
	URL       string
	CreatedAt time.Time
	// ExpiresAt is the zero value when the link never expires.
	ExpiresAt time.Time
}

// Store persists short-link mappings.
type Store interface {
	// Create stores url under alias when alias is non-empty, otherwise under a
	// freshly generated code. It returns the stored link.
	Create(ctx context.Context, url, alias string, expiresAt time.Time) (Link, error)
	// Resolve returns the link for code, or ErrNotFound when it is unknown or expired.
	Resolve(ctx context.Context, code string) (Link, error)
	// Health reports whether the backing storage is usable.
	Health(ctx context.Context) error
	// Cleanup removes expired links and reports how many were removed.
	Cleanup(ctx context.Context, now time.Time) (int, error)
	// Close releases storage resources.
	Close() error
}
