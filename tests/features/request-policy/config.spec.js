import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../services/request-policy/src/config.mjs';

const secret = '01234567890123456789012345678901';

beforeEach(() => {
  vi.stubEnv('PORT', '25501');
  vi.stubEnv('SUBCONVERTER_UPSTREAM', 'http://subconverter:25500');
  vi.stubEnv('REDIS_URL', 'redis://redis:6379/1');
  vi.stubEnv('REDIS_PASSWORD', 'redis-password');
  vi.stubEnv('IP_HASH_SECRET', secret);
});

afterEach(() => vi.unstubAllEnvs());

describe('request policy configuration', () => {
  it('accepts an internal HTTP upstream without credentials', () => {
    expect(loadConfig()).toMatchObject({
      port: 25501,
      upstreamBaseUrl: 'http://subconverter:25500',
      ipHashSecret: secret,
    });
  });

  it('rejects non-HTTP upstream protocols', () => {
    vi.stubEnv('SUBCONVERTER_UPSTREAM', 'file:///tmp/subconverter');
    expect(() => loadConfig()).toThrow('HTTP(S) URL');
  });

  it('rejects upstream credentials', () => {
    vi.stubEnv('SUBCONVERTER_UPSTREAM', 'http://user:password@subconverter:25500');
    expect(() => loadConfig()).toThrow('HTTP(S) URL');
  });

  it('rejects a weak IP hash secret', () => {
    vi.stubEnv('IP_HASH_SECRET', 'short-secret');
    expect(() => loadConfig()).toThrow('at least 32 characters');
  });
});
