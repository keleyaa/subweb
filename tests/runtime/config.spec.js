import { describe, expect, it } from 'vitest';
import { installRuntimeConfig, normalizeRuntimeConfig } from '../../src/runtime/config';

describe('normalizeRuntimeConfig', () => {
  it('uses neutral current-project defaults when configuration is absent', () => {
    expect(normalizeRuntimeConfig()).toEqual({
      siteName: 'Subweb',
      apiUrl: 'http://127.0.0.1:25500',
      shortUrl: '',
      menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
      remoteConfigOptions: [],
    });
  });

  it('keeps default option arrays isolated from caller mutations', () => {
    const firstConfig = normalizeRuntimeConfig();

    firstConfig.menuItem[0].title = 'Changed title';
    firstConfig.menuItem.push({ title: 'Unexpected menu item' });
    firstConfig.remoteConfigOptions.push({ value: 'https://unexpected.example.test', text: 'Unexpected option' });

    const nextConfig = normalizeRuntimeConfig();

    expect(nextConfig.menuItem).toEqual([
      { title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' },
    ]);
    expect(nextConfig.remoteConfigOptions).toEqual([]);
  });

  it('does not expose the retired UX-mode compatibility switch', () => {
    expect(normalizeRuntimeConfig({ uxMode: 'modern' })).not.toHaveProperty('uxMode');
  });

  it('keeps only supported fields and replaces invalid array values with defaults', () => {
    const config = normalizeRuntimeConfig({
      siteName: 'Custom Subweb',
      apiUrl: 'https://api.example.test',
      shortUrl: 'https://short.example.test',
      menuItem: 'not-an-array',
      remoteConfigOptions: {},
      ignored: 'value',
    });

    expect(Object.keys(config)).toEqual([
      'siteName',
      'apiUrl',
      'shortUrl',
      'menuItem',
      'remoteConfigOptions',
    ]);
    expect(config.siteName).toBe('Custom Subweb');
    expect(config.apiUrl).toBe('https://api.example.test');
    expect(config.shortUrl).toBe('https://short.example.test');
    expect(Array.isArray(config.menuItem)).toBe(true);
    expect(Array.isArray(config.remoteConfigOptions)).toBe(true);
  });

  it('normalizes and stores the global configuration', () => {
    const globalObject = { config: { uxMode: 'modern' } };

    const config = installRuntimeConfig(globalObject);

    expect(globalObject.config).toBe(config);
    expect(config).not.toHaveProperty('uxMode');
  });
});
