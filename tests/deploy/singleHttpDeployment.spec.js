import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('single HTTP deployment contract', () => {
  it('requires three domains without exposing deployment mode or TLS flags', async () => {
    const configure = await readFile(rootFile('scripts/configure.sh'), 'utf8');
    const deploy = await readFile(rootFile('scripts/docker-deploy.sh'), 'utf8');

    expect(configure).toContain("require_domain SHORT_DOMAIN");
    expect(configure).not.toContain("case \"$1\" in\n    --mode");
    expect(configure).not.toContain('--tls-cert');
    expect(configure).not.toContain('--tls-key');
    expect(configure).not.toContain('COMPOSE_PROFILES=');
    expect(deploy).not.toContain('--mode');
    expect(deploy).not.toContain('--tls-cert');
    expect(deploy).not.toContain('--tls-key');
  });

  it('runs one loopback gateway and keeps private services unpublished', async () => {
    const compose = await readFile(rootFile('compose.yaml'), 'utf8');
    const validator = await readFile(rootFile('scripts/validate-compose.sh'), 'utf8');

    expect(compose).toContain('  gateway:');
    expect(compose).toContain('127.0.0.1:${SUBWEB_PORT:-18080}:8080');
    expect(compose).toContain('  subconverter:');
    expect(compose).toContain('  myurls-app:');
    expect(compose).toContain('  myurls-short:');
    expect(compose).not.toContain('  request-policy:');
    expect(compose).not.toContain('gateway-tls:');
    expect(compose).not.toContain('profiles:');
    expect(compose).not.toContain('TLS_CERT_PATH');
    expect(compose).not.toContain('TLS_KEY_PATH');
    expect(validator).toContain('"gateway", "myurls-app", "myurls-short", "redis", "subconverter"');
    expect(validator).not.toContain('COMPOSE_PROFILES');
  });

  it('starts the Go Gateway without a runtime Nginx renderer or direct TLS configuration', async () => {
    const dockerfile = await readFile(rootFile('Dockerfile'), 'utf8');

    expect(dockerfile).toContain('EXPOSE 8080 25502');
    expect(dockerfile).not.toContain('EXPOSE 8080 8443');
    await expect(readFile(rootFile('start.sh'), 'utf8')).rejects.toThrow();
    await expect(readFile(rootFile('scripts/render-gateway-config.sh'), 'utf8')).rejects.toThrow();
  });
});
