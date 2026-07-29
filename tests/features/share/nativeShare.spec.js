import { describe, expect, it, vi } from 'vitest';
import { shareUrl } from '../../../src/features/share/nativeShare';

describe('native subscription sharing', () => {
  it('treats empty, whitespace-only, and non-string URLs as missing without invoking share', async () => {
    const share = vi.fn();
    const navigatorObject = { share };

    await expect(shareUrl('', navigatorObject)).resolves.toEqual({ status: 'missing' });
    await expect(shareUrl('   ', navigatorObject)).resolves.toEqual({ status: 'missing' });
    await expect(shareUrl(null, navigatorObject)).resolves.toEqual({ status: 'missing' });
    await expect(shareUrl(42, navigatorObject)).resolves.toEqual({ status: 'missing' });

    expect(share).not.toHaveBeenCalled();
  });

  it('reports unsupported when navigator or navigator.share is unavailable', async () => {
    await expect(shareUrl('https://subscription.example.test', null)).resolves.toEqual({
      status: 'unsupported',
    });
    await expect(shareUrl('https://subscription.example.test', {})).resolves.toEqual({ status: 'unsupported' });
  });

  it('reports failed when reading the native share capability throws', async () => {
    const navigatorObject = {
      get share() {
        throw new Error('capability lookup failed');
      },
    };

    await expect(shareUrl('https://subscription.example.test', navigatorObject)).resolves.toEqual({ status: 'failed' });
  });

  it('shares the trimmed URL exactly once when the native API succeeds', async () => {
    const share = vi.fn().mockResolvedValue();

    await expect(shareUrl(' https://subscription.example.test/path ', { share })).resolves.toEqual({
      status: 'shared',
    });

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url: 'https://subscription.example.test/path' });
  });

  it('reports cancellation for AbortError', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';

    await expect(
      shareUrl('https://subscription.example.test', { share: vi.fn().mockRejectedValue(abortError) })
    ).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports failed for synchronous and asynchronous sharing errors', async () => {
    await expect(
      shareUrl('https://subscription.example.test', {
        share() {
          throw new Error('sync failure');
        },
      })
    ).resolves.toEqual({ status: 'failed' });

    await expect(
      shareUrl('https://subscription.example.test', {
        share: vi.fn().mockRejectedValue(new Error('async failure')),
      })
    ).resolves.toEqual({ status: 'failed' });
  });
});
