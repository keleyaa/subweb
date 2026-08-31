import { describe, expect, it, vi } from 'vitest';
import {
  RateLimitError,
  checkRateLimit,
  createIpHash,
  createRedisIncrement,
} from '../../../services/request-policy/src/rate-limiter.mjs';

describe('request policy rate limiting', () => {
  it('allows requests below the limit and reports remaining capacity', async () => {
    const increment = vi.fn().mockResolvedValue({ count: 3, ttlSeconds: 42 });

    await expect(
      checkRateLimit({ increment, key: 'rate-key', limit: 10, windowSeconds: 60 }),
    ).resolves.toEqual({ allowed: true, remaining: 7, retryAfter: 42 });
    expect(increment).toHaveBeenCalledWith('rate-key', 60);
  });

  it('falls back to the configured window for an invalid Redis TTL', async () => {
    const increment = vi.fn().mockResolvedValue({ count: 11, ttlSeconds: Number.POSITIVE_INFINITY });

    await expect(
      checkRateLimit({ increment, key: 'rate-key', limit: 10, windowSeconds: 60 }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfter: 60,
    });
  });

  it('rejects requests over the limit with a stable Retry-After value', async () => {
    const increment = vi.fn().mockResolvedValue({ count: 11, ttlSeconds: 37 });

    await expect(
      checkRateLimit({ increment, key: 'rate-key', limit: 10, windowSeconds: 60 }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfter: 37,
    });
  });

  it('fails closed when the rate store is unavailable', async () => {
    const increment = vi.fn().mockRejectedValue(new Error('redis unavailable'));

    await expect(
      checkRateLimit({ increment, key: 'rate-key', limit: 10, windowSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'rate_store_unavailable', status: 503 });
  });

  it('does not leak the key or client identity in the error', async () => {
    const error = new RateLimitError('rate_limited', 429, 15, 'secret-rate-key');

    expect(error.message).toBe('rate_limited');
    expect(error.message).not.toContain('secret-rate-key');
  });

  it('normalizes the Redis Lua counter result', async () => {
    const redisClient = { eval: vi.fn().mockResolvedValue([3, 57]) };

    await expect(createRedisIncrement(redisClient)('rate-key', 60)).resolves.toEqual({
      count: 3,
      ttlSeconds: 57,
    });
    expect(redisClient.eval).toHaveBeenCalledWith(expect.stringContaining('TTL'), {
      keys: ['rate-key'],
      arguments: ['60'],
    });
  });

  it('creates stable, non-reversible-looking IP hashes', () => {
    const first = createIpHash('203.0.113.10', 'test-secret');
    const second = createIpHash('203.0.113.10', 'test-secret');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('203.0.113.10');
    expect(createIpHash('203.0.113.11', 'test-secret')).not.toBe(first);
  });
});
