import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('unified Gateway routing contract', () => {
  it('keeps app, API, and short-link routes in the Go Gateway', async () => {
    const [server, client, handler, staticFiles] = await Promise.all([
      readFile(rootFile('services/gateway/internal/httpapi/server.go'), 'utf8'),
      readFile(rootFile('services/gateway/internal/myurls/client.go'), 'utf8'),
      readFile(rootFile('services/gateway/internal/myurls/handler.go'), 'utf8'),
      readFile(rootFile('services/gateway/internal/staticfiles/handler.go'), 'utf8'),
    ]);

    expect(server).toContain('request.URL.Path == "/short-api/links"');
    expect(server).toContain('case shortHost:');
    expect(server).toContain('handler.deps.AppShortLinks');
    expect(server).toContain('handler.deps.ShortLinks');
    expect(server).toContain('func (handler gatewayHandler) serveAPI');
    expect(client).toContain('target.Path = requestPath');
    expect(client).toContain('"/api/links"');
    expect(client).not.toContain('/api/v1/links');
    expect(handler).toContain('createPath       = "/short-api/links"');
    expect(handler).toContain('shortCodePattern');
    expect(handler).toContain('writeMyURLsError');
    expect(staticFiles).toContain('serveDynamicPath');
    expect(staticFiles).toContain('"/conf/config.js"');
    expect(staticFiles).toContain('configCacheControl');
  });

  it('routes Vite short-link development requests through the local Gateway', async () => {
    const viteConfig = await readFile(rootFile('vite.config.mjs'), 'utf8');

    expect(viteConfig).toContain('LOCAL_SUBWEB_PORT');
    expect(viteConfig).toContain('target: `http://127.0.0.1:${localGatewayPort}`');
    expect(viteConfig).not.toContain('LOCAL_MYURLS_PORT');
    expect(viteConfig).not.toContain('VITE_LOCAL_SUBCONVERTER_URL');
    expect(viteConfig).not.toContain('rewrite:');
    for (const header of ['authorization', 'proxy-authorization', 'cookie', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) {
      expect(viteConfig).toContain(`request.removeHeader('${header}')`);
    }
  });

  it('removes Nginx business route templates after Go Gateway migration', async () => {
    for (const path of [
      'nginx/templates/http.conf.template',
      'nginx/snippets/api-routes.conf.template',
      'nginx/snippets/app-routes.conf.template',
      'nginx/snippets/proxy-headers.conf.template',
      'nginx/snippets/short-routes.conf.template',
      'scripts/render-gateway-config.sh',
      'start.sh',
    ]) {
      await expect(access(rootFile(path))).rejects.toThrow();
    }
  });
});
