import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolicyServer } from '../../../services/request-policy/src/server.mjs';

const config = {
  upstreamBaseUrl: 'http://subconverter:25500',
  ipHashSecret: '01234567890123456789012345678901',
  rateLimit: 10,
  rateWindowSeconds: 60,
  maxRequestBytes: 4096,
  maxResponseBytes: 32,
  requestTimeoutMs: 100,
  maxConcurrency: 1,
};

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

describe('request policy server boundaries', () => {
  let rateStore;
  let upstreamFetch;
  let lookup;
  let logger;

  beforeEach(() => {
    rateStore = { increment: vi.fn(async () => ({ count: 1, ttlSeconds: 60 })) };
    lookup = async () => [{ address: '93.184.216.34' }];
    upstreamFetch = vi.fn(async () => new Response('converted', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    logger = vi.fn();
  });

  it('forwards a validated conversion without logging the query', async () => {
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`, {
      headers: { 'x-real-ip': '198.51.100.20' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('converted');
    expect(upstreamFetch).toHaveBeenCalledWith(
      'http://subconverter:25500/sub?target=clash&url=https%3A%2F%2Fexample.com%2Ffeed',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('example.com/feed');
    await close(server);
  });

  it('rejects private targets before contacting the upstream', async () => {
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://127.0.0.1/admin')}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'private_address' } });
    expect(upstreamFetch).not.toHaveBeenCalled();
    await close(server);
  });

  it('returns retry information when the rate store rejects the request', async () => {
    rateStore.increment.mockResolvedValue({ count: 11, ttlSeconds: 42 });
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(await response.json()).toEqual({ error: { code: 'rate_limited' } });
    expect(upstreamFetch).not.toHaveBeenCalled();
    await close(server);
  });

  it('fails closed when the rate store is unavailable', async () => {
    rateStore.increment.mockRejectedValue(new Error('redis unavailable'));
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'rate_store_unavailable' } });
    expect(upstreamFetch).not.toHaveBeenCalled();
    await close(server);
  });

  it('rejects an oversized upstream response', async () => {
    upstreamFetch.mockResolvedValue(new Response('this response is definitely too long for the configured limit', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: 'response_too_large' } });
    await close(server);
  });

  it('rejects unsupported upstream content types', async () => {
    upstreamFetch.mockResolvedValue(new Response('<html>blocked</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'unsupported_content_type' } });
    await close(server);
  });

  it('times out while reading a slow upstream response body', async () => {
    upstreamFetch.mockImplementation(async (_url, { signal }) => new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        },
      }),
      { status: 200, headers: { 'content-type': 'text/plain' } },
    ));
    const server = createPolicyServer({
      config: { ...config, requestTimeoutMs: 20 },
      rateStore,
      lookup,
      upstreamFetch,
      logger,
    });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: { code: 'upstream_timeout' } });
    await close(server);
  });

  it('cancels an upstream stream that exceeds the response limit', async () => {
    let cancelled = false;
    upstreamFetch.mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(64));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200, headers: { 'content-type': 'text/plain' } },
    ));
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: 'response_too_large' } });
    expect(cancelled).toBe(true);
    await close(server);
  });

  it('does not open the circuit for upstream client errors', async () => {
    upstreamFetch
      .mockResolvedValueOnce(new Response('bad request', { status: 400, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('bad request', { status: 400, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('bad request', { status: 400, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('bad request', { status: 400, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('bad request', { status: 400, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('converted', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const server = createPolicyServer({ config, rateStore, lookup, upstreamFetch, logger });
    const port = await listen(server);
    const requestUrl = `http://127.0.0.1:${port}/sub?target=clash&url=${encodeURIComponent('https://example.com/feed')}`;

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(requestUrl);
      expect(response.status).toBe(400);
    }
    const finalResponse = await fetch(requestUrl);

    expect(finalResponse.status).toBe(200);
    expect(await finalResponse.text()).toBe('converted');
    expect(upstreamFetch).toHaveBeenCalledTimes(6);
    await close(server);
  });
});
