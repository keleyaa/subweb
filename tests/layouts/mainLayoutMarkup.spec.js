import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/layouts/main/MainLayout.vue', import.meta.url);

describe('MainLayout document structure', () => {
  it('provides a full-height shell with navigation, growable routed content, and footer', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/);

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(templateMatch).not.toBeNull();
    expect(templateMatch[1].replace(/\s+/g, ' ').trim()).toBe(
      '<div class="main-layout" dir="ltr"> <NavBar /> <div class="main-layout__content"><router-view /></div> <FooterBar /> </div>',
    );
    expect(source).toContain("import FooterBar from './footer/FooterBar.vue';");
    expect(source).toMatch(/components:\s*\{\s*FooterBar,\s*NavBar\s*\}/);
  });

  it('uses flex layout so short routed content keeps the footer at the viewport bottom', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.main-layout\s*\{[^}]*display:\s*flex\s*;[^}]*flex-direction:\s*column\s*;[^}]*min-height:\s*100vh\s*;/s);
    expect(source).toMatch(/\.main-layout__content\s*\{[^}]*flex:\s*1\s*;/s);
    expect(source).not.toMatch(/<main\s+class="main-layout__content"/);
    expect(source).not.toContain(':deep');
    expect(source).toContain('dir="ltr"');
  });

  it('does not retain legacy document metadata or scroll synchronization', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const legacyTokens = [
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
});
