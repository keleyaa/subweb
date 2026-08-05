import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../../src/views/home/HomeView.vue', import.meta.url);
const baseCssUrl = new URL('../../../src/styles/base.css', import.meta.url);

const forbiddenTokens = [
  ['landing-hero', '-blank'],
  ['hero-', 'animation', '-img'],
  ['landing', 'Hero'],
  ['hero-', 'animation'],
  ['linear-', 'gradient'],
  ['display', '-6'],
  ['section', '-py'],
].map((parts) => parts.join(''));

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('home workspace layout', () => {
  it('renders one conversion table in the single-column workspace', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('class="home-workspace"');
    expect(source).toContain('class="home-workspace__inner"');
    expect(source).toContain('aria-labelledby="conversion-title"');
    expect(source).toContain('<h1 id="conversion-title" class="visually-hidden">订阅转换</h1>');
    expect(source).toContain('<SubTable />');
    expect(source.match(/<SubTable/g)).toHaveLength(1);
  });

  it('removes the former landing presentation', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    forbiddenTokens.forEach((token) => {
      expect(source).not.toContain(token);
    });
  });

  it('uses the focused single-workspace layout and token-based typography', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.home-workspace\s*\{[^}]*display:\s*flex\s*;/);
    expect(source).not.toContain('min-height: calc(100vh - 57px)');
    expect(source).toMatch(
      /\.home-workspace__inner\s*\{[^}]*max-width:\s*52rem\s*;[^}]*margin:\s*0 auto\s*;[^}]*padding:\s*20px 20px 48px\s*;/
    );
    expect(source).not.toContain('home-workspace__heading');
  });

  it('tightens workspace spacing and heading size on mobile', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(
      /@media \(max-width: 575\.98px\)\s*\{[\s\S]*?\.home-workspace__inner\s*\{[^}]*padding:\s*16px 16px 32px\s*;/
    );
  });

  it('uses one fixed presentation without a retired runtime-UX compatibility layer', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('<main class="home-workspace" aria-labelledby="conversion-title">');
    expect(source).toContain('<h1 id="conversion-title" class="visually-hidden">订阅转换</h1>');
    expect(source).not.toContain('presentation');
    expect(source).not.toContain('uxMode');
    expect(source).not.toContain('data-ux-mode');
  });

  it('draws both explicit theme palettes with static ambient light only on the page background', async () => {
    const source = await readFile(baseCssUrl, 'utf8');

    expect(source).toContain("html[data-theme='light']");
    expect(source).toContain("html[data-theme='dark']");
    expect(source).toContain('--surface-glass');
    expect(source).toContain('--surface-control');
    expect(source).toContain('--focus-ring');
    expect(source).toContain('--el-bg-color');
    expect(source).not.toContain('radial-gradient');
    expect(source).toMatch(/body::before\s*\{[\s\S]*?linear-gradient/);
    expect((source.match(/linear-gradient/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(
      /@media \(prefers-contrast: more\)[\s\S]*?html\[data-theme='light'\]\s*\{[^}]*--surface-glass-edge:\s*[^;]+;[\s\S]*?html\[data-theme='dark'\]\s*\{[^}]*--surface-glass-edge:\s*[^;]+;/,
    );
  });

  it('keeps light-theme secondary status text readable against a solid control surface', async () => {
    const source = await readFile(baseCssUrl, 'utf8');
    const lightPalette = source.match(/:root,\s*html\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mutedText = lightPalette.match(/--text-muted:\s*(#[0-9a-f]{6})\s*;/i)?.[1];
    const controlSurface = lightPalette.match(/--surface-control:\s*(#[0-9a-f]{6})\s*;/i)?.[1];

    expect(mutedText).toBeDefined();
    expect(controlSurface).toBeDefined();
    expect(contrastRatio(mutedText, controlSurface)).toBeGreaterThanOrEqual(4.5);
  });
});
