import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSubLink } from '../../../src/views/home/index.js';

const sourcePath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));

describe('SubTable configuration layout', () => {
  it('keeps the conversion controls in their expected linear order', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const subscriptionUrlsIndex = source.indexOf('id="subscription-urls"');
    const clientIndex = source.indexOf('id="client"');
    const remoteIndex = source.indexOf('id="remote"');
    const subscriptionBackendIndex = source.indexOf('id="subscription-backend-toggle"');
    const apiIndex = source.indexOf('id="api"');
    const moreConfigIndex = source.indexOf('id="more-config-toggle"');
    const moreConfigIncludeIndex = source.indexOf('id="more-config-include"');
    const moreConfigExcludeIndex = source.indexOf('id="more-config-exclude"');
    const primaryActionIndex = source.indexOf('class="primary-action-row"');
    const convertedSubUrlIndex = source.indexOf('id="converted-sub-url"');
    const shortUrlResultIndex = source.indexOf('id="short-url-result"');

    expect(subscriptionUrlsIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(subscriptionUrlsIndex);
    expect(remoteIndex).toBeGreaterThan(clientIndex);
    expect(subscriptionBackendIndex).toBeGreaterThan(remoteIndex);
    expect(apiIndex).toBeGreaterThan(subscriptionBackendIndex);
    expect(moreConfigIndex).toBeGreaterThan(apiIndex);
    expect(moreConfigIncludeIndex).toBeGreaterThan(moreConfigIndex);
    expect(moreConfigExcludeIndex).toBeGreaterThan(moreConfigIncludeIndex);
    expect(primaryActionIndex).toBeGreaterThan(moreConfigExcludeIndex);
    expect(convertedSubUrlIndex).toBeGreaterThan(primaryActionIndex);
    expect(shortUrlResultIndex).toBeGreaterThan(convertedSubUrlIndex);
  });

  it('contains no local template UI, state, imports, or browser storage access', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const forbiddenMarkers = [
      ['template', 'controls'].join('-'),
      ['template', 'name'].join('-'),
      ['saved', 'template'].join('-'),
      `${'保存'}${'模板'}`,
      `${'应用'}${'模板'}`,
      `${'本机'}${'模板'}`,
      `${'清空'}${'模板'}`,
      ['loadLocal', 'Templates'].join(''),
      ['saveLocal', 'Templates'].join(''),
      ['selected', 'TemplateId'].join(''),
      ['template', 'Name'].join(''),
      ['templates', ': []'].join(''),
      ['this', 'templates'].join('.'),
      ['create', 'TemplateId'].join(''),
      ['save', 'Template'].join(''),
      ['apply', 'Template'].join(''),
      ['delete', 'Template'].join(''),
      ['clear', 'Templates'].join(''),
      ['features', 'templates'].join('/'),
      ['local', 'Storage'].join(''),
    ];

    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
  });

  it('uses collapsed subscription-backend and advanced-parameter status rows initially', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/isShowMoreConfig:\s*false/);
    expect(source).toMatch(/isShowServiceSettings:\s*false/);
    expect(source).toContain('订阅后端');
    expect(source).toContain('默认后端');
    expect(source).toContain('advancedConfigStatus');
    expect(source).toContain('未设置');
    expect(source).not.toContain('<span>服务设置</span>');
  });

  it('keeps advanced parameter edits as a draft until an explicit save or reset action', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('moreConfigDraft');
    expect(source).toContain('applyMoreConfig');
    expect(source).toContain('resetMoreConfig');
    expect(source).toContain('保存高级参数');
    expect(source).toContain('重置高级参数');
  });

  it('names the blank remote-config choice as the backend built-in configuration', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('<option value="">后端默认配置</option>');
    expect(source).toContain('请先输入远程配置地址，或选择后端默认配置');
  });

  it('omits the config parameter for the backend default and encodes selected presets', () => {
    const api = 'https://api.ml1.one';
    const urls = 'https://subscription.example.test/a\nhttps://subscription.example.test/b';
    const target = 'clash';
    const moreConfig = {};
    const remotePreset =
      'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini';

    const backendDefaultLink = getSubLink(urls, api, target, '', false, moreConfig);
    const remotePresetLink = getSubLink(urls, api, target, remotePreset, false, moreConfig);

    expect(backendDefaultLink).toBe(
      'https://api.ml1.one/sub?target=clash&url=https%3A%2F%2Fsubscription.example.test%2Fa%7Chttps%3A%2F%2Fsubscription.example.test%2Fb',
    );
    expect(backendDefaultLink).not.toContain('config=');
    expect(remotePresetLink).toBe(backendDefaultLink + '&config=' + encodeURIComponent(remotePreset));
  });
});
