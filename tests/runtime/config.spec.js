import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG, installRuntimeConfig, normalizeRuntimeConfig } from '../../src/runtime/config';

describe('normalizeRuntimeConfig', () => {
  it('keeps only the public converter and curated option fields', () => {
    const config = normalizeRuntimeConfig({
      apiUrl: 'https://api.example.test',
      shortUrl: 'https://retired.example.test',
      ignored: 'value',
    });
    expect(Object.keys(config)).toEqual(['apiUrl', 'menuItem', 'remoteConfigOptions']);
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

  it('keeps the public template secret-free and the container API marker aligned', async () => {
    const [publicSource, startScript] = await Promise.all([
      readFile(new URL('../../public/conf/config.js', import.meta.url), 'utf8'),
      readFile(new URL('../../start.sh', import.meta.url), 'utf8'),
    ]);
    const window = {};
    vm.runInNewContext(publicSource, { window });
    expect(window.config).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(startScript).toContain('缺少必需的 API_URL');
    expect(startScript).toContain('apiUrl:');
    expect(startScript).not.toContain('SHORT_URL');
    expect(publicSource).not.toMatch(/SECRET|TOKEN|PASSWORD/u);
  });
});
