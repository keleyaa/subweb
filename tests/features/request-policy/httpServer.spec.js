import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPolicyServer } from '../../../services/request-policy/src/server.mjs';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

const startServer = async (overrides = {}) => {
  const logs = [];
  const upstreamFetch = vi.fn().mockResolvedValue(
    new Response('converted output', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
  );
  const rateStore = { increment: vi.fn().mockResolvedValue({ count: 1, ttlSeconds: 60 }) };
  const server = createPolicyServer({
    lookup: publicDns,
    upstreamFetch,
    rateStore,
    logger: (entry) => logs.push(entry),
    config: {
      upstreamBaseUrl: 'http://subconverter:25500',
      ipHashSecret: 'test-secret',
      rateLimit: 10,
      rateWindowSeconds: 60,
      maxResponseBytes: 1024,
      requestTimeoutMs: 1000,
      maxConcurrency: 2,
    },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}`, upstreamFetch, rateStore, logs };
};

describe('request policy HTTP server', () => {
  it('forwards validated conversion queries and returns upstream content', async () => {
    const context = await startServer();
    try {
      const response = await fetch(`${context.url}/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsub`, {
        headers: { 'x-real-ip': '203.0.113.10' },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('converted output');
      expect(context.upstreamFetch).toHaveBeenCalledWith(
        'http://subconverter:25500/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsub',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(context.rateStore.increment).toHaveBeenCalledWith(expect.stringMatching(/^subweb:rate:convert:/), 60);
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });

  it('rejects private inputs before the upstream is contacted', async () => {
    const context = await startServer();
    try {
      const response = await fetch(`${context.url}/sub?target=clash&url=https%3A%2F%2F127.0.0.1%2Fadmin`);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: { code: 'private_address' } });
      expect(context.upstreamFetch).not.toHaveBeenCalled();
      expect(context.logs[0]).toMatchObject({ status: 403, errorCode: 'private_address' });
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });

  it('returns 429 with Retry-After when the anonymous quota is exhausted', async () => {
    const context = await startServer({
      rateStore: { increment: vi.fn().mockResolvedValue({ count: 11, ttlSeconds: 37 }) },
    });
    try {
      const response = await fetch(`${context.url}/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsub`);
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('37');
      expect(await response.json()).toEqual({ error: { code: 'rate_limited' } });
      expect(context.upstreamFetch).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });

  it('fails closed with 503 when Redis cannot serve the quota', async () => {
    const context = await startServer({
      rateStore: { increment: vi.fn().mockRejectedValue(new Error('redis unavailable')) },
    });
    try {
      const response = await fetch(`${context.url}/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsub`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: 'rate_store_unavailable' } });
      expect(context.upstreamFetch).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });

  it('does not log URL, query, IP, or upstream secrets', async () => {
    const context = await startServer();
    try {
      await fetch(`${context.url}/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsecret-token` , {
        headers: { 'x-real-ip': '203.0.113.10', 'x-request-id': 'request-123' },
      });

      expect(context.logs).toHaveLength(1);
      expect(context.logs[0]).toMatchObject({ requestId: 'request-123', route: '/sub', status: 200 });
      expect(JSON.stringify(context.logs)).not.toContain('secret-token');
      expect(JSON.stringify(context.logs)).not.toContain('203.0.113.10');
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });

  it.each(['/unknown', '/sub/extra'])('rejects unsupported route %s', async (path) => {
    const context = await startServer();
    try {
      const response = await fetch(`${context.url}${path}`);
      expect(response.status).toBe(404);
    } finally {
      await new Promise((resolve) => context.server.close(resolve));
    }
  });
});
