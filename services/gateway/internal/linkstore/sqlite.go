package linkstore

import (
	"context"
	"database/sql"
	"errors"
	"time"

	_ "modernc.org/sqlite"
)

const (
	sqliteDriverName    = "sqlite"
	sqliteSchemaVersion = 1
)

// SQLiteStore persists short links in a single SQLite database file.
type SQLiteStore struct {
	db  *sql.DB
	now func() time.Time
}

// OpenSQLite opens or creates the short-link database at path.
func OpenSQLite(path string) (*SQLiteStore, error) {
	if path == "" {
		return nil, errors.New("linkstore: database path is required")
	}
	dsn := "file:" + path +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := sql.Open(sqliteDriverName, dsn)
	if err != nil {
		return nil, err
	}
	// A single connection removes SQLITE_BUSY contention between the
	// occasional writer and readers on a small single-instance deployment.
	db.SetMaxOpenConns(1)
	store := &SQLiteStore{db: db, now: time.Now}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *SQLiteStore) migrate(ctx context.Context) error {
	var version int
	if err := store.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > sqliteSchemaVersion {
		return errors.New("linkstore: database schema is newer than this binary")
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS links (
			code TEXT PRIMARY KEY,
			url TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS links_expires_at ON links(expires_at)`,
	}
	for _, statement := range statements {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if version < sqliteSchemaVersion {
		if _, err := store.db.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			return err
		}
	}
	return nil
}

// Create stores url under alias, or under a generated code when alias is empty.
func (store *SQLiteStore) Create(ctx context.Context, url, alias string, expiresAt time.Time) (Link, error) {
	if err := ctx.Err(); err != nil {
		return Link{}, err
	}
	if err := validateTarget(url); err != nil {
		return Link{}, err
	}
	if alias != "" && !validCode(alias) {
		return Link{}, ErrAliasUnavailable
	}

	now := store.now()
	if alias != "" {
		link, err := store.insert(ctx, alias, url, now, expiresAt)
		if errors.Is(err, ErrCodeExhausted) {
			return Link{}, ErrAliasUnavailable
		}
		if err != nil {
			return Link{}, err
		}
		return link, nil
	}

	for attempt := 0; attempt < maxCreateAttempts; attempt++ {
		code, err := randomCode()
		if err != nil {
			return Link{}, err
		}
		link, err := store.insert(ctx, code, url, now, expiresAt)
		if errors.Is(err, ErrCodeExhausted) {
			continue
		}
		if err != nil {
			return Link{}, err
		}
		return link, nil
	}
	return Link{}, ErrCodeExhausted
}

// insert writes a single row, reclaiming an expired row with the same code.
func (store *SQLiteStore) insert(ctx context.Context, code, url string, now, expiresAt time.Time) (Link, error) {
	if _, err := store.db.ExecContext(ctx,
		"DELETE FROM links WHERE code = ? AND expires_at > 0 AND expires_at <= ?",
		code, now.Unix()); err != nil {
		return Link{}, err
	}
	result, err := store.db.ExecContext(ctx,
		"INSERT INTO links (code, url, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO NOTHING",
		code, url, now.Unix(), unixOrZero(expiresAt))
	if err != nil {
		return Link{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Link{}, err
	}
	if affected == 0 {
		return Link{}, ErrCodeExhausted
	}
	return Link{Code: code, URL: url, CreatedAt: now, ExpiresAt: expiresAt}, nil
}

// Resolve returns the link for code, treating expired links as missing.
func (store *SQLiteStore) Resolve(ctx context.Context, code string) (Link, error) {
	if err := ctx.Err(); err != nil {
		return Link{}, err
	}
	if !validCode(code) {
		return Link{}, ErrNotFound
	}

	now := store.now()
	var (
		url       string
		createdAt int64
		expiresAt int64
	)
	err := store.db.QueryRowContext(ctx,
		"SELECT url, created_at, expires_at FROM links WHERE code = ? AND (expires_at = 0 OR expires_at > ?)",
		code, now.Unix()).Scan(&url, &createdAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Link{}, ErrNotFound
	}
	if err != nil {
		return Link{}, err
	}
	link := Link{Code: code, URL: url, CreatedAt: time.Unix(createdAt, 0)}
	if expiresAt != 0 {
		link.ExpiresAt = time.Unix(expiresAt, 0)
	}
	return link, nil
}

// Health reports whether the database is reachable.
func (store *SQLiteStore) Health(ctx context.Context) error {
	if store == nil || store.db == nil {
		return errors.New("linkstore: store is not open")
	}
	return store.db.PingContext(ctx)
}

// Cleanup removes expired links and reports how many were removed.
func (store *SQLiteStore) Cleanup(ctx context.Context, now time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	result, err := store.db.ExecContext(ctx,
		"DELETE FROM links WHERE expires_at > 0 AND expires_at <= ?", now.Unix())
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(affected), nil
}

// Backup writes a consistent snapshot of the database to path.
func (store *SQLiteStore) Backup(ctx context.Context, path string) error {
	if path == "" {
		return errors.New("linkstore: backup path is required")
	}
	_, err := store.db.ExecContext(ctx, "VACUUM INTO ?", path)
	return err
}

// Integrity runs SQLite's integrity check and reports any problem found.
func (store *SQLiteStore) Integrity(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, "PRAGMA integrity_check")
	if err != nil {
		return err
	}
	defer rows.Close()

	var problems []string
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			return err
		}
		if result != "ok" {
			problems = append(problems, result)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(problems) > 0 {
		return errors.New("linkstore: integrity check failed: " + problems[0])
	}
	return nil
}

// Count returns the number of stored links.
func (store *SQLiteStore) Count(ctx context.Context) (int, error) {
	var total int
	if err := store.db.QueryRowContext(ctx, "SELECT count(*) FROM links").Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

// Close releases the database handle.
func (store *SQLiteStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func unixOrZero(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.Unix()
}
