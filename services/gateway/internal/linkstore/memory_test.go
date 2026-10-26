package linkstore

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMemoryStoreCreatesAndResolvesLink(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newMemoryStore(func() time.Time { return now }, nil)
	expiresAt := now.Add(time.Hour)

	link, err := store.Create(context.Background(), "https://example.com/page", "", expiresAt)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(link.Code) != generatedCodeLength {
		t.Fatalf("Create() code length = %d, want %d", len(link.Code), generatedCodeLength)
	}
	if !validCode(link.Code) {
		t.Fatalf("Create() code %q is not a valid short code", link.Code)
	}
	if !link.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("Create() expiresAt = %v, want %v", link.ExpiresAt, expiresAt)
	}

	resolved, err := store.Resolve(context.Background(), link.Code)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if resolved.URL != "https://example.com/page" {
		t.Fatalf("Resolve() url = %q", resolved.URL)
	}
}

func TestMemoryStoreAcceptsAliasAndRejectsDuplicate(t *testing.T) {
	store := NewMemoryStore()

	link, err := store.Create(context.Background(), "https://example.com/one", "myalias", time.Time{})
	if err != nil {
		t.Fatalf("Create() with alias error = %v", err)
	}
	if link.Code != "myalias" {
		t.Fatalf("Create() code = %q, want myalias", link.Code)
	}

	if _, err := store.Create(context.Background(), "https://example.com/two", "myalias", time.Time{}); !errors.Is(err, ErrAliasUnavailable) {
		t.Fatalf("Create() duplicate alias error = %v, want ErrAliasUnavailable", err)
	}
}

func TestMemoryStoreRejectsInvalidAlias(t *testing.T) {
	store := NewMemoryStore()

	for _, alias := range []string{"abc", "toolongalias0123456789abcdefghijk", "bad/alias", "bad alias"} {
		if _, err := store.Create(context.Background(), "https://example.com", alias, time.Time{}); !errors.Is(err, ErrAliasUnavailable) {
			t.Fatalf("Create() alias %q error = %v, want ErrAliasUnavailable", alias, err)
		}
	}
}

func TestMemoryStoreHidesAndCleansExpiredLinks(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newMemoryStore(func() time.Time { return now }, nil)

	link, err := store.Create(context.Background(), "https://example.com", "", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := store.Resolve(context.Background(), link.Code); err != nil {
		t.Fatalf("Resolve() before expiry error = %v", err)
	}

	now = now.Add(2 * time.Minute)
	if _, err := store.Resolve(context.Background(), link.Code); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resolve() after expiry error = %v, want ErrNotFound", err)
	}

	removed, err := store.Cleanup(context.Background(), now)
	if err != nil {
		t.Fatalf("Cleanup() error = %v", err)
	}
	if removed != 1 {
		t.Fatalf("Cleanup() removed = %d, want 1", removed)
	}
}

func TestMemoryStoreReportsCodeExhaustion(t *testing.T) {
	store := newMemoryStore(nil, func() (string, error) { return "collide1", nil })

	if _, err := store.Create(context.Background(), "https://example.com/one", "", time.Time{}); err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	if _, err := store.Create(context.Background(), "https://example.com/two", "", time.Time{}); !errors.Is(err, ErrCodeExhausted) {
		t.Fatalf("second Create() error = %v, want ErrCodeExhausted", err)
	}
}

func TestMemoryStoreRejectsInvalidTarget(t *testing.T) {
	store := NewMemoryStore()

	if _, err := store.Create(context.Background(), "", "", time.Time{}); !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("Create() empty url error = %v, want ErrInvalidTarget", err)
	}

	oversized := make([]byte, maxURLLength+1)
	for index := range oversized {
		oversized[index] = 'a'
	}
	if _, err := store.Create(context.Background(), string(oversized), "", time.Time{}); !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("Create() oversized url error = %v, want ErrInvalidTarget", err)
	}
}

func TestMemoryStoreResolveRejectsUnknownCode(t *testing.T) {
	store := NewMemoryStore()

	if _, err := store.Resolve(context.Background(), "missing1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resolve() error = %v, want ErrNotFound", err)
	}
	if _, err := store.Resolve(context.Background(), "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resolve() short code error = %v, want ErrNotFound", err)
	}
}

func TestMemoryStoreHealthAndClose(t *testing.T) {
	store := NewMemoryStore()

	if err := store.Health(context.Background()); err != nil {
		t.Fatalf("Health() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}
