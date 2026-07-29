import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));

describe('SubTable configuration layout', () => {
  it('keeps the conversion controls in their expected linear order', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const subscriptionUrlsIndex = source.indexOf('id="subscription-urls"');
    const clientIndex = source.indexOf('id="client"');
    const apiIndex = source.indexOf('id="api"');
    const remoteIndex = source.indexOf('id="remote"');
    const moreConfigIndex = source.indexOf('id="more-config-toggle"');
    const moreConfigIncludeIndex = source.indexOf('id="more-config-include"');
    const moreConfigExcludeIndex = source.indexOf('id="more-config-exclude"');
    const convertedSubUrlIndex = source.indexOf('id="converted-sub-url"');
    const shortUrlResultIndex = source.indexOf('id="short-url-result"');

    expect(subscriptionUrlsIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(subscriptionUrlsIndex);
    expect(apiIndex).toBeGreaterThan(clientIndex);
    expect(remoteIndex).toBeGreaterThan(apiIndex);
    expect(moreConfigIndex).toBeGreaterThan(remoteIndex);
    expect(moreConfigIncludeIndex).toBeGreaterThan(moreConfigIndex);
    expect(moreConfigExcludeIndex).toBeGreaterThan(moreConfigIncludeIndex);
    expect(convertedSubUrlIndex).toBeGreaterThan(moreConfigExcludeIndex);
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

  it('keeps advanced conversion parameters collapsed initially', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/isShowMoreConfig:\s*false/);
  });
});
