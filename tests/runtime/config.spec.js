import { describe, expect, it } from 'vitest';
import {
  installRuntimeConfig,
  normalizeRuntimeConfig,
} from '../../src/runtime/config';

describe('normalizeRuntimeConfig', () => {
  it('uses the existing default site name and legacy UX mode by default', () => {
    const config = normalizeRuntimeConfig();

    expect(config.siteName).toBe('Subconverter Web');
    expect(config.uxMode).toBe('legacy');
  });

  it('keeps the modern UX mode', () => {
    expect(normalizeRuntimeConfig({ uxMode: 'modern' }).uxMode).toBe('modern');
  });

  it('falls back to legacy for an unknown UX mode', () => {
    expect(normalizeRuntimeConfig({ uxMode: 'experimental' }).uxMode).toBe('legacy');
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
      'uxMode',
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
    expect(config.uxMode).toBe('modern');
  });
});
