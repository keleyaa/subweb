package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/keleyaa/subweb/services/gateway/internal/policy"
	redisv9 "github.com/redis/go-redis/v9"
)

const testRedisHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestRedisStoreUsesAtomicLuaAndNamespacedHashedKey(t *testing.T) {
	executor := &recordingRedisExecutor{result: []any{int64(3), int64(57)}}
	store := newRedisStore(executor)

	count, err := store.Increment(context.Background(), testRedisHash, time.Minute)
	if err != nil {
		t.Fatalf("Increment() error = %v", err)
	}
	if count != 3 {
		t.Fatalf("Increment() = %d, want 3", count)
	}
	if len(executor.keys) != 1 || executor.keys[0] != conversionRateKeyPrefix+testRedisHash {
		t.Fatalf("Eval() keys = %q, want namespaced hash key", executor.keys)
	}
	if !strings.Contains(executor.script, "INCR") || !strings.Contains(executor.script, "TTL") || !strings.Contains(executor.script, "EXPIRE") {
		t.Fatalf("Eval() script does not contain atomic INCR/TTL/EXPIRE behavior: %q", executor.script)
	}
	if len(executor.args) != 1 || executor.args[0] != "60" {
		t.Fatalf("Eval() arguments = %#v, want [60]", executor.args)
	}
}

func TestRedisStoreRejectsRawIPBeforeRedisCall(t *testing.T) {
	executor := &recordingRedisExecutor{result: []any{int64(1), int64(60)}}
	store := newRedisStore(executor)
	const rawIP = "203.0.113.10"

	if _, err := store.Increment(context.Background(), rawIP, time.Minute); err == nil {
		t.Fatal("Increment() error = nil, want invalid hashed key error")
	}
	if len(executor.keys) != 0 {
		t.Fatalf("Eval() keys after raw IP = %q, want no Redis call", executor.keys)
	}
}

func TestRateLimiterFailsClosedWhenRedisStoreErrors(t *testing.T) {
	executor := &recordingRedisExecutor{err: errors.New("dial failed")}
	limiter, err := NewRateLimiter(newRedisStore(executor), 1, time.Minute)
	if err != nil {
		t.Fatalf("NewRateLimiter() error = %v", err)
	}

	result, err := limiter.Allow(context.Background(), testRedisHash)
	if result.Allowed || result.Remaining != 0 {
		t.Fatalf("Allow() = %+v, want denied", result)
	}
	var policyErr policy.PolicyError
	if !errors.As(err, &policyErr) {
		t.Fatalf("Allow() error = %T %v, want PolicyError", err, err)
	}
	if policyErr.Code != "rate_limit_unavailable" || policyErr.Status != 503 {
		t.Fatalf("PolicyError = %+v, want rate_limit_unavailable/503", policyErr)
	}
	if strings.Contains(err.Error(), "dial failed") {
		t.Fatalf("Allow() leaked Redis error: %v", err)
	}
}

func TestNewRedisStoreEnforcesContextTimeoutsAndDisablesRetries(t *testing.T) {
	store, err := NewRedisStore("redis://redis.example.test:6379/0?max_retries=3&dial_timeout=0&read_timeout=0&write_timeout=0&pool_timeout=0", "test-password")
	if err != nil {
		t.Fatalf("NewRedisStore() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	executor, ok := store.executor.(*redisExecutorAdapter)
	if !ok {
		t.Fatalf("RedisStore executor = %T, want *redisExecutorAdapter", store.executor)
	}
	options := executor.client.Options()
	if !options.ContextTimeoutEnabled {
		t.Fatal("Redis client ContextTimeoutEnabled = false, want true")
	}
	if options.MaxRetries != 0 {
		t.Fatalf("Redis client MaxRetries = %d, want 0 after retries are disabled", options.MaxRetries)
	}
	for name, timeout := range map[string]time.Duration{
		"DialTimeout":  options.DialTimeout,
		"ReadTimeout":  options.ReadTimeout,
		"WriteTimeout": options.WriteTimeout,
		"PoolTimeout":  options.PoolTimeout,
	} {
		if timeout <= 0 {
			t.Fatalf("Redis client %s = %v, want a bounded positive timeout", name, timeout)
		}
	}
}

func TestRedisStoreAcceptsExpiringKeyWithZeroSecondTtl(t *testing.T) {
	executor := &recordingRedisExecutor{result: []any{int64(3), int64(0)}}
	store := newRedisStore(executor)

	count, err := store.Increment(context.Background(), testRedisHash, time.Minute)
	if err != nil {
		t.Fatalf("Increment() error = %v, want a valid count with TTL=0", err)
	}
	if count != 3 {
		t.Fatalf("Increment() = %d, want 3", count)
	}
}

func TestNewRedisStoreUsesSuppliedPasswordAndForcesDatabaseOne(t *testing.T) {
	store, err := NewRedisStore("redis://redis.example.test:6379/0", "test-password")
	if err != nil {
		t.Fatalf("NewRedisStore() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	executor, ok := store.executor.(*redisExecutorAdapter)
	if !ok {
		t.Fatalf("RedisStore executor = %T, want *redisExecutorAdapter", store.executor)
	}
	options := executor.client.Options()
	if options.DB != 1 {
		t.Fatalf("Redis client DB = %d, want 1", options.DB)
	}
	if options.Password != "test-password" {
		t.Fatalf("Redis client password = %q, want supplied password", options.Password)
	}
	if options.Addr != "redis.example.test:6379" {
		t.Fatalf("Redis client address = %q, want redis.example.test:6379", options.Addr)
	}
}

func TestRedisStoreAgainstIntegrationRedis(t *testing.T) {
	if os.Getenv("RUN_REDIS_INTEGRATION") != "1" {
		t.Skip("set RUN_REDIS_INTEGRATION=1 with an isolated temporary Redis instance to run")
	}
	redisURL := os.Getenv("REDIS_TEST_URL")
	redisPassword := os.Getenv("REDIS_PASSWORD")
	if redisURL == "" || redisPassword == "" {
		t.Skip("REDIS_TEST_URL and REDIS_PASSWORD are required for isolated Redis integration")
	}
	parsedURL, err := url.Parse(redisURL)
	if err != nil || parsedURL.Hostname() != "127.0.0.1" {
		t.Fatal("Redis integration requires a loopback REDIS_TEST_URL")
	}

	store, err := NewRedisStore(redisURL, redisPassword)
	if err != nil {
		t.Fatalf("NewRedisStore() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	executor := store.executor.(*redisExecutorAdapter)
	ctx := context.Background()
	runHash := sha256.Sum256([]byte(t.TempDir()))
	key := hex.EncodeToString(runHash[:])
	redisKey := conversionRateKeyPrefix + key
	markerKey := "subweb:task5-db-check:" + key[:16]
	defer func() { _ = executor.client.Del(ctx, redisKey, markerKey).Err() }()

	if err := executor.client.Set(ctx, markerKey, "db1", time.Minute).Err(); err != nil {
		t.Fatalf("DB 1 marker Set() error = %v", err)
	}
	dbZeroOptions := *executor.client.Options()
	dbZeroOptions.DB = 0
	dbZero := redisv9.NewClient(&dbZeroOptions)
	defer func() { _ = dbZero.Close() }()
	if err := dbZero.Set(ctx, markerKey, "db0", time.Minute).Err(); err != nil {
		t.Fatalf("DB 0 marker Set() error = %v", err)
	}
	defer func() { _ = dbZero.Del(ctx, markerKey, redisKey).Err() }()

	got, err := store.Increment(ctx, key, 2*time.Second)
	if err != nil {
		t.Fatalf("Increment() error = %v", err)
	}
	if got != 1 {
		t.Fatalf("first Increment() = %d, want 1", got)
	}
	ttl, err := executor.client.TTL(ctx, redisKey).Result()
	if err != nil {
		t.Fatalf("TTL() error = %v", err)
	}
	if ttl <= 0 || ttl > 2*time.Second {
		t.Fatalf("TTL() = %v, want a positive value no greater than 2s", ttl)
	}

	got, err = store.Increment(ctx, key, 2*time.Second)
	if err != nil {
		t.Fatalf("second Increment() error = %v", err)
	}
	if got != 2 {
		t.Fatalf("second Increment() = %d, want 2", got)
	}
	dbOneMarker, err := executor.client.Get(ctx, markerKey).Result()
	if err != nil {
		t.Fatalf("DB 1 marker Get() error = %v", err)
	}
	if dbOneMarker != "db1" {
		t.Fatalf("DB 1 marker = %q, want db1", dbOneMarker)
	}
	dbZeroMarker, err := dbZero.Get(ctx, markerKey).Result()
	if err != nil {
		t.Fatalf("DB 0 marker Get() error = %v", err)
	}
	if dbZeroMarker != "db0" {
		t.Fatalf("DB 0 marker = %q, want db0", dbZeroMarker)
	}
	if exists, err := dbZero.Exists(ctx, redisKey).Result(); err != nil {
		t.Fatalf("DB 0 conversion key check error = %v", err)
	} else if exists != 0 {
		t.Fatal("conversion key exists in DB 0, want DB 1 only")
	}

	ttlZeroHash := sha256.Sum256([]byte(t.TempDir()))
	ttlZeroKey := hex.EncodeToString(ttlZeroHash[:])
	ttlZeroRedisKey := conversionRateKeyPrefix + ttlZeroKey
	defer func() { _ = executor.client.Del(ctx, ttlZeroRedisKey).Err() }()
	if err := executor.client.Set(ctx, ttlZeroRedisKey, 41, time.Minute).Err(); err != nil {
		t.Fatalf("TTL=0 setup Set() error = %v", err)
	}
	if err := executor.client.PExpire(ctx, ttlZeroRedisKey, 900*time.Millisecond).Err(); err != nil {
		t.Fatalf("TTL=0 setup PExpire() error = %v", err)
	}
	pttl, err := executor.client.PTTL(ctx, ttlZeroRedisKey).Result()
	if err != nil || pttl <= 0 || pttl >= time.Second {
		t.Fatalf("TTL=0 setup PTTL() = %v, error = %v", pttl, err)
	}
	got, err = store.Increment(ctx, ttlZeroKey, time.Minute)
	if err != nil {
		t.Fatalf("TTL=0 Increment() error = %v", err)
	}
	if got != 42 {
		t.Fatalf("TTL=0 Increment() = %d, want 42", got)
	}

	concurrentHash := sha256.Sum256([]byte(t.TempDir()))
	concurrentKey := hex.EncodeToString(concurrentHash[:])
	concurrentRedisKey := conversionRateKeyPrefix + concurrentKey
	defer func() { _ = executor.client.Del(ctx, concurrentRedisKey).Err() }()
	const concurrentIncrements = 32
	results := make(chan struct {
		count int64
		err   error
	}, concurrentIncrements)
	for range concurrentIncrements {
		go func() {
			count, incrementErr := store.Increment(ctx, concurrentKey, time.Minute)
			results <- struct {
				count int64
				err   error
			}{count: count, err: incrementErr}
		}()
	}
	seen := make(map[int64]bool, concurrentIncrements)
	for range concurrentIncrements {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent Increment() error = %v", result.err)
		}
		if result.count < 1 || result.count > concurrentIncrements || seen[result.count] {
			t.Fatalf("concurrent Increment() count = %d, want each value 1..%d exactly once", result.count, concurrentIncrements)
		}
		seen[result.count] = true
	}

	expiringHash := sha256.Sum256([]byte(t.TempDir()))
	expiringKey := hex.EncodeToString(expiringHash[:])
	expiringRedisKey := conversionRateKeyPrefix + expiringKey
	defer func() { _ = executor.client.Del(ctx, expiringRedisKey).Err() }()
	if got, err := store.Increment(ctx, expiringKey, time.Second); err != nil || got != 1 {
		t.Fatalf("expiring first Increment() = %d, error = %v, want 1/nil", got, err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		exists, existsErr := executor.client.Exists(ctx, expiringRedisKey).Result()
		if existsErr != nil {
			t.Fatalf("expiration check error = %v", existsErr)
		}
		if exists == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("conversion key did not expire within 3 seconds")
		}
		time.Sleep(25 * time.Millisecond)
	}
	if got, err := store.Increment(ctx, expiringKey, time.Second); err != nil || got != 1 {
		t.Fatalf("expiring reset Increment() = %d, error = %v, want 1/nil", got, err)
	}
}

type recordingRedisExecutor struct {
	result any
	err    error
	script string
	keys   []string
	args   []any
}

func (executor *recordingRedisExecutor) Eval(_ context.Context, script string, keys []string, args ...any) (any, error) {
	executor.script = script
	executor.keys = append([]string(nil), keys...)
	executor.args = append([]any(nil), args...)
	return executor.result, executor.err
}
