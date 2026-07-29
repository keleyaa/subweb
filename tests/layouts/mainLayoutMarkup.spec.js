import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

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
    const footerComponent = ['Footer', 'Bar'].join('');
    const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/);

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(templateMatch).not.toBeNull();
    expect(templateMatch[1].replace(/\s+/g, ' ').trim()).toBe(
      '<div class="main-layout" dir="ltr"> <nav-bar /> <router-view /> </div>',
    );
    expect(source).not.toContain(footerComponent);
    expect(source).not.toContain(['light', 'style'].join('-'));
  });

  it('does not retain legacy document metadata or scroll synchronization', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const legacyTokens = [
      ['data', 'theme'].join('-'),
      ['data', 'assets', 'path'].join('-'),
      ['data', 'template'].join('-'),
      ['@', 'wheel'].join(''),
      ['style', 'Facade'].join(''),
      ['set', 'Nav', 'Active'].join(''),
    ];
    const listenerMethods = [
      ['add', 'Event', 'Listener'].join(''),
      ['remove', 'Event', 'Listener'].join(''),
    ];
    const scrollEvent = ['scr', 'oll'].join('');

    legacyTokens.forEach((token) => expect(source).not.toContain(token));
    listenerMethods.forEach((method) =>
      expect(source).not.toMatch(new RegExp(`${method}\\s*\\(\\s*['"]${scrollEvent}['"]`)),
    );
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

  it('removes the footer component and obsolete landing-page styles together', async () => {
    await expect(stat(removedFooterUrl)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(legacyStyleUrls[0])).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(legacyStyleUrls[1])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
