import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const appBrandUrl = new URL('../../src/layouts/main/navbar/AppBrand.vue', import.meta.url);
const navMenuUrl = new URL('../../src/layouts/main/navbar/NavMenu.vue', import.meta.url);
const navBarUrl = new URL('../../src/layouts/main/navbar/NavBar.vue', import.meta.url);

const forbidden = (...parts) => parts.join('');

describe('minimal borderless navigation', () => {
  it('renders the compact ML1 mark and runtime brand name without legacy menu controls', async () => {
    const source = await readFile(appBrandUrl, 'utf8');
    const legacyFocusColor = ['rgba(0, 102, 204, ', '0.24)'].join('');

    expect(source).toContain('<router-link to="/" class="app-brand-link" :aria-label="`${siteName}，返回首页`">');
    expect(source).toContain('<img class="app-brand-mark" src="/favicon.svg" width="28" height="28" alt="" />');
    expect(source).toContain('{{ siteName }}');
    expect(source).toContain('siteName: window.config.siteName');
    expect(source).toMatch(/\.app-brand-link\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*10px;/s);
    expect(source).toMatch(
      /\.app-brand-link:focus-visible\s*\{[^}]*outline:\s*3px solid #0066cc;[^}]*outline-offset:\s*2px;[^}]*border-radius:\s*4px;/s,
    );
    expect(source).toMatch(/\.app-brand-mark\s*\{[^}]*display:\s*block;[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*flex:\s*0 0 28px;/s);
    expect(source).not.toContain('>S<');
    expect(source).not.toContain(legacyFocusColor);

    for (const token of [
      '<' + 'svg',
      forbidden('mobile-menu-', 'toggle'),
      forbidden('@element-plus/', 'icons-vue'),
      forbidden('#7367', 'F0'),
      forbidden('style', 'Facade'),
    ]) {
      expect(source).not.toContain(token);
    }
  });

  it('shows only the configured GitHub link with accessible interaction styles', async () => {
    const source = await readFile(navMenuUrl, 'utf8');
    const legacyFocusColor = ['rgba(0, 102, 204, ', '0.24)'].join('');

    expect(source).toContain('<a');
    expect(source).toContain('v-if="githubItem"');
    expect(source).toContain(':href="githubItem.link"');
    expect(source).toContain(':target="githubItem.target"');
    expect(source).toContain(':title="githubItem.title"');
    expect(source).toContain('class="minimal-nav-link"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('{{ githubItem.title }}');
    expect(source).toContain("import { getGithubMenuItem } from './navigation';");
    expect(source).toContain(
      'navBarItem: Array.isArray(window.config?.menuItem) ? window.config.menuItem : []'
    );
    expect(source).toMatch(/githubItem\(\)\s*\{\s*return getGithubMenuItem\(this\.navBarItem\);\s*\}/);
    expect(source).toMatch(/\.minimal-nav-link\s*\{[^}]*min-height:\s*44px;/s);
    expect(source).toMatch(/\.minimal-nav-link:hover,\s*\.minimal-nav-link:focus-visible\s*\{[^}]*color:\s*#06c;/s);
    expect(source).toMatch(/\.minimal-nav-link:focus-visible\s*\{[^}]*outline:\s*3px solid #0066cc;[^}]*outline-offset:\s*2px;/s);
    expect(source).not.toContain(legacyFocusColor);

    for (const token of [
      forbidden('landing-nav-', 'menu'),
      forbidden('landing-menu-', 'overlay'),
      forbidden('navbar-', 'toggler'),
      ':' + forbidden('in', 'ert'),
      forbidden('aria-', 'expanded'),
      '@keydown.' + 'esc',
      forbidden('@element-plus/', 'icons-vue'),
      forbidden('style', 'Facade'),
      'v-' + 'for',
    ]) {
      expect(source).not.toContain(token);
    }
  });

  it('uses a single sticky, translucent, bounded navigation bar', async () => {
    const source = await readFile(navBarUrl, 'utf8');

    expect(source).toContain('<nav class="minimal-navbar">');
    expect(source).toContain('<div class="minimal-navbar__inner">');
    expect(source).toContain('<AppBrand />');
    expect(source).toContain('<NavMenu />');
    expect(source).toMatch(/\.minimal-navbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*100;[^}]*border-bottom:\s*1px solid #d2d2d7;[^}]*background:\s*rgba\(245,\s*245,\s*247,\s*0\.96\);/s);
    expect(source).toMatch(/\.minimal-navbar__inner\s*\{[^}]*max-width:\s*860px;[^}]*min-height:\s*56px;[^}]*margin:\s*0 auto;[^}]*padding:\s*0 20px;/s);
    expect(source).toMatch(/@media \(prefers-reduced-transparency:\s*reduce\)\s*\{\s*\.minimal-navbar\s*\{[^}]*background:\s*#f5f5f7;/s);

    for (const token of [
      forbidden('ref="app', 'Brand"'),
      '@' + 'close',
      forbidden('focusMenu', 'Toggle'),
      forbidden('style', 'Facade'),
      'class="' + 'container"',
      forbidden('navbar-', 'expand'),
      forbidden('landing-', 'navbar'),
      forbidden('layout-', 'navbar'),
    ]) {
      expect(source).not.toContain(token);
    }
  });
});
