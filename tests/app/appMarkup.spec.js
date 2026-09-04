import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

const indexUrl = new URL('../../index.html', import.meta.url);
const appUrl = new URL('../../src/App.vue', import.meta.url);
const faviconUrl = new URL('../../public/favicon.svg', import.meta.url);
const legacyFaviconUrl = new URL('../../public/favicon.ico', import.meta.url);

describe('application mount markup', () => {
  it('keeps the required document metadata and application entrypoints', async () => {
    const indexHtml = await readFile(indexUrl, 'utf8');

    expect(indexHtml).toContain('<html lang="zh-CN">');
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<title>Subconverter Web</title>');
    expect(indexHtml).toContain('<meta name="description" content="自托管订阅转换与短链服务，提供受控请求策略、隐私边界和 Docker 部署。" />');
    expect(indexHtml).toContain('<link rel="canonical" href="__SUBWEB_PUBLIC_ORIGIN__/" />');
    expect(indexHtml).toContain('<meta property="og:url" content="__SUBWEB_PUBLIC_ORIGIN__/" />');
    expect(indexHtml).toContain('<script type="application/ld+json">');
    expect(indexHtml).toContain('"@type": "SoftwareApplication"');
    expect(indexHtml).toContain('<strong>Subconverter Web 需要启用 JavaScript 才能运行。</strong>');
    expect(indexHtml).toContain('<noscript>');
    expect(indexHtml).toContain('<script type="module" src="/src/main.js"></script>');
  });

  it('ships crawler discovery files for the public display deployment', async () => {
    const [robots, sitemap] = await Promise.all([
      readFile(new URL('../../public/robots.txt', import.meta.url), 'utf8'),
      readFile(new URL('../../public/sitemap.xml', import.meta.url), 'utf8'),
    ]);

    expect(robots).toContain('Sitemap: __SUBWEB_PUBLIC_ORIGIN__/sitemap.xml');
    expect(robots).toContain('Disallow: /sub');
    expect(robots).toContain('Disallow: /short-api/');
    expect(sitemap).toContain('<loc>__SUBWEB_PUBLIC_ORIGIN__/</loc>');
    expect(sitemap).not.toContain('api.ml1.one');
    expect(sitemap).not.toMatch(/<loc>[^<]*\?[^<]*<\/loc>/u);
  });

  it('uses the standalone project mark rather than the retired favicon', async () => {
    const favicon = await readFile(faviconUrl, 'utf8');

    expect(favicon).toContain('<svg');
    expect(favicon).toContain('viewBox="0 0 64 64"');
    await expect(stat(legacyFaviconUrl)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a scalable mobile viewport without remote font dependencies', async () => {
    const indexHtml = await readFile(indexUrl, 'utf8');
    const disabledZoomToken = ['user', 'scalable=no'].join('-');
    const loliFontHost = ['fonts', 'loli', 'net'].join('.');
    const googleFontHost = ['fonts', 'googleapis', 'com'].join('.');

    expect(indexHtml).toContain('width=device-width,initial-scale=1.0');
    expect(indexHtml).not.toContain(disabledZoomToken);
    expect(indexHtml).not.toContain(loliFontHost);
    expect(indexHtml).not.toContain(googleFontHost);
    expect(indexHtml).toContain('<script type="text/javascript" src="/conf/config.js"></script>');
  });

  it('assigns the app mount id only to the HTML document mount point', async () => {
    const [indexHtml, appSource] = await Promise.all([readFile(indexUrl, 'utf8'), readFile(appUrl, 'utf8')]);

    expect(indexHtml.match(/\bid=["']app["']/g)).toHaveLength(1);
    expect(indexHtml).toMatch(/<div\s+id=["']app["']\s*><\/div>/);
    expect(appSource).not.toMatch(/\bid=["']app["']/);
  });

  it('keeps the workspace shell and conditional dialog at the application root', async () => {
    const appSource = await readFile(appUrl, 'utf8');

    expect(appSource).toContain('<MainLayout />');
    expect(appSource).toContain('<DialogView v-if="dialog.active" />');
    expect(appSource).not.toContain('router-view');
    expect(appSource).not.toContain('$store');
  });
});
