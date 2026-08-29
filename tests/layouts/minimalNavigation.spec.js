import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

const appBrandUrl = new URL('../../src/layouts/main/navbar/AppBrand.vue', import.meta.url);
const navBarUrl = new URL('../../src/layouts/main/navbar/NavBar.vue', import.meta.url);
const removedNavMenuUrl = new URL('../../src/layouts/main/navbar/NavMenu.vue', import.meta.url);
const removedNavigationUrl = new URL('../../src/layouts/main/navbar/navigation.js', import.meta.url);

const forbidden = (...parts) => parts.join('');

describe('command navigation', () => {
  it('renders the fixed Subconverter Web command brand without runtime configuration', async () => {
    const source = await readFile(appBrandUrl, 'utf8');

    expect(source).toContain('<a href="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">');
    expect(source).toContain('Subconverter Web<span aria-hidden="true">.</span>');
    expect(source).not.toContain('siteName');
    expect(source).not.toContain('window.config');
    expect(source).toMatch(/\.app-brand-link\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*720;/s);
    expect(source).toMatch(
      /\.app-brand-link:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);[^}]*outline-offset:\s*4px;/s,
    );
  });

  it('keeps the header to the command brand on a fixed black command surface', async () => {
    const source = await readFile(navBarUrl, 'utf8');

    expect(source).toContain('<header class="site-header">');
    expect(source).toContain('<nav class="site-header__inner" aria-label="主导航">');
    expect(source).toContain('<AppBrand />');
    expect(source).not.toContain('ThemeToggle');
    expect(source).not.toContain('NavMenu');
    expect(source).not.toContain('github');
    expect(source).not.toContain('href="#converter"');
    expect(source).toMatch(/\.site-header__inner\s*\{[^}]*max-width:\s*860px;[^}]*justify-content:\s*flex-start;/s);
    expect(source).not.toMatch(/position:\s*sticky|backdrop-filter|box-shadow|border-radius:\s*20px/);
  });

  it('removes the superseded top-menu component and navigation helper', async () => {
    await expect(stat(removedNavMenuUrl)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(removedNavigationUrl)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not restore legacy navigation controls', async () => {
    const source = await readFile(navBarUrl, 'utf8');

    for (const token of [
      forbidden('mobile-menu-', 'toggle'),
      forbidden('landing-nav-', 'menu'),
      forbidden('landing-menu-', 'overlay'),
      forbidden('navbar-', 'toggler'),
      ':' + forbidden('in', 'ert'),
      forbidden('aria-', 'expanded'),
      '@keydown.' + 'esc',
      forbidden('@element-plus/', 'icons-vue'),
      forbidden('style', 'Facade'),
    ]) {
      expect(source).not.toContain(token);
    }
  });
});
