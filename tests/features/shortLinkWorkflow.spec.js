import { describe, expect, it, vi } from 'vitest';

import { ShortLinkError } from '../../src/features/short-link/client.js';
import {
  createShortLinkWorkflow,
  MAX_SHORT_LINK_URL_BYTES,
  utf8ByteLength,
} from '../../src/features/short-link/workflow.js';

const result = {
  code: 'Ab3dE9xQ',
  shortUrl: 'https://short.example.test/Ab3dE9xQ',
  expiresAt: '2026-11-25T12:00:00.000Z',
};

const execute = ({ client, copy = vi.fn(async () => undefined), input = {} }) => {
  const workflow = createShortLinkWorkflow({ client, copy });
  return workflow.execute({
    url: 'https://example.com/sub',
    conversionKey: 'current',
    isCurrent: (key) => key === 'current',
    ...input,
  });
};

describe('ShortLinkWorkflow interface', () => {
  it('returns a copied success through the client interface', async () => {
    const client = { create: vi.fn(async () => result) };
    const copy = vi.fn(async () => undefined);

    await expect(execute({ client, copy })).resolves.toEqual({ kind: 'success', result, copied: true });
    expect(client.create).toHaveBeenCalledWith({ url: 'https://example.com/sub' });
    expect(copy).toHaveBeenCalledWith(result.shortUrl);
  });

  it('discards a result when the conversion changes during copying', async () => {
    let current = true;
    const outcome = await execute({
      client: { create: async () => result },
      copy: async () => { current = false; },
      input: { isCurrent: () => current },
    });

    expect(outcome).toEqual({ kind: 'stale' });
  });

  it('keeps a successful result when clipboard access fails', async () => {
    const outcome = await execute({
      client: { create: async () => result },
      copy: async () => { throw new Error('denied'); },
    });

    expect(outcome).toEqual({ kind: 'success', result, copied: false });
  });

  it('returns stale without copying when the conversion input changed', async () => {
    const copy = vi.fn();
    const workflow = createShortLinkWorkflow({ client: { create: async () => result }, copy });

    await expect(workflow.execute({
      url: 'https://example.com/sub',
      conversionKey: 'old',
      isCurrent: () => false,
    })).resolves.toEqual({ kind: 'stale' });
    expect(copy).not.toHaveBeenCalled();
  });

  it('does not call the client for an already-cancelled conversion', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = { create: vi.fn() };
    const workflow = createShortLinkWorkflow({ client, copy: vi.fn() });

    await expect(workflow.execute({
      url: 'https://example.com/sub',
      conversionKey: 'current',
      isCurrent: () => true,
      signal: controller.signal,
    })).resolves.toEqual({ kind: 'stale' });
    expect(client.create).not.toHaveBeenCalled();
  });

  it('cancels an in-flight request when the conversion becomes stale', async () => {
    let current = true;
    const controller = new AbortController();
    const client = {
      create: vi.fn((_input, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })),
    };
    const workflow = createShortLinkWorkflow({ client, copy: vi.fn() });
    const request = workflow.execute({
      url: 'https://example.com/sub',
      conversionKey: 'current',
      isCurrent: () => current,
      signal: controller.signal,
    });

    current = false;
    controller.abort();

    await expect(request).resolves.toEqual({ kind: 'stale' });
    expect(client.create).toHaveBeenCalledWith(
      { url: 'https://example.com/sub' },
      { signal: controller.signal },
    );
  });

  it('returns challenge information and forwards a challenge token on retry', async () => {
    const challenge = { provider: 'turnstile', siteKey: 'site-key' };
    const client = {
      create: vi.fn()
        .mockRejectedValueOnce(new ShortLinkError({ status: 403, code: 'challenge_required', challenge }))
        .mockResolvedValueOnce(result),
    };

    await expect(execute({ client })).resolves.toMatchObject({ kind: 'challenge', challenge });
    await expect(execute({ client, input: { challengeToken: 'test-token' } })).resolves.toMatchObject({
      kind: 'success',
    });
    expect(client.create).toHaveBeenLastCalledWith({
      url: 'https://example.com/sub',
      challengeToken: 'test-token',
    });
  });

  it('rejects a URL over the UTF-8 byte limit before calling the client', async () => {
    const client = { create: vi.fn() };
    const url = 'https://example.com/' + '中'.repeat(1400);
    const outcome = await execute({ client, input: { url } });

    expect(utf8ByteLength(url)).toBeGreaterThan(MAX_SHORT_LINK_URL_BYTES);
    expect(outcome).toMatchObject({
      kind: 'error',
      code: 'url_too_long',
      maxBytes: MAX_SHORT_LINK_URL_BYTES,
    });
    expect(client.create).not.toHaveBeenCalled();
  });

  it('maps request timeout errors to a retryable user message', async () => {
    const outcome = await execute({
      client: {
        create: async () => {
          throw new ShortLinkError({ status: 408, code: 'request_timeout' });
        },
      },
    });

    expect(outcome).toEqual({
      kind: 'error',
      code: 'request_timeout',
      message: '短链服务处理超时，请稍后重试。',
      retryAfterSeconds: undefined,
    });
  });

  it('maps rate-limit metadata to an actionable outcome', async () => {
    const outcome = await execute({
      client: {
        create: async () => {
          throw new ShortLinkError({ status: 429, code: 'rate_limited', retryAfterSeconds: 120 });
        },
      },
    });

    expect(outcome).toMatchObject({ kind: 'error', code: 'rate_limited', retryAfterSeconds: 120 });
  });
});
