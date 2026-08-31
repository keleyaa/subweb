import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('gateway routing contract', () => {
  it('adapts only the same-origin Rust creation endpoint', async () => {
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');
    const start = routes.indexOf('location = /short-api/links');
    const block = routes.slice(start, routes.indexOf('\n}', start) + 2);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('limit_except POST');
    expect(block).toContain('if ($short_origin_allowed = 0)');
    expect(block).toContain('client_max_body_size @@MYURLS_MAX_BODY_BYTES@@;');
    expect(block).toContain('if ($myurls_json_content_type_allowed = 0)');
    expect(block).toContain('if ($args != "")');
    expect(block).toContain('proxy_set_header Authorization "";');
    expect(block).toContain('proxy_set_header Cookie "";');
    expect(block).toContain('proxy_set_header Origin "";');
    expect(block).toContain('proxy_pass $myurls_upstream/api/links;');
    expect(routes).toContain('location ^~ /short-api/');
    expect(routes).not.toContain('MYURLS_API_TOKEN');
  });

  it('accepts only JSON for creation', async () => {
    const map = await readFile(rootFile('nginx/snippets/content-type-map.conf'), 'utf8');
    expect(map).toContain('map $http_content_type $myurls_json_content_type_allowed');
    expect(map).toMatch(/application\/json[^\n]+1;/i);
    expect(map).not.toContain('application/x-www-form-urlencoded');
    expect(map).not.toContain('multipart/form-data');
  });

  it('keeps the short host as a transparent MyUrls proxy', async () => {
    const routes = await readFile(rootFile('nginx/snippets/short-routes.conf.template'), 'utf8');
    expect(routes).toContain('location / {');
    expect(routes).toContain('proxy_pass $myurls_upstream$request_uri;');
    expect(routes).toContain('proxy_set_header Authorization "";');
    expect(routes).toContain('proxy_set_header Proxy-Authorization "";');
    expect(routes).not.toContain('Access-Control-Allow-Origin');
    expect(routes).not.toContain('MYURLS_API_TOKEN');
  });

  it('preserves static application routes and constrained redirects', async () => {
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');
    const shortCodePosition = routes.indexOf('location ~ "^/[A-Za-z0-9_-]{1,64}$"');
    for (const route of ['location = /healthz', 'location ^~ /assets/', 'location ^~ /conf/', 'location = /short-api/links']) {
      expect(routes.indexOf(route)).toBeGreaterThan(-1);
      expect(routes.indexOf(route)).toBeLessThan(shortCodePosition);
    }
    expect(routes).toContain('limit_except GET HEAD');
    expect(routes).toContain('try_files $uri $uri/ /runtime-index.html');
  });

  it('preserves the converter path and validated public headers', async () => {
    const routes = await readFile(rootFile('nginx/snippets/api-routes.conf.template'), 'utf8');
    const proxyHeaders = await readFile(rootFile('nginx/snippets/proxy-headers.conf.template'), 'utf8');
    expect(routes).toContain('proxy_pass $subconverter_upstream$request_uri;');
    expect(routes).toContain('if ($request_method != GET) { return 405; }');
    const apiBlock = routes.slice(routes.indexOf('location = /sub'), routes.indexOf('\n}', routes.indexOf('location = /sub')) + 2);
    for (const header of ['Authorization', 'Proxy-Authorization', 'Cookie', 'Origin']) {
      expect(apiBlock).toContain(`proxy_set_header ${header} "";`);
    }
    expect(proxyHeaders).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(proxyHeaders).not.toContain('$proxy_add_x_forwarded_for');
    expect(proxyHeaders).toContain('proxy_set_header Host @@PUBLIC_HOST@@;');
  });

  it('returns 421 for unknown hosts and uses a runtime resolver', async () => {
    const template = await readFile(rootFile('nginx/templates/http.conf.template'), 'utf8');
    const start = template.indexOf('server_name _;');
    const defaultServer = template.slice(start, template.indexOf('\n  }', start));
    expect(defaultServer).toContain('return 421;');
    expect(defaultServer).not.toContain('proxy_pass');
    expect(template).toContain('resolver @@NGINX_RESOLVER@@ ipv6=off valid=30s;');
    expect(template).toContain('limit_req_zone $binary_remote_addr zone=subweb_short:10m rate=20r/m;');
  });
});
