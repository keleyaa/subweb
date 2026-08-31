import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const testCompose = new URL('../../compose.test.yaml', import.meta.url).pathname;
const appRoutes = new URL('../../nginx/snippets/app-routes.conf.template', import.meta.url).pathname;
const apiRoutes = new URL('../../nginx/snippets/api-routes.conf.template', import.meta.url).pathname;
const dockerIntegrationEnabled = process.env.RUN_DOCKER_INTEGRATION === '1';

describe('integrated Docker gateway stack', () => {
  it.each([
    [['--mode']],
    [['--mode', 'behind-proxy']],
    [['--unexpected']],
  ])('rejects invalid verifier arguments before contacting Docker: %j', (args) => {
    const result = spawnSync('sh', [verifier, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Usage: verify-integrated-stack.sh');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/docker: not found/i);
  });

  it('limits cleanup to the exact generated Compose project and its own temporary directory', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('docker compose -p "$project_name"');
    expect(source).toContain('down --volumes --remove-orphans');
    expect(source).not.toMatch(/docker\s+(?:system|volume|network|container)\s+prune/);
    expect(source).not.toMatch(/docker\s+(?:rm|rmi)\b/);
    expect(source).not.toContain('pkill');
    expect(source).toContain('${TMPDIR:-/tmp}/subweb-integration.XXXXXX');
    expect(source).not.toContain('mktemp -d /private/tmp');
    expect(source).toContain('scripts/verify-version-locks.mjs');
    expect(source).toContain('"MYURLS_IMAGE=$myurls_test_image"');
  });

  it('rejects arguments before checking optional runtime tools', async () => {
    const source = await readFile(verifier, 'utf8');
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('[ "$#" -eq 0 ]')).toBeLessThan(source.indexOf('for command in docker curl node openssl'));
  });

  it('uses the published production image without the removed test adapter', async () => {
    const source = await readFile(testCompose, 'utf8');

    expect(source).toContain('NODE_ENV: production');
    expect(source).toContain('TURNSTILE_MODE: cloudflare');
    expect(source).toContain('CREATE_DIRECT_LIMIT_10M: "100"');
    expect(source).not.toContain('TURNSTILE_MODE: test');
    expect(source).not.toContain('TEST_STORE');
  });

  it('defines explicit app routes for root static resources', async () => {
    const source = await readFile(appRoutes, 'utf8');

    for (const route of [
      'location = /favicon.svg',
      'location = /apple-touch-icon.png',
      'location = /icon-192.png',
      'location = /icon-512.png',
      'location = /site.webmanifest',
    ]) {
      expect(source).toContain(route);
    }
    expect(source).toContain('default_type application/manifest+json');
    expect(source).toContain('try_files $uri =404;');
  });

  it('limits the conversion API to bounded GET requests at the gateway', async () => {
    const source = await readFile(apiRoutes, 'utf8');

    expect(source).toContain('limit_except GET');
    expect(source).toContain('client_max_body_size 16k;');
  });

  it('checks the app host production static resources and MIME types', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('app_asset_path=');
    expect(source).toContain("-H 'Host: app.test'");
    expect(source).toContain('for app_png in apple-touch-icon icon-192 icon-512');
    for (const asset of ['/favicon.svg', '/site.webmanifest']) {
      expect(source).toContain(asset);
    }
    expect(source).toContain('image/svg+xml');
    expect(source).toContain('image/png');
    expect(source).toContain('application/manifest+json');
  });

  it('keeps integration cleanup and runtime checks scoped to the generated stack', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain("'SHORT_DOMAIN=short.test'");
    expect(source).toContain('compose up -d --build --wait');
    expect(source).toContain("for service_port in 'redis 6379' 'myurls-app 3000' 'myurls-short 3000' 'subconverter 25500'");
    expect(source).toContain('compose logs --no-color --tail 500');
    expect(source).toContain('/health/live');
    expect(source).toContain('/health/ready');
    expect(source).toContain('compose exec -T myurls-short curl --connect-timeout 3 --max-time 5 --fail --silent');
    expect(source).toContain('--connect-timeout');
    expect(source).toContain('--max-time');
    expect(source).toContain('request.setTimeout');
    expect(source).toContain('AbortSignal.timeout(5000)');
    expect(source).toContain('myurls-app-edge');
    expect(source).toContain('myurls-short-edge');
    expect(source).toContain("docker inspect --format '{{json .NetworkSettings.Networks}}'");
    expect(source).toContain('"${project_name}_default"');
    expect(source).toContain('"${project_name}_redis-policy"');
    expect(source).toContain('Gateway is attached to the Redis policy network');
    expect(source).toContain('Request Policy is not attached to the Redis policy network');
    expect(source).toContain('SubConverter is attached to the default network');
    expect(source).toContain('SubConverter is attached to the Redis policy network');
    expect(source).toContain('SubConverter is not attached to the controlled egress network');
    expect(source).toContain('attached to the default network');
    expect(source).toContain('post_json_from_client');
    expect(source).toContain('Gateway did not preserve distinct client identities');
    expect(source).toContain('docker restart "$redis_container"');
    expect(source).toContain('wait_for_healthy "$redis_container"');
    expect(source).toContain('post_json_from_client "$client_a_container"');
    expect(source).toContain('https://example.com/redis-recovery-$sentinel_value');
    expect(source).toContain('docker restart "$myurls_app_container"');
    expect(source).toContain('docker restart "$myurls_short_container"');
    expect(source).toContain('css_asset_path=');
    expect(source).toContain('/robots.txt');
    expect(source).toContain('/sitemap.xml');
    expect(source).toContain('content_type_for');
    expect(source).toContain('SHORT MyUrls creation returned');
    expect(source).toContain('challenge_client_container=');
    expect(source).toContain('post_json_from_client_response');
    expect(source).toContain('challenge_required');
    expect(source).toContain('siteKey');
     expect(source).not.toContain('gateway-tls');
    expect(source).not.toContain('TLS 证书');
  });

  it('keeps a clean privacy scan successful under set -e', async () => {
    const source = await readFile(verifier, 'utf8');
    expect(source).toContain('grep -Fq "$sentinel_value" "$service_log" && fail');
    expect(source).toContain("grep -Fq 'test-token' \"$service_log\" && fail");
    expect(source).toContain('grep -Fq "$redis_password" "$service_log" && fail');
    expect(source).toContain('grep -Fq "$ip_hash_secret" "$service_log" && fail');
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'verifies APP, Rust MyUrls, challenge retry, persistence, and private ports',
    () => {
      const result = spawnSync('sh', [verifier], {
        cwd: root,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      for (const marker of [
        'MyUrls integrated stack verification passed.',
      ]) {
        expect(output).toContain(marker);
      }
    },
    12 * 60 * 1000,
  );
});
