import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

const appBrandUrl = new URL('../../src/layouts/main/navbar/AppBrand.vue', import.meta.url);
const navBarUrl = new URL('../../src/layouts/main/navbar/NavBar.vue', import.meta.url);
const removedNavMenuUrl = new URL('../../src/layouts/main/navbar/NavMenu.vue', import.meta.url);
const removedNavigationUrl = new URL('../../src/layouts/main/navbar/navigation.js', import.meta.url);

const forbidden = (...parts) => parts.join('');

describe('focused navigation', () => {
  it('renders the fixed Subconverter Web brand without reading the runtime site name', async () => {
    const source = await readFile(appBrandUrl, 'utf8');

    expect(source).toContain('<router-link to="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">');
    expect(source).toContain('<img class="app-brand-mark" src="/favicon.svg" width="28" height="28" alt="" />');
    expect(source).toContain('<span class="app-brand-text">Subconverter Web</span>');
    expect(source).not.toContain('siteName');
    expect(source).not.toContain('window.config');
    expect(source).toMatch(/\.app-brand-link\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*10px;/s);
    expect(source).toMatch(
      /\.app-brand-link:focus-visible\s*\{[^}]*outline:\s*3px solid #0066cc;[^}]*outline-offset:\s*2px;[^}]*border-radius:\s*4px;/s,
    );
  });

  it('contains only the brand and theme toggle in the top navigation', async () => {
    const source = await readFile(navBarUrl, 'utf8');

    expect(source).toContain('<nav class="minimal-navbar">');
    expect(source).toContain('<div class="minimal-navbar__inner">');
    expect(source).toContain('<AppBrand />');
    expect(source).toContain('<ThemeToggle />');
    expect(source).toContain("import ThemeToggle from './ThemeToggle.vue';");
    expect(source).not.toContain('NavMenu');
    expect(source).not.toContain('github');
    expect(source).not.toContain('<a');
    expect(source).toMatch(/\.minimal-navbar__inner\s*\{[^}]*max-width:\s*860px;[^}]*min-height:\s*56px;[^}]*margin:\s*0 auto;[^}]*padding:\s*0 20px;/s);
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
