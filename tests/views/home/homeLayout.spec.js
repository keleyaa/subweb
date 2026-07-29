import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../../src/views/home/HomeView.vue', import.meta.url);

const forbiddenTokens = [
  ['landing-hero', '-blank'],
  ['hero-', 'animation', '-img'],
  ['landing', 'Hero'],
  ['hero-', 'animation'],
  ['linear-', 'gradient'],
  ['display', '-6'],
  ['section', '-py'],
].map((parts) => parts.join(''));

describe('home workspace layout', () => {
  it('renders one conversion table in the single-column workspace', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('class="home-workspace"');
    expect(source).toContain('class="home-workspace__inner"');
    expect(source).toContain('class="home-workspace__heading"');
    expect(source).toContain('<SubTable />');
    expect(source.match(/<SubTable/g)).toHaveLength(1);
  });

  it('removes the former landing presentation', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    forbiddenTokens.forEach((token) => {
      expect(source).not.toContain(token);
    });
  });

  it('uses the compact desktop workspace dimensions and typography', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.home-workspace\s*\{[^}]*min-height:\s*calc\(100vh - 57px\)\s*;/);
    expect(source).toMatch(
      /\.home-workspace__inner\s*\{[^}]*max-width:\s*860px\s*;[^}]*margin:\s*0 auto\s*;[^}]*padding:\s*48px 20px 64px\s*;/
    );
    expect(source).toMatch(/\.home-workspace__heading\s*\{[^}]*margin-bottom:\s*28px\s*;/);
    expect(source).toMatch(
      /\.home-workspace__heading h1\s*\{[^}]*margin:\s*0 0 8px\s*;[^}]*color:\s*#1d1d1f\s*;[^}]*font-size:\s*32px\s*;[^}]*font-weight:\s*600\s*;[^}]*letter-spacing:\s*0\s*;[^}]*line-height:\s*1\.2\s*;/
    );
    expect(source).toMatch(
      /\.home-workspace__heading p\s*\{[^}]*margin:\s*0\s*;[^}]*color:\s*#6e6e73\s*;[^}]*font-size:\s*15px\s*;[^}]*line-height:\s*1\.5\s*;/
    );
  });

  it('tightens workspace spacing and heading size on mobile', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(
      /@media \(max-width: 575\.98px\)\s*\{[\s\S]*?\.home-workspace__inner\s*\{[^}]*padding:\s*28px 16px 40px\s*;[^}]*\}[\s\S]*?\.home-workspace__heading\s*\{[^}]*margin-bottom:\s*20px\s*;[^}]*\}[\s\S]*?\.home-workspace__heading h1\s*\{[^}]*font-size:\s*27px\s*;/
    );
  });

  it('uses one fixed presentation without a retired runtime-UX compatibility layer', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toContain('<main class="home-workspace">');
    expect(source).toContain('<h1>订阅转换</h1>');
    expect(source).toContain('<p>将订阅链接和节点转换为目标客户端配置。</p>');
    expect(source).not.toContain('presentation');
    expect(source).not.toContain('uxMode');
    expect(source).not.toContain('data-ux-mode');
  });
});
