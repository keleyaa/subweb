import { describe, expect, it, vi } from 'vitest';
import { copyText } from '../../../src/features/clipboard/copy.js';

describe('copyText', () => {
  it('uses the asynchronous Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn();

    await expect(
      copyText('subscription-url', {
        navigatorObject: { clipboard: { writeText } },
        documentObject: { execCommand },
      })
    ).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledWith('subscription-url');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand and removes its temporary input', async () => {
    const removeChild = vi.fn();
    const input = {
      setAttribute: vi.fn(),
      select: vi.fn(),
      parentNode: { removeChild },
    };
    const documentObject = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => input),
      execCommand: vi.fn(() => true),
    };

    await expect(copyText('short-url', { navigatorObject: {}, documentObject })).resolves.toBeUndefined();

    expect(input.setAttribute).toHaveBeenCalledWith('value', 'short-url');
    expect(documentObject.execCommand).toHaveBeenCalledWith('copy');
    expect(removeChild).toHaveBeenCalledWith(input);
  });

  it('rejects when neither clipboard implementation can copy the value', async () => {
    const input = {
      setAttribute: vi.fn(),
      select: vi.fn(),
      parentNode: { removeChild: vi.fn() },
    };
    const documentObject = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => input),
      execCommand: vi.fn(() => false),
    };

    await expect(copyText('value', { navigatorObject: {}, documentObject })).rejects.toThrow('copy failed');
  });
});
