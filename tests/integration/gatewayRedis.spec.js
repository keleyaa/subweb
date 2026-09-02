import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const gatewayRoot = path.join(root, 'services/gateway');
const goModPath = path.join(gatewayRoot, 'go.mod');
const redisSourcePath = path.join(gatewayRoot, 'internal/ratelimit/redis.go');
const hashSourcePath = path.join(gatewayRoot, 'internal/privacy/hash.go');
const redisIntegrationRequested = process.env.RUN_REDIS_INTEGRATION === '1';
const redisIntegrationConfigured = Boolean(process.env.REDIS_URL && process.env.REDIS_PASSWORD);
const goAvailable = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0;
const redisIntegrationEnabled = redisIntegrationRequested && redisIntegrationConfigured && goAvailable;

describe('Go Gateway Redis rate-limit contract', () => {
  it('uses the dedicated go-redis client and conversion namespace', async () => {
    const [goMod, redisSource] = await Promise.all([
      readFile(goModPath, 'utf8'),
      readFile(redisSourcePath, 'utf8'),
    ]);

    expect(goMod).toMatch(/github\.com\/redis\/go-redis\/v9\s+v[0-9.]+/u);
    expect(redisSource).toContain('options.DB = 1');
    expect(redisSource).toContain('options.Password = password');
    expect(redisSource).toContain('conversionRateKeyPrefix = "subweb:rate:convert:"');
    expect(redisSource).toContain('subweb:rate:convert:');
  });

  it('keeps counter increment and expiry in one Lua operation', async () => {
    const redisSource = await readFile(redisSourcePath, 'utf8');

    expect(redisSource).toContain('redisIncrementScript');
    expect(redisSource).toMatch(/redis\.call\(\\?"INCR"/u);
    expect(redisSource).toMatch(/redis\.call\(\\?"TTL"/u);
    expect(redisSource).toMatch(/redis\.call\(\\?"EXPIRE"/u);
    expect(redisSource).toContain('store.executor.Eval(');
    expect(redisSource).toContain('return { count, ttl }');
  });

  it('allows only hashed identifiers into Redis and never logs identities', async () => {
    const [redisSource, hashSource] = await Promise.all([
      readFile(redisSourcePath, 'utf8'),
      readFile(hashSourcePath, 'utf8'),
    ]);

    expect(redisSource).toContain('namespacedConversionKey');
    expect(redisSource).toContain('if !isHashDigest(key)');
    expect(redisSource).toContain('strings.HasPrefix(key, conversionRateKeyPrefix)');
    expect(redisSource).not.toMatch(/log\.(?:Print|Printf|Println)/u);
    expect(hashSource).toContain('hmac.New(sha256.New, hasher.secret)');
    expect(hashSource).toContain('hex.EncodeToString');
    expect(hashSource).toContain('netip.ParseAddr(ip)');
    expect(hashSource).not.toMatch(/log\.(?:Print|Printf|Println)/u);
  });

  it.skipIf(!redisIntegrationEnabled)(
    'runs the opt-in Redis integration test against the configured instance',
    () => {
      const result = spawnSync(
        'go',
        [
          'test',
          '-race',
          './internal/ratelimit',
          '-run',
          '^TestRedisStoreAgainstIntegrationRedis$',
          '-count=1',
        ],
        {
          cwd: gatewayRoot,
          encoding: 'utf8',
          env: { ...process.env, RUN_REDIS_INTEGRATION: '1' },
          timeout: 120_000,
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
    120_000,
  );
});
