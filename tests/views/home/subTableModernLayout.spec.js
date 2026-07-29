import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentPath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));
const stylesheetPath = fileURLToPath(new URL('../../../src/views/home/subTableModern.css', import.meta.url));

describe('SubTable modern linear layout', () => {
  it('uses the shared semantic form structure for every UX mode', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain(
      '<form class="sub-table sub-table--modern" :data-ux-mode="mode" @submit.prevent="getSubUrl">',
    );
    expect(source).toContain('class="subscription-input"');
    expect(source).toContain('class="base-config-grid"');
    expect(source).toMatch(/class="[^"]*\badvanced-disclosure\b[^"]*"/);
    expect(source).toContain('class="primary-action-row"');
    expect(source).toContain('class="results-section"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('转换订阅');
  });

  it('groups subscription input and base configuration in one fieldset', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toMatch(
      /<fieldset class="configuration-section">[\s\S]*?<legend class="visually-hidden">订阅输入与配置<\/legend>[\s\S]*?<div class="subscription-input">[\s\S]*?<div class="base-config-grid">[\s\S]*?<\/fieldset>/,
    );
    expect(source).not.toContain('<fieldset class="subscription-input">');
  });

  it('uses isolated component button classes and removes the old framed layout', () => {
    const source = readFileSync(componentPath, 'utf8');
    const forbiddenMarkers = [
      ['class="', 'card'].join(''),
      ['divider', 'dashed'].join('-'),
      ['row g', '-'].join(''),
      ['template', 'controls'].join('-'),
    ];

    expect(source.match(/\bprimary-action-button\b/g) ?? []).toHaveLength(1);
    expect(source).toContain('<button type="submit" class="primary-action-button">转换订阅</button>');
    expect(source).not.toMatch(/class="[^"]*\bbtn(?:-primary|-secondary)?\b[^"]*"/);
    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
  });

  it('connects the advanced disclosure and reveal transitions accessibly', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toMatch(
      /<button[\s\S]*?id="more-config-toggle"[\s\S]*?:aria-expanded="isShowMoreConfig"[\s\S]*?aria-controls="advanced-config"[\s\S]*?@click="showMoreConfig"/,
    );
    expect(source).toContain('<Transition name="field-reveal">');
    expect(source).toContain('<Transition name="advanced-reveal">');
    expect(source).toContain('id="advanced-config"');
  });

  it('preserves every field label and identifier contract', () => {
    const source = readFileSync(componentPath, 'utf8');
    const ids = [
      'subscription-urls',
      'client',
      'api',
      'remote',
      'manual-api-url',
      'manual-remote-config',
      'more-config-include',
      'more-config-exclude',
      'emoji',
      'udp',
      'sort',
      'scv',
      'nodelist',
      'converted-sub-url',
      'short-url-result',
    ];
    const wrappedCheckboxIds = new Set(['emoji', 'udp', 'sort', 'scv', 'nodelist']);

    for (const id of ids) {
      expect(source).toContain(`id="${id}"`);
      if (!wrappedCheckboxIds.has(id)) {
        expect(source).toContain(`for="${id}"`);
      }
    }
  });

  it('uses each checkbox label as the complete touch target', () => {
    const source = readFileSync(componentPath, 'utf8');
    const stylesheet = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';
    const checkboxFields = source.match(/<label class="checkbox-field">[\s\S]*?<\/label>/g) ?? [];
    const expectedCheckboxes = [
      ['emoji', 'Emoji'],
      ['udp', '开启 UDP'],
      ['sort', '排序节点'],
      ['scv', '关闭证书检查'],
      ['nodelist', 'Node List'],
    ];

    expect(checkboxFields).toHaveLength(expectedCheckboxes.length);
    for (const [id, text] of expectedCheckboxes) {
      const field = checkboxFields.find((candidate) => candidate.includes(`id="${id}"`));
      expect(field).toContain(`<span>${text}</span>`);
      expect(field).toContain('type="checkbox"');
    }
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?min-height:\s*40px/);
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?padding:\s*0\s+4px/);
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?cursor:\s*pointer/);
  });

  it('provides explicit copy, share, and short-link actions', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain(`@click="toCopy(result.subUrl, '订阅链接')"`);
    expect(source).toContain(`@click="toCopy(result.shortUrl, '短链')"`);
    expect(source).toMatch(/<button[^>]*v-if="result\.subUrl"[^>]*@click="shareSubscription"/);
    expect(source).toContain('@click="getShortUrl"');
    expect(source).toContain(':disabled="!result.subUrl"');
    expect(source).toContain(':disabled="!result.shortUrl"');
  });
});

describe('SubTable modern visual constraints', () => {
  it('defines the linear grid, controls, separators, and responsive motion', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(source).toMatch(/\.advanced-disclosure[\s\S]*?border-top:\s*1px solid #d2d2d7/);
    expect(source).toMatch(/\.advanced-disclosure[\s\S]*?border-bottom:\s*1px solid #d2d2d7/);
    expect(source).toMatch(/\.results-section[\s\S]*?border-top:\s*1px solid #d2d2d7/);
    expect(source).toContain('border-radius: 8px');
    expect(source).toContain('#0071e3');
    expect(source).toContain('44px');
    expect(source).toContain('@media (max-width: 767.98px)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('180ms ease-out');
  });

  it('does not use glass, gradients, or effective shadows', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';
    const forbiddenMarkers = [
      ['linear', 'gradient'].join('-'),
      ['backdrop', 'filter'].join('-'),
    ];
    const shadowDeclarations = source.match(/box-shadow\s*:\s*[^;]+/g) ?? [];

    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
    for (const declaration of shadowDeclarations) {
      expect(declaration).toMatch(/box-shadow\s*:\s*none$/);
    }
  });

  it('owns complete primary and secondary button interaction states', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/\.primary-action-button\s*\{[\s\S]*?background:\s*#0071e3/);
    expect(source).toMatch(/\.primary-action-button:hover\s*\{[\s\S]*?background:\s*#0077ed/);
    expect(source).toMatch(/\.primary-action-button:active\s*\{[\s\S]*?background:\s*#006edb/);
    expect(source).toMatch(/\.primary-action-button:disabled\s*\{/);
    expect(source).toMatch(/\.secondary-action-button:hover\s*\{[\s\S]*?background:\s*#f5f5f7/);
    expect(source).toMatch(/\.secondary-action-button:active\s*\{[\s\S]*?background:\s*#e8e8ed/);
    expect(source).toMatch(/\.secondary-action-button:disabled\s*\{/);
    expect(source).toMatch(/\.primary-action-button:focus-visible[\s\S]*?\.secondary-action-button:focus-visible/);
    expect(source).toMatch(/transition:\s*(?:background-color|border-color|color)[^;]*1(?:6|7|8)0ms ease-out/);
    expect(source).not.toMatch(/transition:\s*all\b/);
  });
});
