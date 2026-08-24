import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('gateway routing contract', () => {
  it('gives stable application routes priority over the constrained short-code matcher', async () => {
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');
    const shortCodePosition = routes.indexOf('location ~ "^/[A-Za-z0-9_-]{1,64}$"');

    for (const route of [
      'location = /healthz',
      'location = /favicon.svg',
      'location = /robots.txt',
      'location = /sitemap.xml',
      'location ^~ /assets/',
      'location ^~ /conf/',
      'location = /short-api/short',
      'location ^~ /short-api/',
    ]) {
      expect(routes).toContain(route);
      expect(routes.indexOf(route)).toBeLessThan(shortCodePosition);
    }
    expect(routes).not.toContain('location ~ ^/[^/]+$');
    expect(shortCodePosition).toBeGreaterThan(-1);
    expect(routes).toContain('limit_except GET HEAD');
    expect(routes).toContain('try_files $uri $uri/ /index.html');
    expect(routes).toContain('add_header X-Robots-Tag "noindex, nofollow, noarchive" always;');
  });

  it('accepts only POST for short creation, caps its body, overwrites authorization, and targets exactly /short', async () => {
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');
    const start = routes.indexOf('location = /short-api/short');
    const end = routes.indexOf('\n}', start) + 2;
    const block = routes.slice(start, end);

    expect(block).toContain('limit_except POST');
    expect(block).toContain('if ($short_origin_allowed = 0)');
    expect(block).toContain('client_max_body_size @@MYURLS_MAX_BODY_BYTES@@;');
    expect(block).toContain('proxy_set_header Authorization "";');
    expect(block).toContain('proxy_set_header Proxy-Authorization "";');
    expect(block).toContain('proxy_set_header Authorization "Bearer @@MYURLS_API_TOKEN@@";');
    expect(block.indexOf('Authorization ""')).toBeLessThan(block.indexOf('Authorization "Bearer'));
    expect(block).toContain('if ($short_content_type_allowed = 0)');
    expect(block).toContain('return 415;');
    expect(block.indexOf('return 415')).toBeLessThan(block.indexOf('Authorization "Bearer'));
    expect(block).toContain('set $myurls_upstream "@@MYURLS_UPSTREAM@@";');
    expect(block).toContain('proxy_pass $myurls_upstream/short$is_args$args;');
  });

  it('allows only JSON and form Content-Types with optional safe parameters', async () => {
    const map = await readFile(rootFile('nginx/snippets/content-type-map.conf'), 'utf8');

    expect(map).toContain('map $http_content_type $short_content_type_allowed');
    expect(map).toContain('default 0;');
    expect(map).toMatch(/application\/json[^\n]+1;/i);
    expect(map).toMatch(/application\/x-www-form-urlencoded[^\n]+1;/i);
    expect(map).not.toContain('text/plain');
  });

  it('terminates allowed SHORT preflight requests before the POST-only proxy path', async () => {
    const routes = await readFile(rootFile('nginx/snippets/short-routes.conf.template'), 'utf8');
    const start = routes.indexOf('location = /short-api/short');
    const end = routes.indexOf('\n}', start) + 2;
    const block = routes.slice(start, end);

    expect(block).toContain('if ($request_method = OPTIONS)');
    expect(block).toContain('return 204;');
    expect(block).toContain('if ($request_method != POST)');
    expect(block).toContain('return 405;');
    expect(block.indexOf('return 204')).toBeLessThan(block.indexOf('return 405'));
    expect(block).not.toContain('limit_except POST');
    expect(block).not.toContain('try_files');
  });

  it('preserves the original API path and query while forwarding only validated public headers', async () => {
    const routes = await readFile(rootFile('nginx/snippets/api-routes.conf.template'), 'utf8');
    const proxyHeaders = await readFile(rootFile('nginx/snippets/proxy-headers.conf.template'), 'utf8');

    expect(routes).toContain('set $subconverter_upstream "@@SUBCONVERTER_UPSTREAM@@";');
    expect(routes).toContain('proxy_pass $subconverter_upstream$request_uri;');
    expect(routes).not.toMatch(/proxy_pass\s+[^;]+\/;/);
    expect(routes).not.toContain('proxy_set_header Authorization');
    expect(proxyHeaders).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(proxyHeaders).not.toContain('$proxy_add_x_forwarded_for');
    expect(proxyHeaders).toContain('proxy_set_header Host @@PUBLIC_HOST@@;');
    expect(proxyHeaders).toContain('proxy_set_header X-Forwarded-Host @@PUBLIC_HOST@@;');
    expect(proxyHeaders).toContain('proxy_set_header X-Forwarded-Proto @@PUBLIC_SCHEME@@;');
    expect(routes).toContain('add_header X-Robots-Tag "noindex, nofollow, noarchive" always;');
  });

  it.each(['http.conf.template', 'direct-tls.conf.template'])('returns 421 for unknown hosts without an upstream default in %s', async (name) => {
    const template = await readFile(rootFile(`nginx/templates/${name}`), 'utf8');
    const defaultServerStart = template.indexOf('server_name _;');
    const defaultServerEnd = template.indexOf('\n  }', defaultServerStart);
    const defaultServer = template.slice(defaultServerStart, defaultServerEnd);

    expect(defaultServer).toContain('return 421;');
    expect(defaultServer).not.toContain('proxy_pass');
  });

  it.each(['http.conf.template', 'direct-tls.conf.template'])('uses a runtime resolver placeholder rather than Docker DNS in %s', async (name) => {
    const template = await readFile(rootFile(`nginx/templates/${name}`), 'utf8');

    expect(template).toContain('resolver @@NGINX_RESOLVER@@ ipv6=off valid=30s;');
    expect(template).not.toContain('resolver 127.0.0.11');
    expect(template).toContain('limit_req_zone $binary_remote_addr zone=subweb_api:10m rate=60r/m;');
    expect(template).toContain('limit_req_zone $binary_remote_addr zone=subweb_short:10m rate=20r/m;');
  });
});
