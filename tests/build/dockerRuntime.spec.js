import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('Docker runtime contract', () => {
  it('pins supported multi-platform bases and keeps OCI labels on the final non-root image', async () => {
    const dockerfile = await readFile(rootFile('Dockerfile'), 'utf8');
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf('FROM '));

    expect(dockerfile).toMatch(/^FROM node:24-alpine@sha256:[0-9a-f]{64} AS frontend-build/m);
    expect(dockerfile).toMatch(/^FROM golang:1\.25-alpine@sha256:[0-9a-f]{64} AS gateway-build/m);
    expect(finalStage).toMatch(/^FROM gcr\.io\/distroless\/static-debian12:nonroot@sha256:[0-9a-f]{64}/m);
    expect(finalStage).toContain('org.opencontainers.image.source="https://github.com/keleyaa/subweb"');
    expect(dockerfile).toContain('RUN apk add --no-cache ca-certificates tzdata');
    expect(finalStage).toContain('EXPOSE 8080 25502');
    expect(finalStage).toContain('HEALTHCHECK');
    expect(finalStage).toContain('CMD ["/app/gateway", "--healthcheck"]');
    expect(finalStage).toContain('COPY --from=frontend-build --chown=65532:65532 /app/dist /app/dist');
    expect(finalStage).toContain('COPY --from=gateway-build /etc/ssl/certs/ca-certificates.crt');
    expect(finalStage).toContain('COPY --from=gateway-build /usr/share/zoneinfo /usr/share/zoneinfo');
    expect(finalStage).toContain('USER 65532:65532');
    expect(finalStage).not.toContain('nginx');
    expect(finalStage).not.toMatch(/^(?:ARG|ENV)\s+(?:MYURLS_API_TOKEN|REDIS_PASSWORD)/m);
    await expect(access(rootFile('start.sh'))).rejects.toThrow();
  });

  it('provides a five-service Compose deployment with one loopback entrypoint', async () => {
    const compose = await readFile(rootFile('compose.yaml'), 'utf8');

    expect(compose).toContain('x-runtime-environment: &runtime-environment');
    expect(compose).toContain('TZ: Asia/Shanghai');
    expect(compose).toContain('x-runtime-logging: &runtime-logging');
    expect(compose).toContain('driver: json-file');
    expect(compose).toContain('max-size: "10m"');
    expect(compose).toContain('max-file: "3"');
    expect(compose).toContain('gateway:');
    expect(compose).toContain('myurls-app:');
    expect(compose).toContain('myurls-short:');
    expect(compose).toContain('redis:');
    expect(compose).toContain('subconverter:');
    expect(compose).not.toContain('request-policy:');
    expect(compose).not.toContain('profiles:');
    expect(compose).toContain('127.0.0.1:${SUBWEB_PORT:-18080}:8080');
    expect(compose).toContain('redis-data:');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('- ALL');
    expect(compose).toContain(
      'image: "${MYURLS_IMAGE:-ghcr.io/keleyaa/myurls:v2.0.6@sha256:3ccd97bd9b3c5ad6dfea4c414f055698b0cce39a54a47fdb94c5cab7f6526ed3}"',
    );
  });

  it('ships a distroless Gateway healthcheck verifier without the retired combined image', async () => {
    await expect(access(rootFile('scripts/verify-container.sh'))).resolves.toBeUndefined();
    const verifier = await readFile(rootFile('scripts/verify-container.sh'), 'utf8');

    expect(verifier).toContain('docker build --check --file Dockerfile .');
    expect(verifier).toContain('docker build --file Dockerfile --tag "$image" .');
    expect(verifier).toContain('State.Health');
    expect(verifier).toContain('Gateway healthcheck did not pass before timeout');
    expect(verifier).toContain('--read-only');
    expect(verifier).toContain('--cap-drop ALL');
    expect(verifier).toContain('--security-opt no-new-privileges:true');
    expect(verifier).toContain('.Config.User');
    expect(verifier).toContain('65532:65532');
    expect(verifier).not.toContain('Dockerfile.simple');
    expect(verifier).not.toContain('nginx');
    expect(verifier).not.toContain('MYURLS_API_TOKEN');
  });

  it('removes retired Docker and Compose runtime artifacts', async () => {
    for (const path of [
      'Dockerfile.simple',
      'compose.hardened.yaml',
      'scripts/simple-start.sh',
      'scripts/render-simple-gateway-config.sh',
      'scripts/verify-simple-stack.sh',
    ]) {
      await expect(access(rootFile(path))).rejects.toThrow();
    }
  });

  it('blocks releases until unified application, browser, and locked-image checks pass', async () => {
    const workflow = await readFile(rootFile('.github/workflows/docker-build-release.yml'), 'utf8');
    const releaseVerifier = await readFile(rootFile('scripts/verify-release.sh'), 'utf8');

    for (const command of [
      'npm ci',
      'npm run verify:locks',
      'node scripts/verify-production-readiness.mjs',
      './scripts/configure.sh --app-domain app.test --api-domain api.app.test --short-domain short.app.test --turnstile-site-key test-site-key --turnstile-secret-key test-secret-key',
      'npm run verify:compose',
      'npm run verify:local',
      'npm run verify:ci',
      'npm run test:e2e',
      'npm audit --audit-level=moderate',
    ]) {
      expect(workflow).toContain(command);
    }
    const orderedCommands = [
      'npm run verify:locks',
      'node scripts/verify-production-readiness.mjs',
      'npm run verify:compose',
      'npm run verify:local',
      'npm run verify:ci',
      'npm run test:e2e',
      'npm audit --audit-level=moderate',
      'aquasecurity/trivy-action@',
    ];
    for (let index = 1; index < orderedCommands.length; index += 1) {
      expect(workflow.indexOf(orderedCommands[index - 1])).toBeLessThan(
        workflow.indexOf(orderedCommands[index]),
      );
    }
    expect(workflow).toContain('file: ./Dockerfile');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('rm -f .env');
    expect(workflow).not.toMatch(/upload-artifact[\s\S]{0,500}(?:\.env|fullchain\.pem|privkey\.pem|compose\.log|services\.log)/);
    expect(workflow).toContain('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(workflow).toContain('trivyignores: .trivyignore.redis');
    const finalImageScan = workflow.slice(
      workflow.indexOf('- name: Scan final image'),
      workflow.indexOf('- name: Scan external runtime images (Redis)'),
    );
    const releaseCandidateScan = workflow.slice(
      workflow.indexOf('- name: Scan release candidate'),
      workflow.indexOf('- name: Promote verified candidate'),
    );
    expect(finalImageScan).not.toContain('trivyignores:');
    expect(releaseCandidateScan).not.toContain('trivyignores:');
    expect(releaseVerifier).toContain('docker build --file Dockerfile --tag subweb:release-check .');
    for (const legacyContract of [
      'Dockerfile.simple',
      'compose.hardened.yaml',
      'request-policy',
      'verify-container.sh',
      'verify-integrated-stack.sh',
      'verify-redis-operations.sh',
    ]) {
      expect(workflow).not.toContain(legacyContract);
      expect(releaseVerifier).not.toContain(legacyContract);
    }
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
    expect(workflow).not.toContain('Static verification only');
  });
});
