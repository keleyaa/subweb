import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { DEFAULT_RUNTIME_CONFIG, normalizeRuntimeConfig } from '../../src/runtime/config';
import { prepareConversion } from '../../src/views/home/index.js';

const subTableUrl = new URL('../../src/views/home/SubTable.vue', import.meta.url);
const publicConfigUrl = new URL('../../public/conf/config.js', import.meta.url);

const validApiUrl = 'https://converter.example.test';

describe('runtime business feature flags', () => {
  it('normalizes only public runtime fields from the new config namespace', () => {
    const config = normalizeRuntimeConfig({
      apiUrl: validApiUrl,
      shortLinksEnabled: false,
      customBackendEnabled: false,
      turnstileSiteKey: 'public-site-key',
      redisPassword: 'must-not-reach-the-browser',
      myurlsUpstream: 'http://myurls:3000',
    });

    expect(config).toEqual({
      apiUrl: validApiUrl,
      shortLinksEnabled: false,
      customBackendEnabled: false,
      turnstileSiteKey: 'public-site-key',
      menuItem: DEFAULT_RUNTIME_CONFIG.menuItem,
      remoteConfigOptions: DEFAULT_RUNTIME_CONFIG.remoteConfigOptions,
    });
  });

  it('keeps the existing public defaults when flags are absent', () => {
    expect(normalizeRuntimeConfig({ apiUrl: validApiUrl })).toMatchObject({
      apiUrl: validApiUrl,
      shortLinksEnabled: true,
      customBackendEnabled: true,
      turnstileSiteKey: '',
    });
  });

  it('forces the configured API when custom backends are disabled', () => {
    const result = prepareConversion({
      urls: 'https://subscription.example.test/list',
      api: 'https://attacker.example.test',
      apiUrl: validApiUrl,
      target: 'clash',
      remoteConfig: '',
      isShowManualApiUrl: true,
      isShowRemoteConfig: false,
      isShowMoreConfig: false,
      customBackendEnabled: false,
      moreConfig: {},
    });

    expect(result).toMatchObject({ ok: true, api: validApiUrl });
    expect(result.subUrl).toContain(`${validApiUrl}/sub?`);
    expect(result.subUrl).not.toContain('attacker.example.test');
  });

  it('gates short-link and custom-backend controls in the component source', async () => {
    const source = await readFile(subTableUrl, 'utf8');
    expect(source).toContain('v-if="shortLinksEnabled"');
    expect(source).toContain('v-if="customBackendEnabled"');
    expect(source).toContain('shortLinkWorkflow: runtimeConfig.shortLinksEnabled');
    expect(source).toContain('customBackendEnabled: runtimeConfig.customBackendEnabled');
    expect(source).toContain('const runtimeConfig = window.__SUBWEB_CONFIG__ ?? window.config;');
  });

  it('publishes the feature flags through the public config namespace', async () => {
    const source = await readFile(publicConfigUrl, 'utf8');
    expect(source).toContain('window.__SUBWEB_CONFIG__');
    expect(source).toContain('shortLinksEnabled: true');
    expect(source).toContain('customBackendEnabled: true');
    expect(source).toContain("turnstileSiteKey: ''");
    expect(source).not.toContain('REDIS');
    expect(source).not.toContain('SECRET');
  });
});
