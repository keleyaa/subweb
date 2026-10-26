package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/linkstore"
)

func TestImportLinksImportsTSVRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "links.db")
	store, err := linkstore.OpenSQLite(path)
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	now := "1893456000"
	input := "codeA1\thttps://example.com/a\t" + now + "\n" +
		"codeB2\thttps://example.com/b\t0\n" +
		"\n"

	summary, err := importLinks(context.Background(), strings.NewReader(input), store)
	if err != nil {
		t.Fatalf("importLinks() error = %v", err)
	}
	if summary.scanned != 2 || summary.imported != 2 || summary.skipped != 0 {
		t.Fatalf("summary = %+v, want 2 scanned/2 imported", summary)
	}

	link, err := store.Resolve(context.Background(), "codeB2")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if link.URL != "https://example.com/b" || !link.ExpiresAt.IsZero() {
		t.Fatalf("Resolve() = %+v", link)
	}

	// Re-importing the same codes is a no-op rather than an overwrite.
	repeated, err := importLinks(context.Background(), strings.NewReader(input), store)
	if err != nil {
		t.Fatalf("second importLinks() error = %v", err)
	}
	if repeated.skipped != 2 || repeated.imported != 0 {
		t.Fatalf("repeated summary = %+v, want 2 skipped", repeated)
	}
}

func TestImportLinksRejectsMalformedRecords(t *testing.T) {
	store, err := linkstore.OpenSQLite(filepath.Join(t.TempDir(), "links.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	if _, err := importLinks(context.Background(), strings.NewReader("only-one-field\n"), store); err == nil {
		t.Fatal("importLinks() should reject a record without three fields")
	}
	if _, err := importLinks(context.Background(), strings.NewReader("codeA1\thttps://example.com\tnot-a-number\n"), store); err == nil {
		t.Fatal("importLinks() should reject a non-numeric expiry")
	}
}

func TestScanImportCountsInvalidRecords(t *testing.T) {
	summary, err := scanImport(strings.NewReader(
		"codeA1\thttps://example.com/a\t0\n" +
			"\thttps://example.com/b\t0\n",
	))
	if err != nil {
		t.Fatalf("scanImport() error = %v", err)
	}
	if summary.scanned != 2 || summary.invalid != 1 || summary.imported != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestBackupAndRestoreRoundTrip(t *testing.T) {
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "links.db")
	store, err := linkstore.OpenSQLite(sourcePath)
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	if _, err := store.Create(context.Background(), "https://example.com/keep", "keep1", time.Time{}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	snapshotPath := filepath.Join(directory, "snapshot.db")
	if err := store.Backup(context.Background(), snapshotPath); err != nil {
		t.Fatalf("Backup() error = %v", err)
	}
	total, err := store.Count(context.Background())
	if err != nil || total != 1 {
		t.Fatalf("Count() = %d, %v", total, err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	restoredPath := filepath.Join(directory, "restored.db")
	if err := replaceSQLiteFile(snapshotPath, restoredPath); err != nil {
		t.Fatalf("replaceSQLiteFile() error = %v", err)
	}
	restored, err := linkstore.OpenSQLite(restoredPath)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	defer func() { _ = restored.Close() }()

	link, err := restored.Resolve(context.Background(), "keep1")
	if err != nil {
		t.Fatalf("Resolve() after restore error = %v", err)
	}
	if link.URL != "https://example.com/keep" {
		t.Fatalf("Resolve() url = %q", link.URL)
	}
	if _, err := os.Stat(snapshotPath + "-wal"); !os.IsNotExist(err) {
		t.Fatalf("restore should leave no stale WAL file: %v", err)
	}
}
