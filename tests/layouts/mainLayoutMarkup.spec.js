import { describe, expect, it } from 'vitest';
import { access, readFile, stat } from 'node:fs/promises';

const sourceUrl = new URL('../../src/layouts/main/MainLayout.vue', import.meta.url);
const removedFooterUrl = new URL(`../../src/layouts/main/footer/${['Footer', 'Bar.vue'].join('')}`, import.meta.url);
const legacyStyleNames = [
  ['front', 'page.css'].join('-'),
  ['front', 'page-landing.css'].join('-'),
];
const legacyStyleUrls = legacyStyleNames.map(
  (stylesheet) => new URL(`../../src/assets/vendor/css/pages/${stylesheet}`, import.meta.url),
);

describe('MainLayout document structure', () => {
  it('keeps only the navigation and routed view in the layout shell', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const footerElement = ['<footer', 'bar />'].join('-');
    const footerComponent = ['Footer', 'Bar'].join('');

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(source).toContain('class="main-layout light-style"');
    expect(source).toContain('dir="ltr"');
    expect(source).toContain('<nav-bar />');
    expect(source).toContain('<router-view />');
    expect(source).not.toContain(footerElement);
    expect(source).not.toContain(footerComponent);
  });

  it('does not retain legacy document metadata or scroll synchronization', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    ['data-theme', 'data-assets-path', 'data-template', '@wheel', 'styleFacade', 'setNavActive'].forEach((token) =>
      expect(source).not.toContain(token),
    );
    expect(source).not.toMatch(/addEventListener\s*\(\s*['"]scroll['"]/);
    expect(source).not.toMatch(/removeEventListener\s*\(\s*['"]scroll['"]/);
  });

  it('uses the minimal system-styled application surface', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.main-layout\s*\{[^}]*min-height:\s*100vh\s*;/s);
    expect(source).toMatch(/\.main-layout\s*\{[^}]*background-color:\s*#f5f5f7\s*;/s);
    expect(source).toMatch(/\.main-layout\s*\{[^}]*color:\s*#1d1d1f\s*;/s);
    expect(source).toMatch(
      /\.main-layout\s*\{[^}]*font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*['"]Segoe UI['"],\s*sans-serif\s*;/s,
    );
    expect(source).toMatch(/\.main-layout\s*\{[^}]*letter-spacing:\s*0\s*;/s);
    expect(source).not.toContain(['dark', 'style'].join('-'));
  });

  it('does not import legacy landing-page styles', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    legacyStyleNames.forEach((stylesheet) => expect(source).not.toContain(stylesheet));
  });

  it('removes the footer component without deleting shared vendor styles', async () => {
    await expect(stat(removedFooterUrl)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(Promise.all(legacyStyleUrls.map((stylesheetUrl) => access(stylesheetUrl)))).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });
});
