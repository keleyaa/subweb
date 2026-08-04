import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('gateway logging privacy', () => {
  it.each([
    'nginx/templates/http.conf.template',
    'nginx/templates/direct-tls.conf.template',
    'deploy/local/nginx.conf.template',
  ])('logs only time, method, privacy-safe route, and status in %s', async (path) => {
    const template = await readFile(rootFile(path), 'utf8');
    const format = template.match(/log_format\s+gateway_privacy\s+([^;]+);/)?.[1] ?? '';

    expect(template).toContain('map $uri $privacy_route');
    expect(template).toContain('"~^/[A-Za-z0-9_-]{1,64}$" "/:shortKey";');
    expect(format).toContain('$time_iso8601');
    expect(format).toContain('$request_method');
    expect(format).toContain('$privacy_route');
    expect(format).toContain('$status');
    expect(format).not.toContain('$uri');
    expect(format).not.toMatch(/\$request(?:\s|'|")/);
    expect(format).not.toContain('$request_uri');
    expect(format).not.toContain('$args');
    expect(format).not.toContain('$request_body');
    expect(format.toLowerCase()).not.toContain('authorization');
  });

  it('does not log secrets from the renderer or image definition', async () => {
    const renderer = await readFile(rootFile('scripts/render-gateway-config.sh'), 'utf8');
    const dockerfile = await readFile(rootFile('Dockerfile'), 'utf8');

    expect(renderer).not.toContain('envsubst');
    expect(dockerfile).not.toMatch(/^(?:ARG|ENV)\s+MYURLS_API_TOKEN/m);
    expect(dockerfile).not.toContain('Bearer ');
  });
});
