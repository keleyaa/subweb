import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
      'stage integration npm run verify:integration',
      'stage browser npm run test:e2e',
      'stage locks npm run verify:locks',
      'stage production-readiness node scripts/verify-production-readiness.mjs',
      'stage compose npm run verify:compose',
      'stage documentation npm run verify:docs',
      'stage gateway-image docker build --file Dockerfile --tag subweb:release-check .',
      'stage image-security ./scripts/verify-image-security.sh',
      'stage image-security-myurls ./scripts/verify-image-security.sh',
      'stage image-security-redis ./scripts/verify-image-security.sh',
      'stage image-security-subconverter ./scripts/verify-image-security.sh',
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

  it('creates an ephemeral unified Compose environment when local deployment config is absent', () => {
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
    expect(source).toContain('export APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN');
    expect(source).not.toContain('compose.hardened.yaml');
    expect(source).not.toContain('request-policy');
    expect(source).not.toContain('Dockerfile.simple');
    expect(source).not.toContain('verify-container.sh');
  });

  it('accepts production readiness for the locked unified production profile', () => {
    const script = path.join(root, 'scripts/verify-production-readiness.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('unified lock gate passed');
  });

  it('accepts the reduced deployment only with its explicit readiness profile', () => {
    const script = path.join(root, 'scripts/verify-production-readiness.mjs');
    const result = spawnSync(process.execPath, [script, '--short-links-disabled'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'compose.disabled-short-links.yaml',
    );
  });

  it('rejects a malformed MyUrls service node during standalone readiness validation', () => {
    const script = path.join(root, 'scripts/verify-production-readiness.mjs');
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'subweb-readiness-'));
    const lockPath = path.join(directory, 'versions.lock.json');
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, 'deploy/versions.lock.json'), 'utf8'),
    );
    lock.services.myurls = ['malformed'];

    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock));
      const result = spawnSync(process.execPath, [script, lockPath], {
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'services.myurls must be an object',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses one Docker-gated quality command for CI and local release checks', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-build-release.yml'), 'utf8');
    const releaseVerifier = fs.readFileSync(path.join(root, 'scripts/verify-release.sh'), 'utf8');

    expect(packageJson.scripts['verify:ci']).toBe(
      'RUN_DOCKER_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 npm run verify',
    );
    expect(workflow).toContain('run: npm run verify:ci');
    expect(workflow).toContain('file: ./Dockerfile');
    expect(workflow).not.toContain('Dockerfile.simple');
    expect(workflow).not.toContain('request-policy');
    expect(workflow).not.toContain('npm run verify:container');
    expect(workflow).toContain('run: npm run verify:integration');
    expect(workflow).not.toContain('npm run verify:operations');
    expect(workflow).toContain('run: npm run verify:local');
    expect(workflow).toContain('run: node scripts/verify-production-readiness.mjs');
    expect(releaseVerifier).toContain('stage quality npm run verify:ci');
    expect(releaseVerifier).toContain('stage integration npm run verify:integration');
    expect(releaseVerifier).toContain('stage local npm run verify:local');
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

  it('keeps an integration entrypoint that delegates to unified stack verification', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/verify-integrated-stack.sh'), 'utf8');
    const operations = fs.readFileSync(path.join(root, 'scripts/verify-redis-operations.sh'), 'utf8');

    expect(source).toContain('exec "$script_directory/verify-unified-stack.sh"');
    expect(operations).toContain('Unified Redis backup, restore, and service recovery verification passed.');
    expect(source).not.toContain('compose.hardened.yaml');
    expect(source).not.toContain('request-policy');
  });

  it('publishes one multi-platform release to Docker Hub and GHCR', () => {
    const source = fs.readFileSync(path.join(root, '.github/workflows/docker-build-release.yml'), 'utf8');

    expect(source.match(/uses: actions\/checkout@/g)).toHaveLength(2);
    expect(source.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(source).toContain('packages: write');
    expect(source).toContain('registry: ghcr.io');
    expect(source).toContain('username: ${{ github.actor }}');
    expect(source).toContain('password: ${{ secrets.GITHUB_TOKEN }}');
    expect(source).toContain('version:');
    expect(source).toContain("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    expect(source).toContain("      - 'v*.*.*'");
    expect(source).not.toMatch(/^\x20{2}pull_request:/mu);
    expect(source).toContain('git ls-remote --exit-code origin "refs/tags/$VERSION"');
    expect(source).toContain('source_sha=$(git rev-parse HEAD)');

    for (const suffix of [
      'latest',
      '${RELEASE_TAG}',
    ]) {
      expect(source).toContain('docker.io/${DOCKERHUB_IMAGE}:' + suffix);
    }
    for (const suffix of [
      'latest',
      '${RELEASE_TAG}',
    ]) {
      expect(source).toContain('ghcr.io/${GHCR_IMAGE}:' + suffix);
    }
    expect(source).not.toContain('sha-${SHORT_SHA}');

    expect(source).toContain('Scan release candidate');
    expect(source).toContain('ghcr.io/${{ env.GHCR_IMAGE }}@${{ steps.image.outputs.digest }}');
    expect(source).toContain('docker buildx imagetools create');
    expect(source).toContain('Published digest mismatch');
    expect(source).toContain('dockerhub_reference');
    expect(source).toContain('ghcr_reference');
    expect(source).toContain('runtime_images_json=$(node');
    expect(source).toContain('--argjson runtime_images "$runtime_images_json"');
    expect(source).toContain('runtime_images: $runtime_images');
    expect(source).toContain('.release_identity.runtime_images | has("redis") and has("subconverter") and has("myurls")');
  });
});
