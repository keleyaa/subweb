import { createHmac } from 'node:crypto';

export class RateLimitError extends Error {
  constructor(code, status, retryAfter = 0) {
    super(code);
    this.name = 'RateLimitError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const checkRateLimit = async ({ increment, key, limit, windowSeconds }) => {
  let result;
  try {
    result = await increment(key, windowSeconds);
  } catch {
    throw new RateLimitError('rate_store_unavailable', 503);
  }

  const count = Number(result?.count);
  const ttlSeconds = Number(result?.ttlSeconds);
  const retryAfter = Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : windowSeconds;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RateLimitError('rate_store_unavailable', 503);
  }
  if (count > limit) throw new RateLimitError('rate_limited', 429, retryAfter);

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    retryAfter,
  };
};

export const createIpHash = (ip, secret) => createHmac('sha256', secret).update(ip).digest('hex');

export const createRedisIncrement = (redisClient) => async (key, windowSeconds) => {
  const result = await redisClient.eval(
    'local count = redis.call("INCR", KEYS[1]); local ttl = redis.call("TTL", KEYS[1]); if ttl < 0 then redis.call("EXPIRE", KEYS[1], ARGV[1]); ttl = redis.call("TTL", KEYS[1]); end; return { count, ttl }',
    { keys: [key], arguments: [String(windowSeconds)] },
  );

  if (!Array.isArray(result)) throw new Error('invalid redis rate result');
  return { count: Number(result[0]), ttlSeconds: Number(result[1]) };
};
