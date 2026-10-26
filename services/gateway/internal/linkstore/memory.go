package linkstore

import (
	"context"
	"crypto/rand"
	"errors"
	"sync"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/shortcode"
)

const (
	// Generated codes match the MyUrls contract: 4-32 characters from the
	// short-code alphabet.
	minCodeLength       = 4
	maxCodeLength       = 32
	generatedCodeLength = 8
	maxURLLength        = 4096
	maxCreateAttempts   = 5

	codeAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
)

// MemoryStore is a process-local Store used by tests and dry-run validation.
type MemoryStore struct {
	mu       sync.RWMutex
	links    map[string]Link
	now      func() time.Time
	generate func() (string, error)
}

// NewMemoryStore returns an empty in-memory store using wall-clock time.
func NewMemoryStore() *MemoryStore {
	return newMemoryStore(time.Now, randomCode)
}

func newMemoryStore(now func() time.Time, generate func() (string, error)) *MemoryStore {
	if now == nil {
		now = time.Now
	}
	if generate == nil {
		generate = randomCode
	}
	return &MemoryStore{links: make(map[string]Link), now: now, generate: generate}
}

// Create stores url under alias, or under a generated code when alias is empty.
func (store *MemoryStore) Create(ctx context.Context, url, alias string, expiresAt time.Time) (Link, error) {
	if err := ctx.Err(); err != nil {
		return Link{}, err
	}
	if err := validateTarget(url); err != nil {
		return Link{}, err
	}
	if alias != "" && !validCode(alias) {
		return Link{}, ErrAliasUnavailable
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	now := store.now()
	if alias != "" {
		if _, taken := store.lookupLocked(alias, now); taken {
			return Link{}, ErrAliasUnavailable
		}
		link := Link{Code: alias, URL: url, CreatedAt: now, ExpiresAt: expiresAt}
		store.links[alias] = link
		return link, nil
	}

	for attempt := 0; attempt < maxCreateAttempts; attempt++ {
		code, err := store.generate()
		if err != nil {
			return Link{}, err
		}
		if !validCode(code) {
			return Link{}, errors.New("linkstore: generated code is invalid")
		}
		if _, taken := store.lookupLocked(code, now); taken {
			continue
		}
		link := Link{Code: code, URL: url, CreatedAt: now, ExpiresAt: expiresAt}
		store.links[code] = link
		return link, nil
	}
	return Link{}, ErrCodeExhausted
}

// Resolve returns the link for code, treating expired links as missing.
func (store *MemoryStore) Resolve(ctx context.Context, code string) (Link, error) {
	if err := ctx.Err(); err != nil {
		return Link{}, err
	}
	if !validCode(code) {
		return Link{}, ErrNotFound
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	link, ok := store.lookupLocked(code, store.now())
	if !ok {
		return Link{}, ErrNotFound
	}
	return link, nil
}

// Health reports whether the store is usable.
func (store *MemoryStore) Health(ctx context.Context) error {
	if store == nil {
		return ErrNotFound
	}
	return ctx.Err()
}

// Cleanup removes expired links and reports how many were removed.
func (store *MemoryStore) Cleanup(ctx context.Context, now time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	removed := 0
	for code, link := range store.links {
		if expired(link, now) {
			delete(store.links, code)
			removed++
		}
	}
	return removed, nil
}

// Close releases store resources. The memory store has none.
func (store *MemoryStore) Close() error {
	return nil
}

// lookupLocked returns the link for code when it exists and has not expired.
func (store *MemoryStore) lookupLocked(code string, now time.Time) (Link, bool) {
	link, ok := store.links[code]
	if !ok || expired(link, now) {
		return Link{}, false
	}
	return link, true
}

func expired(link Link, now time.Time) bool {
	return !link.ExpiresAt.IsZero() && !now.Before(link.ExpiresAt)
}

func validateTarget(url string) error {
	if url == "" || len(url) > maxURLLength {
		return ErrInvalidTarget
	}
	return nil
}

func validCode(code string) bool {
	return len(code) >= minCodeLength && len(code) <= maxCodeLength && shortcode.ValidCode(code)
}

// randomCode returns a cryptographically random short code.
func randomCode() (string, error) {
	buffer := make([]byte, generatedCodeLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	for index := range buffer {
		buffer[index] = codeAlphabet[int(buffer[index])%len(codeAlphabet)]
	}
	return string(buffer), nil
}
