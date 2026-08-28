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
    expect(finalStage).toContain('RUN apk update');
    expect(finalStage).toContain('apk upgrade libcrypto3 libssl3');
    expect(finalStage).toContain('apk add --no-cache tzdata');
    expect(finalStage).toContain('tzdata');
    expect(finalStage).toContain('ENV TZ=Asia/Shanghai');
    expect(finalStage).toContain('EXPOSE 8080');
    expect(finalStage).toContain('HEALTHCHECK');
    expect(finalStage).not.toContain('GATEWAY_MODE" = platform');
    expect(finalStage).toContain('http://127.0.0.1:8080/healthz');
    expect(finalStage).not.toContain('8443');
    expect(finalStage).not.toContain('http://127.0.0.1:${GATEWAY_PORT}/healthz');
    expect(finalStage).toContain('COPY --chown=101:101 nginx/templates /etc/nginx/gateway/templates');
    expect(finalStage).toContain('COPY --chown=101:101 nginx/snippets /etc/nginx/gateway/snippets');
    expect(finalStage).toContain('scripts/render-gateway-config.sh');
    expect(finalStage).not.toContain('nginx/default.conf');
    expect(finalStage).not.toMatch(/^(?:ARG|ENV)\s+(?:MYURLS_API_TOKEN|REDIS_PASSWORD)/m);
    const startScript = await readFile(rootFile('start.sh'), 'utf8');
    expect(startScript).not.toContain('configure_platform_runtime');
    expect(startScript).not.toContain('normalize_platform_upstream');
  });

  it('provides an integrated Compose deployment with one loopback gateway', async () => {
    const compose = await readFile(rootFile('compose.yaml'), 'utf8');

    expect(compose).toContain('x-gateway-common:');
    expect(compose).toContain('x-runtime-environment: &runtime-environment');
    expect(compose).toContain('TZ: Asia/Shanghai');
    expect(compose).toContain('x-runtime-logging: &runtime-logging');
    expect(compose).toContain('driver: json-file');
    expect(compose).toContain('max-size: "10m"');
    expect(compose).toContain('max-file: "3"');
    expect(compose).toContain('gateway:');
    expect(compose).not.toContain('gateway-http:');
    expect(compose).not.toContain('gateway-tls:');
    expect(compose).not.toContain('profiles:');
    expect(compose).toContain('${SUBWEB_PORT:-18080}:8080');
    expect(compose).toContain('redis-data:');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('- ALL');
    expect(compose).toContain(
      'image: "${MYURLS_IMAGE:-ghcr.io/keleyaa/myurls:v2.0.2@sha256:b76423a5b5f346c27c40cbecb3954409f645f85df462d49577bb14d738d6127b}"',
    );
  });

  it('ships reusable runtime smoke verification and environment examples', async () => {
    await expect(access(rootFile('scripts/verify-container.sh'))).resolves.toBeUndefined();
    const verifier = await readFile(rootFile('scripts/verify-container.sh'), 'utf8');
    const example = await readFile(rootFile('.env.example'), 'utf8');

    expect(verifier).toContain('--read-only');
    expect(verifier).toContain('--cap-drop ALL');
    expect(verifier).toContain('--security-opt no-new-privileges:true');
    expect(verifier).toContain('--tmpfs /tmp:uid=101,gid=101,mode=0700');
    expect(verifier).toContain('--tmpfs /usr/share/nginx/html/conf:uid=101,gid=101,mode=0700');
    expect(verifier).toContain("-e SHORT_DOMAIN='short.example.com'");
    expect(verifier).toContain("-e SUBCONVERTER_UPSTREAM='http://subconverter:25500'");
    expect(verifier).toContain("-e MYURLS_APP_UPSTREAM='http://myurls-app-edge:3000'");
    expect(verifier).toContain("-e MYURLS_SHORT_UPSTREAM='http://myurls-short-edge:3000'");
    expect(verifier).not.toContain('MYURLS_API_TOKEN');
    expect(verifier).toContain("ReadonlyRootfs");
    expect(verifier).toContain("CapDrop");
    expect(verifier).toContain("SecurityOpt");
    expect(verifier).toContain("grep -Eq 'TOKEN|SECRET|PASSWORD'");
    expect(verifier.match(/--header='Host: app\.example\.com'/g)).toHaveLength(2);
    expect(example).toContain('API_URL=https://api.ml1.one');
    expect(example).not.toContain('SHORT_URL=');
    expect(example).toContain('IP_HASH_SECRET=REPLACE_WITH_64_CHARACTER_HEX');
    expect(example).toContain('SUBWEB_PORT=18080');
  });

  it('serves the SPA with security headers and an explicit health endpoint', async () => {
    const nginx = await readFile(rootFile('nginx/snippets/security-headers.conf'), 'utf8');
    const routes = await readFile(rootFile('nginx/snippets/app-routes.conf.template'), 'utf8');

    expect(routes).toContain('location = /healthz');
    expect(routes).toContain("try_files $uri $uri/ /index.html");
    expect(nginx).toContain('Content-Security-Policy');
    expect(nginx).toContain("connect-src 'self' https: http://127.0.0.1:* http://localhost:*");
    expect(nginx).not.toContain("connect-src 'self' https: http:;");
    expect(nginx).toContain('X-Content-Type-Options');
    expect(nginx).toContain('Referrer-Policy');
  });

  it('blocks releases until application, browser, container, and image checks pass', async () => {
    const workflow = await readFile(rootFile('.github/workflows/docker-build-release.yml'), 'utf8');
    const integrationVerifier = await readFile(
      rootFile('scripts/verify-integrated-stack.sh'),
      'utf8',
    );
    const operationsVerifier = await readFile(
      rootFile('scripts/verify-redis-operations.sh'),
      'utf8',
    );
    const packageJson = JSON.parse(await readFile(rootFile('package.json'), 'utf8'));

    for (const command of [
      'npm ci',
      'npm run verify:locks',
      './scripts/configure.sh --app-domain app.test --api-domain api.app.test --short-domain short.app.test --turnstile-site-key test-site-key --turnstile-secret-key test-secret-key',
      'npm run verify:compose',
      'npm run verify',
      'npm run verify:container',
      'npm run verify:integration',
      'npm run test:e2e',
      'npm audit --audit-level=moderate',
    ]) {
      expect(workflow).toContain(command);
    }
    const orderedCommands = [
      'npm run verify:locks',
      'npm run verify:compose',
      'npm run verify:container',
      'npm run verify:integration',
      'npm run test:e2e',
      'npm audit --audit-level=moderate',
      'aquasecurity/trivy-action@',
    ];
    for (let index = 1; index < orderedCommands.length; index += 1) {
      expect(workflow.indexOf(orderedCommands[index - 1])).toBeLessThan(
        workflow.indexOf(orderedCommands[index]),
      );
    }
    expect(packageJson.scripts['verify:container']).toBe('./scripts/verify-container.sh subweb:ci');
    expect(packageJson.scripts['verify:integration']).toBe('./scripts/verify-integrated-stack.sh');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('rm -f .env');
    expect(workflow).not.toMatch(/upload-artifact[\s\S]{0,500}(?:\.env|fullchain\.pem|privkey\.pem|compose\.log|services\.log)/);
    expect(workflow).toContain('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(workflow).toContain('trivyignores: .trivyignore.redis');
    expect(workflow).toContain('trivyignores: .trivyignore.subconverter');
    expect(workflow).toContain('needs: quality');
    expect(workflow).toContain('packages: write');
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).toContain('group: docker-release-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('provenance: mode=max');
    expect(workflow).toContain('sbom: true');
    expect(workflow).toContain('sha-${{ steps.tag.outputs.short_sha }}');
    expect(workflow).toContain('Resolve external runtime images');
    expect(workflow).toContain('image-ref: ${{ env.REDIS_IMAGE }}');
    expect(workflow).toContain('image-ref: ${{ env.SUBCONVERTER_IMAGE }}');
    expect(workflow).toContain('image-ref: ${{ env.MYURLS_IMAGE }}');
    expect(workflow).toContain('Scan release candidate');
    expect(workflow).toContain('docker buildx imagetools create');
    for (const verifier of [integrationVerifier, operationsVerifier]) {
      expect(verifier).toContain("printf 'REDIS_IMAGE=%s\\n'");
      expect(verifier).toContain("printf 'SUBCONVERTER_IMAGE=%s\\n'");
    }
    expect(integrationVerifier).toContain('REDIS_IMAGE');
    expect(workflow).not.toContain('Static verification only');
  });
});
