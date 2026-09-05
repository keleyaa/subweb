import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('single-container deployment', () => {
  it('ships one published service with persistent data volumes', async () => {
    const compose = await readFile(new URL('../../compose.single.yaml', import.meta.url), 'utf8');
    expect(compose).toContain('  subweb:');
    expect(compose).not.toMatch(/^ {2}(gateway|redis|myurls-app|myurls-short|subconverter):/mu);
    expect(compose).toContain('127.0.0.1:${SUBWEB_PORT:-18080}:8080');
    expect(compose).toContain('- redis-data:/data');
    expect(compose).toContain('- subconverter-runtime:/base');
    expect(compose).toContain('dockerfile: Dockerfile.single');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('pids_limit: 256');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('user: "0:0"');
  });

  it('bundles all upstream executables and checks every local dependency', async () => {
    const dockerfile = await readFile(new URL('../../Dockerfile.single', import.meta.url), 'utf8');
    const entrypoint = await readFile(new URL('../../scripts/single-container-entrypoint.sh', import.meta.url), 'utf8');
    expect(dockerfile).toContain('/app/gateway');
    expect(dockerfile).toContain('COPY --from=ghcr.io/aethersailor/subconverter-extended');
    expect(dockerfile).toContain('/usr/local/bin/myurl-server');
    expect(dockerfile).toContain('/usr/local/bin/redis-server');
    expect(entrypoint).toContain('SUBCONVERTER_UPSTREAM=http://127.0.0.1:25500');
    expect(entrypoint).toContain('MYURLS_APP_UPSTREAM=http://127.0.0.1:3001');
    expect(entrypoint).toContain('MYURLS_SHORT_UPSTREAM=http://127.0.0.1:3002');
    expect(entrypoint).toContain('WEB_ROOT=/app/web');
    expect(entrypoint).toContain('wait -n');
    expect(entrypoint).toContain('--healthcheck');
    expect(entrypoint).toContain('env -i');
    expect(entrypoint).toContain('subweb-log-supervisor');
    expect(entrypoint).toContain('subweb-app');
    expect(entrypoint).toContain('subweb-gateway');
    expect(entrypoint).toContain('subweb-redis');
  });
});
