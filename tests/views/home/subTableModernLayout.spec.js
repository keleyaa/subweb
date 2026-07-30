import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentPath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));
const stylesheetPath = fileURLToPath(new URL('../../../src/views/home/subTableModern.css', import.meta.url));

describe('SubTable modern linear layout', () => {
  it('uses the shared semantic form structure for every UX mode', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain('<form class="sub-table sub-table--modern" @submit.prevent="handleSubscriptionAction">');
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
      /<fieldset class="configuration-section">[\s\S]*?<legend class="visually-hidden">订阅输入与配置<\/legend>[\s\S]*?<div class="subscription-input">[\s\S]*?<div class="base-config-grid">[\s\S]*?<\/fieldset>/
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

    expect(source).toContain('<button type="submit" class="primary-action-button">');
    expect(source).toContain("{{ hasCurrentSubscriptionResult ? '复制订阅' : '转换订阅' }}");
    expect(source).not.toMatch(/class="[^"]*\bbtn(?:-primary|-secondary)?\b[^"]*"/);
    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
  });

  it('connects the advanced disclosure and reveal transitions accessibly', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toMatch(
      /<button[\s\S]*?id="more-config-toggle"[\s\S]*?:aria-expanded="isShowMoreConfig"[\s\S]*?aria-controls="advanced-config"[\s\S]*?@click="showMoreConfig"/
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

  it('uses one stateful action for the subscription and one for the short link', () => {
    const source = readFileSync(componentPath, 'utf8');
    const resultsSection = source.slice(
      source.indexOf('<fieldset class="results-section">'),
      source.indexOf('</fieldset>', source.indexOf('<fieldset class="results-section">'))
    );

    expect(resultsSection).toMatch(
      /<div class="form-field result-field">\s*<label for="converted-sub-url">转换链接<\/label>/
    );
    expect(resultsSection).toMatch(
      /<div v-if="hasShortUrlService" class="form-field result-field">\s*<label for="short-url-result">短链<\/label>/
    );
    expect(resultsSection).not.toContain('secondary-action-button');
    expect(source).toContain('@submit.prevent="handleSubscriptionAction"');
    expect(source).toContain('@click="handleShortUrlAction"');
    expect(source).toContain("{{ isGeneratingShortUrl ? '生成中...' : hasCurrentShortUrl ? '复制短链' : '生成短链' }}");
    expect(source).toContain(':disabled="isGeneratingShortUrl"');
    expect(source).not.toContain('shareSubscription');
    expect(source).not.toContain('import { shareUrl }');
    expect(source).toContain('hasShortUrlService()');
  });

  it('guards short-link responses with the input captured when the request began', () => {
    const source = readFileSync(componentPath, 'utf8');
    const shortUrlMethod = source.slice(source.indexOf('async getShortUrl()'), source.indexOf('\n    },\n  },\n};'));

    expect(shortUrlMethod).toContain('const requestConversionKey = this.result.conversionKey;');
    expect(shortUrlMethod).toMatch(
      /if \(!matchesConversionInput\(requestConversionKey, this\.conversionInput\)\) \{\s*return;\s*\}[\s\S]*?this\.result\.shortUrl = res\.data\.ShortUrl;[\s\S]*?this\.result\.shortUrlConversionKey = requestConversionKey;/
    );
  });

  it('does not report generated links as copied before a copy operation succeeds', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain("'转换链接已生成'");
    expect(source).not.toContain('转换链接已生成并复制');
  });
});

describe('SubTable modern visual constraints', () => {
  it('defines the linear grid and one focused glass workspace with solid controls', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(source).toMatch(
      /\.sub-table--modern\s*\{[^}]*padding:\s*28px\s*;[^}]*border:\s*1px solid var\(--surface-glass-edge\)\s*;[^}]*border-radius:\s*28px\s*;[^}]*background:\s*var\(--surface-glass\)\s*;[^}]*backdrop-filter:\s*blur\(22px\) saturate\(120%\)\s*;/s,
    );
    expect(source).toMatch(/textarea,[\s\S]*?background:\s*var\(--surface-control\)/);
    expect(source).toContain('border-radius: 12px');
    expect(source).toContain('var(--accent)');
    expect(source).toContain('var(--separator)');
    expect(source).toContain('44px');
    expect(source).toContain('@media (max-width: 767.98px)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(source).toContain('@media (prefers-contrast: more)');
    expect(source).toContain('180ms ease-out');
  });

  it('uses the glass treatment only for the containing workspace, never a gradient or nested surface', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';
    const forbiddenMarkers = [['linear', 'gradient'].join('-'), ['radial', 'gradient'].join('-')];

    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
    expect(source).toContain('box-shadow: var(--shadow-glass)');
    expect(source).not.toContain('.configuration-section {\n  padding:');
    expect(source).not.toContain('.results-section {\n  padding: 24px;');
  });

  it('owns complete primary and secondary button interaction states', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/\.primary-action-button\s*\{[\s\S]*?background:\s*var\(--accent\)/);
    expect(source).toMatch(/\.primary-action-button:hover\s*\{[\s\S]*?background:\s*var\(--accent-hover\)/);
    expect(source).toMatch(/\.primary-action-button:active\s*\{[\s\S]*?background:\s*var\(--accent-active\)/);
    expect(source).toMatch(/\.primary-action-button:disabled\s*\{/);
    expect(source).toMatch(/\.secondary-action-button:hover\s*\{[\s\S]*?background:\s*var\(--surface-control-hover\)/);
    expect(source).toMatch(/\.secondary-action-button:active\s*\{[\s\S]*?background:\s*var\(--surface-control-active\)/);
    expect(source).toMatch(/\.primary-action-button:focus-visible[\s\S]*?\.secondary-action-button:focus-visible/);
    expect(source).toMatch(
      /textarea:focus-visible,[\s\S]*?select:focus-visible,[\s\S]*?input:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);/
    );
    expect(source).toMatch(
      /\.primary-action-button:focus-visible,[\s\S]*?\.secondary-action-button:focus-visible,[\s\S]*?\.advanced-disclosure:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);/
    );
    expect(source).toMatch(/transition:\s*(?:background-color|border-color|color)[^;]*1(?:6|7|8)0ms ease-out/);
    expect(source).not.toMatch(/transition:\s*all\b/);
    expect(source).toContain('scale(0.985)');
    expect(source).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.field-reveal-enter-from,[\s\S]*?\.advanced-reveal-leave-to\s*\{[^}]*transform:\s*none\s*;/,
    );
  });

  it('uses accessible contrast for successful result status text', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/\.results-status--success\s*\{[^}]*color:\s*var\(--success\);/);
  });
});
