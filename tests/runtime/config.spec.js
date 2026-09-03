import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  installRuntimeConfig,
  normalizeRuntimeConfig,
  resolveRuntimeConfig,
} from '../../src/runtime/config';

describe('normalizeRuntimeConfig', () => {
  it('keeps only the public converter and curated option fields', () => {
    const config = normalizeRuntimeConfig({
      apiUrl: 'https://api.example.test',
      shortUrl: 'https://retired.example.test',
      ignored: 'value',
    });
    expect(Object.keys(config)).toEqual([
      'apiUrl',
      'shortLinksEnabled',
      'customBackendEnabled',
      'turnstileSiteKey',
      'menuItem',
      'remoteConfigOptions',
    ]);
    expect(config.apiUrl).toBe('https://api.example.test');
    expect(config).not.toHaveProperty('shortUrl');
  });

  it('isolates defaults and filters unsafe options', () => {
    const first = normalizeRuntimeConfig();
    first.menuItem.push({ title: 'Unexpected' });
    const next = normalizeRuntimeConfig({
      apiUrl: 'javascript:alert(1)',
      menuItem: [{ title: 'Unsafe', link: 'javascript:alert(1)' }],
      remoteConfigOptions: [
        { value: 'javascript:alert(1)', text: 'Unsafe' },
        { value: 'https://config.example.test/rules.ini', text: 'Valid' },
      ],
    });
    expect(next.apiUrl).toBe(DEFAULT_RUNTIME_CONFIG.apiUrl);
    expect(next.menuItem).toEqual([]);
    expect(next.remoteConfigOptions).toEqual([{ value: 'https://config.example.test/rules.ini', text: 'Valid' }]);
    expect(normalizeRuntimeConfig().menuItem).toHaveLength(1);
  });

  it('normalizes and stores the global configuration', () => {
    const globalObject = { config: { uxMode: 'modern' } };
    const config = installRuntimeConfig(globalObject);
    expect(globalObject.config).toBe(config);
    expect(config).not.toHaveProperty('uxMode');
  });

  it('keeps local development conversion traffic on the loopback Gateway', () => {
    const config = resolveRuntimeConfig(
      { __SUBWEB_CONFIG__: { apiUrl: 'https://api.ml1.one', shortLinksEnabled: true } },
      'http://127.0.0.1:18081',
    );

    expect(config.apiUrl).toBe('http://127.0.0.1:18081');
    expect(config.shortLinksEnabled).toBe(true);
  });

  it('keeps the public template secret-free', async () => {
    const publicSource = await readFile(new URL('../../public/conf/config.js', import.meta.url), 'utf8');
    const window = {};
    vm.runInNewContext(publicSource, { window });
    expect(window.__SUBWEB_CONFIG__).toEqual({
      ...DEFAULT_RUNTIME_CONFIG,
      menuItem: DEFAULT_RUNTIME_CONFIG.menuItem,
      remoteConfigOptions: DEFAULT_RUNTIME_CONFIG.remoteConfigOptions,
    });
    expect(window.config).toBe(window.__SUBWEB_CONFIG__);
    expect(publicSource).not.toMatch(/SECRET|TOKEN|PASSWORD/u);
  });
});
