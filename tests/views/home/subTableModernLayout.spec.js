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
    expect(source).toMatch(/class="[^"]*\bsettings-status-row\b[^"]*"/);
    expect(source).toContain('class="primary-action-row"');
    expect(source).toContain('class="results-section"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('subscriptionActionLabel');
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

    expect(source).toContain('type="submit" class="primary-action-button"');
    expect(source).toContain('{{ subscriptionActionLabel }}');
    expect(source).not.toMatch(/class="[^"]*\bbtn(?:-primary|-secondary)?\b[^"]*"/);
    for (const marker of forbiddenMarkers) {
      expect(source).not.toContain(marker);
    }
  });

  it('connects mutually exclusive status rows and reveal transitions accessibly', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain('id="more-config-toggle"');
    expect(source).toContain(':aria-expanded="isShowMoreConfig"');
    expect(source).toContain('id="subscription-backend-toggle"');
    expect(source).toContain(':aria-expanded="isShowServiceSettings"');
    expect(source).toContain('aria-controls="subscription-backend-panel"');
    expect(source).toContain('aria-controls="advanced-config-panel"');
    expect(source).toContain('<Transition name="field-reveal">');
    expect(source).toContain('<Transition name="advanced-reveal" @after-leave="openPendingSettingsPanel">');
    expect(source).toContain('id="subscription-backend-panel"');
    expect(source).toContain('id="advanced-config-panel"');
    expect(source).toContain('pendingSettingsPanel');
    expect(source).toContain('toggleSettingsPanel(panel)');
    expect(source).toContain('settings-status-row');
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
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?min-height:\s*44px/);
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?padding:\s*0 8px/);
    expect(stylesheet).toMatch(/\.checkbox-field\s*\{[\s\S]*?cursor:\s*pointer/);
  });

  it('uses one stateful action for the subscription and one for the short link', () => {
    const source = readFileSync(componentPath, 'utf8');
    const resultsSection = source.slice(
      source.indexOf('<fieldset v-if="hasCurrentSubscriptionResult" class="results-section">'),
      source.indexOf('</fieldset>', source.indexOf('<fieldset v-if="hasCurrentSubscriptionResult" class="results-section">'))
    );

    expect(resultsSection).toMatch(
      /<div class="form-field result-field">\s*<label for="converted-sub-url">转换链接<\/label>/
    );
    expect(resultsSection).toMatch(
      /<div v-if="hasCurrentShortUrl" class="form-field result-field">\s*<label for="short-url-result">短链<\/label>/
    );
    expect(resultsSection).toContain('secondary-action-button');
    expect(source).toContain('@submit.prevent="handleSubscriptionAction"');
    expect(source).toContain('@click="handleShortUrlAction"');
    expect(source).toContain('{{ shortActionLabel }}');
    expect(source).toContain(':disabled="isGeneratingShortUrl || isShortCopying || shortRateLimitSeconds > 0"');
    expect(source).toContain('请等待 ${this.shortRateLimitSeconds} 秒');
    expect(source).toContain('clearShortRateLimit()');
    expect(source).not.toContain('shareSubscription');
    expect(source).not.toContain('import { shareUrl }');
    expect(source).toContain('createShortLinkWorkflow({');
    expect(source).toContain('<TurnstileChallenge');
  });

  it('guards short-link responses with the input captured when the request began', () => {
    const source = readFileSync(componentPath, 'utf8');
    const shortUrlMethod = source.slice(source.indexOf('async getShortUrl(challengeToken)'), source.indexOf('retryShortLink(token)'));

    expect(shortUrlMethod).toContain('const requestConversionKey = this.result.conversionKey;');
    expect(shortUrlMethod).toContain('isCurrent: (conversionKey) => matchesConversionInput');
    expect(shortUrlMethod).toContain("if (outcome.kind === 'stale') return;");
    expect(shortUrlMethod).toContain('this.result.shortUrl = outcome.result.shortUrl;');
    expect(shortUrlMethod).toContain('this.result.shortUrlConversionKey = requestConversionKey;');
  });

  it('does not report generated links as copied before a copy operation succeeds', () => {
    const source = readFileSync(componentPath, 'utf8');

    expect(source).toContain("'转换链接已生成'");
    expect(source).not.toContain('转换链接已生成并复制');
  });
});

describe('SubTable command surface constraints', () => {
  it('uses the original command-panel structure without nested cards or gradients', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(source).toMatch(/\.sub-table--modern\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    expect(source).toContain("content: '›'");
    expect(source).toMatch(/\.subscription-input\s*\{[^}]*padding:\s*24px 28px 20px;/s);
    expect(source).toContain('var(--accent)');
    expect(source).toContain('var(--line)');
    expect(source).toContain('@media (max-width: 640px)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('@media (prefers-contrast: more)');
    expect(source).not.toContain('linear-gradient');
    expect(source).not.toContain('radial-gradient');
    expect(source).not.toContain('backdrop-filter');
  });

  it('gives command controls complete interaction states without all-transition', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/\.primary-action-button\s*\{[\s\S]*?width:\s*min\(100%,\s*280px\)[\s\S]*?min-height:\s*48px[\s\S]*?justify-content:\s*center[\s\S]*?background:\s*var\(--accent\)/);
    expect(source).toMatch(/\.primary-action-button:hover\s*\{[\s\S]*?background:\s*var\(--accent-hover\)/);
    expect(source).toMatch(/\.primary-action-button:active\s*\{[\s\S]*?transform:\s*translateY\(1px\)/);
    expect(source).toMatch(/\.primary-action-button:disabled\s*\{/);
    expect(source).toMatch(/\.secondary-action-button:hover\s*\{[\s\S]*?color:\s*var\(--accent\)/);
    expect(source).toMatch(/textarea:focus-visible,[\s\S]*?select:focus-visible,[\s\S]*?input:focus-visible\s*\{[^}]*outline:\s*3px solid color-mix/);
    expect(source).toContain('.primary-action-button:focus-visible');
    expect(source).toContain('.secondary-action-button:focus-visible');
    expect(source).toContain('.settings-status-row:focus-visible');
    expect(source).toContain('outline: 3px solid var(--focus-ring);');
    expect(source).not.toMatch(/transition:\s*all\b/);
    expect(source).toContain('translateY(-1px)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('transition-duration: 0.01ms !important;');
    expect(source).toContain('transform: none;');
  });

  it('keeps checkbox labels as complete tactile targets and result states readable', () => {
    const source = existsSync(stylesheetPath) ? readFileSync(stylesheetPath, 'utf8') : '';

    expect(source).toMatch(/\.checkbox-field\s*\{[\s\S]*?min-height:\s*44px/);
    expect(source).toMatch(/\.checkbox-field\s*\{[\s\S]*?padding:\s*0 8px/);
    expect(source).toMatch(/\.checkbox-field\s*\{[\s\S]*?cursor:\s*pointer/);
    expect(source).toMatch(/\.results-status--success\s*\{[^}]*color:\s*var\(--success\);/);
  });
});
