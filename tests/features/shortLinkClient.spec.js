import { describe, expect, it, vi } from 'vitest';

import { createShortLinkClient, ShortLinkError } from '../../src/features/short-link/client.js';

const success = {
  code: 'Ab3dE9xQ',
  shortUrl: 'https://short.example.test/Ab3dE9xQ',
  expiresAt: '2026-11-25T12:00:00.000Z',
};

describe('ShortLinkClient HTTP adapter', () => {
  it('uses the same-origin Rust endpoint and returns a validated 201 response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(success), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));
    const client = createShortLinkClient({ fetchImpl });

    await expect(client.create({ url: 'https://example.com/sub' })).resolves.toEqual(success);
    expect(fetchImpl).toHaveBeenCalledWith('/short-api/links', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/sub' }),
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      accept: 'application/json, application/problem+json',
      'content-type': 'application/json',
    });
  });

  it('preserves stable challenge details from an RFC 9457 problem response', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      type: 'https://short.example.test/problems/challenge_required',
      title: 'Challenge required',
      status: 403,
      code: 'challenge_required',
      requestId: 'req_12345678',
      challenge: { provider: 'turnstile', siteKey: 'site-key' },
    }), { status: 403, headers: { 'content-type': 'application/problem+json' } });
    const client = createShortLinkClient({ fetchImpl });

    await expect(client.create({ url: 'https://example.com' })).rejects.toMatchObject({
      name: 'ShortLinkError',
      status: 403,
      code: 'challenge_required',
      requestId: 'req_12345678',
      challenge: { provider: 'turnstile', siteKey: 'site-key' },
    });
  });

  it('bounds response-body reads with the client timeout', async () => {
    const fetchImpl = async () => new Response(new ReadableStream({ start() {} }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
    const client = createShortLinkClient({ fetchImpl, timeoutMs: 20 });
    const result = client.create({ url: 'https://example.com' });
    const outcome = await Promise.race([
      result.then(() => 'resolved', (error) => error),
      new Promise((resolve) => setTimeout(() => resolve('test timeout'), 250)),
    ]);

    expect(outcome).toMatchObject({ code: 'dependency_unavailable', status: 503 });
  });

  it('preserves the upstream request_timeout problem code', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      type: 'https://short.example.test/problems/request_timeout',
      title: 'Request timeout',
      status: 408,
      code: 'request_timeout',
      requestId: 'req_timeout',
    }), { status: 408, headers: { 'content-type': 'application/problem+json' } });
    const client = createShortLinkClient({ fetchImpl });

    await expect(client.create({ url: 'https://example.com' })).rejects.toMatchObject({
      name: 'ShortLinkError',
      status: 408,
      code: 'request_timeout',
      requestId: 'req_timeout',
    });
  });

  it.each([
    [200, success],
    [201, { ...success, expiresAt: 'not-a-date' }],
    [503, { message: 'raw upstream failure' }],
  ])('maps an invalid status or payload to dependency_unavailable', async (status, payload) => {
    const client = createShortLinkClient({
      fetchImpl: async () => new Response(JSON.stringify(payload), { status }),
    });

    await expect(client.create({ url: 'https://example.com' })).rejects.toEqual(
      expect.objectContaining({ code: 'dependency_unavailable', status: 503 }),
    );
  });

  it('maps transport failures without exposing the underlying error', async () => {
    const client = createShortLinkClient({
      fetchImpl: async () => { throw new Error('private transport detail'); },
    });

    try {
      await client.create({ url: 'https://example.com' });
      throw new Error('expected create to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ShortLinkError);
      expect(error).toMatchObject({ code: 'dependency_unavailable', message: 'dependency_unavailable' });
      expect(error.message).not.toContain('private transport detail');
    }
  });
});
