import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { verifyEvidence } from '../../scripts/verify-evidence.mjs';

const root = path.resolve(import.meta.dirname, '../..');

describe('release evidence and command gate', () => {
  it('accepts only truthful deployment evidence states', () => {
    expect(verifyEvidence({ root })).toEqual([]);
  });

  it('runs release stages in fail-fast dependency order', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/verify-release.sh'), 'utf8');
    const commands = [
      'stage install npm ci',
      'stage audit npm audit --audit-level=moderate',
      'stage quality npm run verify:ci',
      'stage browser npm run test:e2e',
      'stage locks npm run verify:locks',
      'stage production-readiness node scripts/verify-production-readiness.mjs',
      'stage compose npm run verify:compose',
      'stage documentation npm run verify:docs',
      'stage container ./scripts/verify-container.sh subweb:release-check',
      'stage image-security ./scripts/verify-image-security.sh',
      'stage image-security-redis ./scripts/verify-image-security.sh',
      'stage image-security-subconverter ./scripts/verify-image-security.sh',
      'stage redis-operations ./scripts/verify-redis-operations.sh',
      'stage integration ./scripts/verify-integrated-stack.sh',
      'stage evidence node scripts/verify-evidence.mjs',
    ];
    let previous = -1;
    for (const command of commands) {
      const current = source.indexOf(command);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(source).toMatch(/^set -eu$/mu);
  });

  it('scopes an ephemeral Compose environment to the policy-image build when local deployment config is absent', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/verify-release.sh'), 'utf8');

    expect(source).toContain('if [ ! -f .env ]; then');
    for (const assignment of [
      'APP_DOMAIN=app.release-validation.test',
      'API_DOMAIN=api.release-validation.test',
      'API_URL=https://api.release-validation.test',
      'SHORT_DOMAIN=short.release-validation.test',
      'TURNSTILE_SITE_KEY=release-validation-site-key',
      'TURNSTILE_SECRET_KEY=release-validation-secret-key',
      'IP_HASH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'REDIS_PASSWORD=release-validation-redis-password',
    ]) {
      expect(source).toContain(assignment);
    }
    expect(source).toContain('build_request_policy() {');
    expect(source).toContain('env APP_DOMAIN="$APP_DOMAIN"');
    expect(source).toContain('stage request-policy-container build_request_policy');
    expect(source).not.toContain('export APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN');
  });

  it('accepts production readiness when the locked MyUrls artifact has a stable source tag', () => {
    const script = path.join(root, 'scripts/verify-production-readiness.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('tag gate passed');
  });

  it('uses one Docker-gated quality command for CI and local release checks', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-build-release.yml'), 'utf8');
    const releaseVerifier = fs.readFileSync(path.join(root, 'scripts/verify-release.sh'), 'utf8');

    expect(packageJson.scripts['verify:ci']).toBe('RUN_NGINX_GATEWAY_TESTS=1 RUN_DOCKER_INTEGRATION=1 npm run verify');
    expect(workflow).toContain('run: npm run verify:ci');
    expect(workflow).toContain('run: node scripts/verify-production-readiness.mjs');
    expect(releaseVerifier).toContain('stage quality npm run verify:ci');
    expect(workflow).not.toContain('RUN_NGINX_GATEWAY_TESTS: "1"');
    expect(workflow).not.toContain('RUN_DOCKER_INTEGRATION: "1"');
  });

  it('does not offer an interface-incompatible Node MyUrls override', () => {
    const environmentTemplate = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

    expect(environmentTemplate).toContain('only a Rust MyUrls image compatible with /api/links');
    expect(environmentTemplate).not.toContain('myurls:v1.13.0');
  });

  it('keeps browser short-link mocks on the public Rust route', () => {
    const source = fs.readFileSync(path.join(root, 'tests/e2e/app.spec.js'), 'utf8');

    expect(source).toContain("page.route('**/short-api/links'");
    expect(source).toContain("contentType: 'application/problem+json'");
    expect(source).not.toContain('/short-api/v1/links');
  });

  it('publishes one multi-platform release to Docker Hub and GHCR', () => {
    const source = fs.readFileSync(path.join(root, '.github/workflows/docker-build-release.yml'), 'utf8');

    expect(source.match(/uses: actions\/checkout@/g)).toHaveLength(2);
    expect(source.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(source).toContain('packages: write');
    expect(source).toContain('registry: ghcr.io');
    expect(source).toContain('username: ${{ github.actor }}');
    expect(source).toContain('password: ${{ secrets.GITHUB_TOKEN }}');

    for (const suffix of [
      'latest',
      '${RELEASE_TAG}',
      'sha-${SHORT_SHA}',
    ]) {
      expect(source).toContain('docker.io/${DOCKERHUB_IMAGE}:' + suffix);
    }
    for (const suffix of [
      'latest',
      '${RELEASE_TAG}',
      'sha-${SHORT_SHA}',
    ]) {
      expect(source).toContain('ghcr.io/${GHCR_IMAGE}:' + suffix);
    }
    expect(source).toContain(
      'ghcr.io/${{ env.GHCR_IMAGE }}:sha-${{ steps.tag.outputs.short_sha }}',
    );

    expect(source).toContain('Scan release candidate');
    expect(source).toContain('ghcr.io/${{ env.GHCR_IMAGE }}@${{ steps.image.outputs.digest }}');
    expect(source).toContain('docker buildx imagetools create');
    expect(source).toContain('Published digest mismatch');
    expect(source).toContain('dockerhub_reference');
    expect(source).toContain('ghcr_reference');
  });
});
