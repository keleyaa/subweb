import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../../src/views/home/HomeView.vue', import.meta.url);
const baseCssUrl = new URL('../../../src/styles/base.css', import.meta.url);

const forbiddenTokens = [
  ['landing-hero', '-blank'],
  ['hero-', 'animation', '-img'],
  ['landing', 'Hero'],
  ['linear-', 'gradient'],
  ['radial-', 'gradient'],
].map((parts) => parts.join(''));

describe('home command surface', () => {
  it('renders one centered command card with a visible conversion heading', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('<main id="converter" class="command-surface" aria-labelledby="conversion-title">');
    expect(source).toContain('class="command-surface__center"');
    expect(source).toContain('class="command-card"');
    expect(source).toContain('class="command-card__header"');
    expect(source).toContain('<p>Online subscription conversion</p>');
    expect(source).toContain('<h1 id="conversion-title">在线订阅转换</h1>');
    expect(source).toContain('class="command-card__shortcut" aria-hidden="true">⌘ Enter</span>');
    expect(source).toContain('<SubTable />');
    expect(source.match(/<SubTable/g)).toHaveLength(1);
  });

  it('removes landing and gradient presentation patterns', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    forbiddenTokens.forEach((token) => {
      expect(source).not.toContain(token);
    });
  });

  it('uses the original bounded 860px command surface', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.command-surface\s*\{[^}]*display:\s*flex\s*;/);
    expect(source).toMatch(
      /\.command-surface__center\s*\{[^}]*max-width:\s*860px\s*;[^}]*margin:\s*auto\s*;[^}]*align-items:\s*center\s*;/,
    );
    expect(source).toMatch(/\.command-card\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*12px\s*;/s);
    expect(source).toContain('box-shadow: 0 30px 80px rgb(0 0 0 / 32%)');
  });

  it('removes the card shortcut on narrow viewports without viewport-scaled type', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.command-card__shortcut\s*\{[^}]*display:\s*none\s*;/);
    expect(source).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.command-card__header\s*\{[^}]*padding:\s*22px 20px 18px\s*;/);
    expect(source).not.toMatch(/font-size:\s*clamp\(/);
  });

  it('keeps one fixed presentation without a retired runtime UX layer', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toContain('presentation');
    expect(source).not.toContain('uxMode');
    expect(source).not.toContain('data-ux-mode');
  });

  it('defines dark command palettes without gradient surfaces', async () => {
    const source = await readFile(baseCssUrl, 'utf8');

    expect(source).toContain("html[data-theme='light']");
    expect(source).toContain("html[data-theme='dark']");
    expect(source).toContain('--canvas');
    expect(source).toContain('--surface-control');
    expect(source).toContain('--focus-ring');
    expect(source).not.toContain('--el-bg-color');
    expect(source).not.toContain('linear-gradient');
    expect(source).not.toContain('radial-gradient');
  });
});
