import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG, installRuntimeConfig, normalizeRuntimeConfig } from '../../src/runtime/config';

const DEFAULT_REMOTE_CONFIG_OPTIONS = [
  {
    value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini',
    text: 'ACL4SSR Online',
  },
  {
    value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini',
    text: 'ACL4SSR Online Full',
  },
  {
    value: 'https://raw.githubusercontent.com/FDUZS/subconverter-config/main/config.ini',
    text: 'FDUZS 流媒体与 AI',
  },
  {
    value: 'https://raw.githubusercontent.com/BeingFun/config4subconverter/main/customize.ini',
    text: 'BeingFun Clash / Sing-box',
  },
];

describe('normalizeRuntimeConfig', () => {
  it('uses the maintained service defaults and opt-in public configuration presets when configuration is absent', () => {
    expect(normalizeRuntimeConfig()).toEqual({
      apiUrl: 'https://api.ml1.one',
      shortUrl: '',
      menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
      remoteConfigOptions: DEFAULT_REMOTE_CONFIG_OPTIONS,
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
    expect(nextConfig.remoteConfigOptions).toEqual(DEFAULT_REMOTE_CONFIG_OPTIONS);
  });

  it('does not expose the retired UX-mode compatibility switch', () => {
    expect(normalizeRuntimeConfig({ uxMode: 'modern' })).not.toHaveProperty('uxMode');
  });

  it('keeps only supported fields and replaces invalid array values with defaults', () => {
    const config = normalizeRuntimeConfig({
      apiUrl: 'https://api.example.test',
      shortUrl: 'https://short.example.test',
      menuItem: 'not-an-array',
      remoteConfigOptions: {},
      ignored: 'value',
    });

    expect(Object.keys(config)).toEqual([
      'apiUrl',
      'shortUrl',
      'menuItem',
      'remoteConfigOptions',
    ]);
    expect(config.apiUrl).toBe('https://api.example.test');
    expect(config.shortUrl).toBe('https://short.example.test');
    expect(Array.isArray(config.menuItem)).toBe(true);
    expect(Array.isArray(config.remoteConfigOptions)).toBe(true);
  });

  it('falls back from invalid service URLs and filters malformed option entries', () => {
    const config = normalizeRuntimeConfig({
      apiUrl: 'prefixhttps://api.example.test',
      shortUrl: 'javascript:alert(1)',
      menuItem: [
        null,
        { title: 'GitHub', link: 'javascript:alert(1)' },
        { title: 'GitHub Pages', link: 'https://pages.github.com/example/project' },
        { title: 'GitHub issue', link: 'https://github.com/owner/repository/issues/1' },
      ],
      remoteConfigOptions: [
        {},
        { value: 'javascript:alert(1)', text: 'Unsafe' },
        { value: 'https://config.example.test/rules.ini', text: 'Valid' },
      ],
    });

    expect(config.apiUrl).toBe(DEFAULT_RUNTIME_CONFIG.apiUrl);
    expect(config.shortUrl).toBe(DEFAULT_RUNTIME_CONFIG.shortUrl);
    expect(config.menuItem).toEqual([]);
    expect(config.remoteConfigOptions).toEqual([
      { value: 'https://config.example.test/rules.ini', text: 'Valid' },
    ]);
  });

  it('keeps an empty short-link service value so deployments can disable the feature', () => {
    expect(normalizeRuntimeConfig({ shortUrl: '' }).shortUrl).toBe('');
  });

  it('normalizes and stores the global configuration', () => {
    const globalObject = { config: { uxMode: 'modern' } };

    const config = installRuntimeConfig(globalObject);

    expect(globalObject.config).toBe(config);
    expect(config).not.toHaveProperty('uxMode');
  });

  it('keeps the public configuration and container replacement markers aligned with runtime defaults', async () => {
    const [publicConfigSource, startScript] = await Promise.all([
      readFile(new URL('../../public/conf/config.js', import.meta.url), 'utf8'),
      readFile(new URL('../../start.sh', import.meta.url), 'utf8'),
    ]);
    const window = {};

    vm.runInNewContext(publicConfigSource, { window });

    expect(window.config).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(startScript).toContain("replace_config_value 'https://api.ml1.one' \"$API_URL\"");
    expect(startScript).toContain('shortUrl: \'\'');
    expect(startScript).toContain('SHORT_URL');
    expect(startScript).not.toContain('SITE_NAME');
  });
});
