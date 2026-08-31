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
      egressProxyPort: 25502,
      egressConnectTimeoutMs: 5000,
      upstreamBaseUrl: 'http://subconverter:25500',
      ipHashSecret: secret,
    });
  });

  it('rejects an invalid egress proxy port', () => {
    vi.stubEnv('EGRESS_PROXY_PORT', '0');
    expect(() => loadConfig()).toThrow('EGRESS_PROXY_PORT');
  });

  it('rejects numeric settings outside the safe integer range', () => {
    vi.stubEnv('CONVERSION_MAX_RESPONSE_BYTES', '9'.repeat(30));
    expect(() => loadConfig()).toThrow('CONVERSION_MAX_RESPONSE_BYTES');
  });

  it('caps request and response buffers at operational limits', () => {
    vi.stubEnv('CONVERSION_MAX_REQUEST_BYTES', String(1024 * 1024 + 1));
    expect(() => loadConfig()).toThrow('CONVERSION_MAX_REQUEST_BYTES');

    vi.stubEnv('CONVERSION_MAX_REQUEST_BYTES', '16384');
    vi.stubEnv('CONVERSION_MAX_RESPONSE_BYTES', String(64 * 1024 * 1024 + 1));
    expect(() => loadConfig()).toThrow('CONVERSION_MAX_RESPONSE_BYTES');
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
