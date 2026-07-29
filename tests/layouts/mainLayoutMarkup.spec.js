import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/layouts/main/MainLayout.vue', import.meta.url);

describe('MainLayout document structure', () => {
  it('keeps only the navigation and routed view in the layout shell', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const footerElement = ['<footer', 'bar />'].join('-');
    const footerComponent = ['Footer', 'Bar'].join('');

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(source).toContain('class="main-layout light-style"');
    expect(source).toContain('<nav-bar />');
    expect(source).toContain('<router-view />');
    expect(source).not.toContain(footerElement);
    expect(source).not.toContain(footerComponent);
  });

  it('uses the minimal system-styled application surface', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.main-layout\s*\{[^}]*min-height:\s*100vh\s*;/s);
    expect(source).toMatch(/\.main-layout\s*\{[^}]*background-color:\s*#f5f5f7\s*;/s);
    expect(source).toMatch(
      /\.main-layout\s*\{[^}]*font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*['"]Segoe UI['"],\s*sans-serif\s*;/s,
    );
    expect(source).toMatch(/\.main-layout\s*\{[^}]*letter-spacing:\s*0\s*;/s);
  });

  it('does not import legacy landing-page styles', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const legacyStyles = [
      ['front', 'page.css'].join('-'),
      ['front', 'page-landing.css'].join('-'),
    ];

    legacyStyles.forEach((stylesheet) => expect(source).not.toContain(stylesheet));
  });
});
