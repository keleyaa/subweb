import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTurnstileScript, resetTurnstileScriptLoader } from '../../src/components/turnstile/loadTurnstileScript.js';

describe('Turnstile script loading', () => {
  let originalWindow;
  let originalDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
  });

  afterEach(() => {
    resetTurnstileScriptLoader();
    vi.useRealTimers();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  it('rejects and removes a script that never finishes loading', async () => {
    let script;
    globalThis.window = {};
    globalThis.document = {
      querySelector: () => null,
      createElement: () => {
        const listeners = new Map();
        script = {
          dataset: {},
          isConnected: false,
          addEventListener: (type, listener) => listeners.set(type, listener),
          remove: vi.fn(),
        };
        script.emit = (type) => listeners.get(type)?.();
        return script;
      },
      head: { appendChild: (element) => { element.isConnected = true; } },
    };

    const rejection = expect(loadTurnstileScript()).rejects.toThrow('Turnstile script failed to load');
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(script.remove).toHaveBeenCalledOnce();
  });

  it('allows a new script attempt after a timed-out load', async () => {
    let attempts = 0;
    globalThis.window = {};
    globalThis.document = {
      querySelector: () => null,
      createElement: () => {
        attempts += 1;
        const listeners = new Map();
        const script = {
          dataset: {},
          isConnected: false,
          addEventListener: (type, listener) => listeners.set(type, listener),
          remove: vi.fn(),
        };
        script.emit = (type) => listeners.get(type)?.();
        return script;
      },
      head: { appendChild: (element) => {
        element.isConnected = true;
        if (attempts === 2) queueMicrotask(() => element.emit('load'));
      } },
    };

    const firstRejection = expect(loadTurnstileScript()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await firstRejection;

    await expect(loadTurnstileScript()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});
