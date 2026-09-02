package ratelimit

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	redisv9 "github.com/redis/go-redis/v9"
)

const (
	conversionRateKeyPrefix = "subweb:rate:convert:"
	redisHashLength         = 64
	redisClientTimeout      = 5 * time.Second
	redisIncrementScript    = `local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = redis.call("TTL", KEYS[1])
end
return { count, ttl }`
)

var (
	errInvalidRedisConfig = errors.New("Redis configuration is invalid")
	errInvalidRedisKey    = errors.New("Redis rate-limit key is invalid")
	errRedisUnavailable   = errors.New("Redis rate-limit store is unavailable")
)

type redisExecutor interface {
	Eval(context.Context, string, []string, ...any) (any, error)
}

// RedisStore is a Redis-backed CounterStore for conversion rate limits.
// It accepts only an IP hash or a fully namespaced hash key, never a raw IP.
type RedisStore struct {
	executor redisExecutor
	close    func() error
}

type redisExecutorAdapter struct {
	client *redisv9.Client
}

// NewRedisStore creates an independent Redis client pinned to database 1.
// The URL may select a host, port, TLS mode, and source database, but the
// conversion limiter always overrides its database with 1 and its password
// with the supplied REDIS_PASSWORD value.
func NewRedisStore(redisURL, password string) (*RedisStore, error) {
	if redisURL == "" || password == "" {
		return nil, errInvalidRedisConfig
	}
	parsedURL, err := url.Parse(redisURL)
	if err != nil || parsedURL.User != nil {
		return nil, errInvalidRedisConfig
	}
	options, err := redisv9.ParseURL(redisURL)
	if err != nil {
		return nil, errInvalidRedisConfig
	}
	options.Password = password
	options.DB = 1
	// This store performs a non-idempotent INCR inside Lua. A lost response
	// must not cause go-redis to replay the script and count the request twice.
	options.MaxRetries = -1
	options.MinRetryBackoff = -1
	options.MaxRetryBackoff = -1
	options.ContextTimeoutEnabled = true
	// Do not let URL query parameters disable the finite I/O budget. Request
	// contexts remain the primary deadline; these bounds cover callers without one.
	options.DialTimeout = redisClientTimeout
	options.ReadTimeout = redisClientTimeout
	options.WriteTimeout = redisClientTimeout
	options.PoolTimeout = redisClientTimeout

	client := redisv9.NewClient(options)
	return &RedisStore{
		executor: &redisExecutorAdapter{client: client},
		close:    client.Close,
	}, nil
}

// Increment atomically consumes one counter value and applies the requested
// fixed-window TTL when the key has no expiry.
func (store *RedisStore) Increment(ctx context.Context, key string, window time.Duration) (int64, error) {
	if store == nil || store.executor == nil || ctx == nil {
		return 0, errRedisUnavailable
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if !validRedisWindow(window) {
		return 0, errRedisUnavailable
	}
	redisKey, err := namespacedConversionKey(key)
	if err != nil {
		return 0, err
	}

	result, err := store.executor.Eval(
		ctx,
		redisIncrementScript,
		[]string{redisKey},
		strconv.FormatInt(int64(window/time.Second), 10),
	)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return 0, ctxErr
		}
		return 0, errRedisUnavailable
	}
	count, err := parseRedisIncrementResult(result)
	if err != nil {
		return 0, errRedisUnavailable
	}
	return count, nil
}

// Close releases the Redis connection pool owned by the store.
func (store *RedisStore) Close() error {
	if store == nil || store.close == nil {
		return nil
	}
	return store.close()
}

func newRedisStore(executor redisExecutor) *RedisStore {
	return &RedisStore{executor: executor}
}

func validRedisWindow(window time.Duration) bool {
	return validWindow(window) && window >= time.Second && window%time.Second == 0
}

func namespacedConversionKey(key string) (string, error) {
	if strings.HasPrefix(key, conversionRateKeyPrefix) {
		hash := strings.TrimPrefix(key, conversionRateKeyPrefix)
		if isHashDigest(hash) {
			return key, nil
		}
		return "", errInvalidRedisKey
	}
	if !isHashDigest(key) {
		return "", errInvalidRedisKey
	}
	return conversionRateKeyPrefix + key, nil
}

func isHashDigest(value string) bool {
	if len(value) != redisHashLength {
		return false
	}
	for _, character := range value {
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}

func parseRedisIncrementResult(result any) (int64, error) {
	values, ok := result.([]any)
	if !ok || len(values) != 2 {
		return 0, errRedisUnavailable
	}
	count, ok := redisInt64(values[0])
	if !ok || count < 1 {
		return 0, errRedisUnavailable
	}
	ttl, ok := redisInt64(values[1])
	if !ok || ttl < 0 {
		return 0, errRedisUnavailable
	}
	return count, nil
}

func redisInt64(value any) (int64, bool) {
	switch value := value.(type) {
	case int64:
		return value, true
	case int:
		return int64(value), true
	case string:
		parsed, err := strconv.ParseInt(value, 10, 64)
		return parsed, err == nil
	case []byte:
		parsed, err := strconv.ParseInt(string(value), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func (executor *redisExecutorAdapter) Eval(ctx context.Context, script string, keys []string, args ...any) (any, error) {
	return executor.client.Eval(ctx, script, keys, args...).Result()
}
