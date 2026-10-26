package linkstore

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func openTestSQLite(t *testing.T) *SQLiteStore {
	t.Helper()
	path := filepath.Join(t.TempDir(), "links.db")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestSQLiteStoreCreatesAndResolvesLink(t *testing.T) {
	store := openTestSQLite(t)
	expiresAt := time.Now().Add(time.Hour).Truncate(time.Second)

	link, err := store.Create(context.Background(), "https://example.com/page", "", expiresAt)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !validCode(link.Code) {
		t.Fatalf("Create() code %q is invalid", link.Code)
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
	if !resolved.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("Resolve() expiresAt = %v, want %v", resolved.ExpiresAt, expiresAt)
	}
}

func TestSQLiteStorePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "links.db")
	first, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	if _, err := first.Create(context.Background(), "https://example.com", "persist1", time.Time{}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	second, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	link, err := second.Resolve(context.Background(), "persist1")
	if err != nil {
		t.Fatalf("Resolve() after reopen error = %v", err)
	}
	if link.URL != "https://example.com" {
		t.Fatalf("Resolve() url = %q", link.URL)
	}
}

func TestSQLiteStoreRejectsDuplicateAlias(t *testing.T) {
	store := openTestSQLite(t)

	if _, err := store.Create(context.Background(), "https://example.com/one", "alias1", time.Time{}); err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	if _, err := store.Create(context.Background(), "https://example.com/two", "alias1", time.Time{}); !errors.Is(err, ErrAliasUnavailable) {
		t.Fatalf("second Create() error = %v, want ErrAliasUnavailable", err)
	}
}

func TestSQLiteStoreHidesAndCleansExpiredLinks(t *testing.T) {
	store := openTestSQLite(t)
	now := time.Now().Truncate(time.Second)
	store.now = func() time.Time { return now }

	link, err := store.Create(context.Background(), "https://example.com", "", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
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

func TestSQLiteStoreReclaimsExpiredAlias(t *testing.T) {
	store := openTestSQLite(t)
	now := time.Now().Truncate(time.Second)
	store.now = func() time.Time { return now }

	if _, err := store.Create(context.Background(), "https://example.com/one", "reclaim", now.Add(time.Minute)); err != nil {
		t.Fatalf("first Create() error = %v", err)
	}

	now = now.Add(2 * time.Minute)
	link, err := store.Create(context.Background(), "https://example.com/two", "reclaim", time.Time{})
	if err != nil {
		t.Fatalf("second Create() error = %v", err)
	}
	if link.URL != "https://example.com/two" {
		t.Fatalf("reclaim Create() url = %q", link.URL)
	}
}

func TestSQLiteStoreCreatesUniqueCodesConcurrently(t *testing.T) {
	store := openTestSQLite(t)

	const workers = 16
	var wait sync.WaitGroup
	codes := make(chan string, workers)
	errs := make(chan error, workers)
	for index := 0; index < workers; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			link, err := store.Create(context.Background(), fmt.Sprintf("https://example.com/%d", index), "", time.Time{})
			if err != nil {
				errs <- err
				return
			}
			codes <- link.Code
		}(index)
	}
	wait.Wait()
	close(codes)
	close(errs)

	for err := range errs {
		t.Fatalf("concurrent Create() error = %v", err)
	}
	seen := make(map[string]struct{}, workers)
	for code := range codes {
		if _, duplicate := seen[code]; duplicate {
			t.Fatalf("duplicate code generated: %q", code)
		}
		seen[code] = struct{}{}
	}
	if len(seen) != workers {
		t.Fatalf("unique codes = %d, want %d", len(seen), workers)
	}
}

func TestSQLiteStoreRejectsInvalidTargetAndUnknownCode(t *testing.T) {
	store := openTestSQLite(t)

	if _, err := store.Create(context.Background(), "", "", time.Time{}); !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("Create() error = %v, want ErrInvalidTarget", err)
	}
	if _, err := store.Resolve(context.Background(), "unknown1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resolve() error = %v, want ErrNotFound", err)
	}
	if err := store.Health(context.Background()); err != nil {
		t.Fatalf("Health() error = %v", err)
	}
}

func TestOpenSQLiteRequiresPath(t *testing.T) {
	if _, err := OpenSQLite(""); err == nil {
		t.Fatal("OpenSQLite() with empty path should fail")
	}
}
