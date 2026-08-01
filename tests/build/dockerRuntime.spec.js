import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('Docker runtime contract', () => {
  it('pins supported multi-platform bases and keeps OCI labels on the final non-root image', async () => {
    const dockerfile = await readFile(rootFile('Dockerfile'), 'utf8');
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf('FROM '));

    expect(dockerfile).toMatch(/^FROM node:24-alpine@sha256:[0-9a-f]{64} AS build/m);
    expect(finalStage).toMatch(/^FROM nginxinc\/nginx-unprivileged:1\.30\.4-alpine@sha256:[0-9a-f]{64}/m);
    expect(finalStage).toContain('org.opencontainers.image.source="https://github.com/keleyaa/subweb"');
    expect(finalStage).toContain('RUN apk add --no-cache openssl=3.5.7-r0');
    expect(finalStage).toContain('EXPOSE 8080 8443');
    expect(finalStage).toContain('HEALTHCHECK');
    expect(finalStage).toMatch(/GATEWAY_MODE" = platform[^\n]+\$\{?PORT\}?/);
    expect(finalStage).toContain('http://127.0.0.1:8080/healthz');
    expect(finalStage).toContain('https://127.0.0.1:8443/healthz');
    expect(finalStage).not.toContain('http://127.0.0.1:${GATEWAY_PORT}/healthz');
    expect(finalStage).toContain('COPY --chown=101:101 nginx/templates /etc/nginx/gateway/templates');
    expect(finalStage).toContain('COPY --chown=101:101 nginx/snippets /etc/nginx/gateway/snippets');
    expect(finalStage).toContain('scripts/render-gateway-config.sh');
    expect(finalStage).not.toContain('nginx/default.conf');
    expect(finalStage).not.toMatch(/^(?:ARG|ENV)\s+(?:MYURLS_API_TOKEN|REDIS_PASSWORD)/m);
  });

  it('provides an official Compose deployment with constrained runtime defaults', async () => {
    const compose = await readFile(rootFile('compose.yaml'), 'utf8');

    expect(compose).toContain('build:');
    expect(compose).toContain('${SUBWEB_PORT:-18080}:8080');
    expect(compose).toContain('API_URL:');
    expect(compose).toContain('SHORT_URL:');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('- ALL');
  });

  it('ships reusable runtime smoke verification and environment examples', async () => {
    await expect(access(rootFile('scripts/verify-container.sh'))).resolves.toBeUndefined();
    const example = await readFile(rootFile('.env.example'), 'utf8');

    expect(example).toContain('API_URL=https://api.ml1.one');
    expect(example).toContain('SHORT_URL=https://ml1.one');
    expect(example).toContain('SUBWEB_PORT=18080');
  });

  it('serves the SPA with security headers and an explicit health endpoint', async () => {
    const nginx = await readFile(rootFile('nginx/snippets/security-headers.conf'), 'utf8');
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');

    expect(routes).toContain('location = /healthz');
    expect(routes).toContain("try_files $uri $uri/ /index.html");
    expect(nginx).toContain('Content-Security-Policy');
    expect(nginx).toContain('X-Content-Type-Options');
    expect(nginx).toContain('Referrer-Policy');
  });

  it('blocks releases until application, browser, container, and image checks pass', async () => {
    const workflow = await readFile(rootFile('.github/workflows/docker-build-release.yml'), 'utf8');

    for (const command of [
      'npm ci',
      'npm run verify',
      'npm run test:e2e',
      'npm audit --audit-level=moderate',
      'docker compose config --quiet',
      './scripts/verify-container.sh subweb:ci',
    ]) {
      expect(workflow).toContain(command);
    }
    expect(workflow).toContain('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(workflow).toContain('needs: quality');
    expect(workflow).toContain('group: docker-release-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('provenance: mode=max');
    expect(workflow).toContain('sbom: true');
    expect(workflow).toContain('sha-${{ steps.tag.outputs.short_sha }}');
    expect(workflow).not.toContain('Static verification only');
  });
});
