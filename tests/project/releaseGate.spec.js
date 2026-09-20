import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { verifyEvidence } from '../../scripts/verify-evidence.mjs';
import {
  dockerComposeConfigTimeoutMs,
  runDockerComposeConfig,
  verifyDockerfile,
  verifyRenderedCompose,
} from '../../scripts/verify-production-readiness.mjs';
import { resolveRuntimeImages } from '../../scripts/runtime-image-contract.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'deploy/versions.lock.json'), 'utf8'));
const secureService = (service) => ({
  read_only: true,
  cap_drop: ['ALL'],
  security_opt: ['no-new-privileges:true'],
  user: '101:101',
  ...service,
});
const renderedProfile = (shortLinksEnabled) => {
  const images = resolveRuntimeImages(lock);
  const gateway = secureService({
    build: { dockerfile: 'Dockerfile' },
    ports: [{ host_ip: '127.0.0.1', target: 8080, published: 8080 }],
    networks: shortLinksEnabled
      ? { default: {}, 'myurls-edge': {}, 'redis-policy': {}, 'subconverter-egress': {} }
      : { default: {}, 'subconverter-egress': {} },
    environment: shortLinksEnabled
      ? {
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502', EGRESS_RESTRICTED_LISTEN_ADDR: '0.0.0.0:25503',
        SHORT_LINKS_ENABLED: 'true', APP_DOMAIN: 'app.example.test', SHORT_DOMAIN: 'short.example.test',
        MYURLS_UPSTREAM: 'http://myurls-edge:3000', REDIS_URL: 'redis://redis:6379/1',
      }
      : { EGRESS_LISTEN_ADDR: '0.0.0.0:25502', SHORT_LINKS_ENABLED: 'false' },
  });
  const services = shortLinksEnabled
    ? {
      gateway,
      myurls: secureService({ image: images.MYURLS_IMAGE, networks: { 'myurls-data': {}, 'myurls-edge': {} }, environment: { HTTPS_PROXY: 'http://gateway:25503', PUBLIC_BASE_URL: 'https://short.example.test', REDIS_URL: 'redis://redis:6379/0', TURNSTILE_HOSTNAME: 'app.example.test' } }),
      redis: secureService({ image: images.REDIS_IMAGE, networks: { 'myurls-data': {}, 'redis-policy': {} } }),
      subconverter: secureService({ user: '0:0', cap_add: ['CHOWN', 'SETGID', 'SETUID'], image: images.SUBCONVERTER_IMAGE, networks: { 'subconverter-egress': {} }, environment: { HTTPS_PROXY: 'http://gateway:25502' } }),
    }
    : { gateway, subconverter: secureService({ user: '0:0', cap_add: ['CHOWN', 'SETGID', 'SETUID'], image: images.SUBCONVERTER_IMAGE, networks: { 'subconverter-egress': {} }, environment: { HTTPS_PROXY: 'http://gateway:25502' } }) };
  return {
    services,
    networks: shortLinksEnabled
      ? { 'myurls-data': { internal: true }, 'myurls-edge': { internal: true }, 'redis-policy': { internal: true }, 'subconverter-egress': { internal: true } }
      : { 'subconverter-egress': { internal: true } },
  };
};
const withEnvironmentValue = (rendered, serviceName, name, value) => ({
  ...rendered,
  services: {
    ...rendered.services,
    [serviceName]: {
      ...rendered.services[serviceName],
      environment: { ...rendered.services[serviceName].environment, [name]: value },
    },
  },
});
const renderedErrors = (rendered, profile) => {
  const errors = [];
  verifyRenderedCompose(rendered, profile, lock, errors);
  return errors;
};

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
    expect(source).toContain('runtime_image_env=$(node scripts/runtime-image-contract.mjs env)');
    expect(source).toContain('export "$name=$value"');
    expect(source).not.toContain("const fs = require('node:fs');");
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

  it.each([
    [
      'times out',
      { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), status: null },
      `docker compose config timed out after ${dockerComposeConfigTimeoutMs}ms`,
    ],
    [
      'returns a nonzero status',
      { status: 17, stderr: 'invalid Compose file', stdout: '' },
      'docker compose config failed with exit status 17: invalid Compose file',
    ],
  ])('reports clearly when docker compose config %s', (_name, result, message) => {
    const calls = [];
    const spawn = (...argumentsList) => {
      calls.push(argumentsList);
      return result;
    };

    expect(() => runDockerComposeConfig(spawn, {
      composeFile: 'compose.yaml',
      cwd: root,
      envFile: '/tmp/subweb-compose.env',
      environment: {},
    })).toThrow(message);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ timeout: dockerComposeConfigTimeoutMs });
  });

  it('rejects a security override in the rendered Compose profile', () => {
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, 'deploy/versions.lock.json'), 'utf8'),
    );
    const errors = [];

    verifyRenderedCompose(
      { services: { gateway: { read_only: false } } },
      { composeFile: 'compose.yaml', services: ['gateway', 'myurls', 'redis', 'subconverter'] },
      lock,
      errors,
    );

    expect(errors).toContain('gateway must set read_only to true');
  });

  it.each([
    ['gateway SHORT_DOMAIN', (rendered) => withEnvironmentValue(rendered, 'gateway', 'SHORT_DOMAIN', 'wrong.example.test'), 'MyUrls public base URL must match gateway SHORT_DOMAIN'],
    ['Gateway Redis database', (rendered) => withEnvironmentValue(rendered, 'gateway', 'REDIS_URL', 'redis://redis:6379/0'), 'gateway Redis URL must use database 1'],
    ['MyUrls public base URL', (rendered) => withEnvironmentValue(rendered, 'myurls', 'PUBLIC_BASE_URL', 'https://wrong.example.test'), 'MyUrls public base URL must match gateway SHORT_DOMAIN'],
    ['MyUrls Redis database', (rendered) => withEnvironmentValue(rendered, 'myurls', 'REDIS_URL', 'redis://redis:6379/1'), 'MyUrls Redis URL must use database 0'],
    ['Turnstile hostname', (rendered) => withEnvironmentValue(rendered, 'myurls', 'TURNSTILE_HOSTNAME', 'short.example.test'), 'MyUrls Turnstile hostname must match gateway APP_DOMAIN'],
  ])('rejects rendered %s contract drift', (_label, drift, expectedError) => {
    const fullProfile = { composeFile: 'compose.yaml', services: ['gateway', 'myurls', 'redis', 'subconverter'], shortLinksEnabled: true };
    expect(renderedErrors(renderedProfile(true), fullProfile)).toEqual([]);
    expect(renderedErrors(drift(renderedProfile(true)), fullProfile)).toContain(expectedError);
  });

  it.each([
    'EGRESS_RESTRICTED_LISTEN_ADDR', 'IP_HASH_SECRET', 'MYURLS_UPSTREAM',
    'REDIS_PASSWORD', 'REDIS_URL', 'SHORT_DOMAIN', 'TURNSTILE_SECRET_KEY',
    'TURNSTILE_SITE_KEY',
  ])('rejects %s in the disabled rendered profile', (name) => {
    const profile = { composeFile: 'compose.disabled-short-links.yaml', services: ['gateway', 'subconverter'], shortLinksEnabled: false };
    expect(renderedErrors(renderedProfile(false), profile)).toEqual([]);
    const drifted = withEnvironmentValue(renderedProfile(false), 'gateway', name, 'unexpected');
    expect(renderedErrors(drifted, profile)).toContain(`disabled short-link profile must not set ${name}`);
  });

  it('requires subconverter egress to remain internal when short links are disabled', () => {
    const profile = { composeFile: 'compose.disabled-short-links.yaml', services: ['gateway', 'subconverter'], shortLinksEnabled: false };
    const rendered = renderedProfile(false);
    const drifted = { ...rendered, networks: { ...rendered.networks, 'subconverter-egress': { internal: false } } };
    expect(renderedErrors(drifted, profile)).toContain('subconverter-egress must be an internal network');
  });

  it('rejects a Dockerfile that does not declare every locked internal port', async () => {
    const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
    const lock = JSON.parse(await readFile(new URL('../../deploy/versions.lock.json', import.meta.url), 'utf8'));

    const accepted = [];
    verifyDockerfile(dockerfile, lock, accepted);
    expect(accepted).toEqual([]);

    const drifted = dockerfile.replace('EXPOSE 8080 25502 25503', 'EXPOSE 8080 25502');
    expect(drifted).not.toBe(dockerfile);
    const missingPort = [];
    verifyDockerfile(drifted, lock, missingPort);
    expect(missingPort).toContain('Dockerfile EXPOSE must declare the locked internal port 25503');

    const extraPort = [];
    verifyDockerfile(`${dockerfile.replace('EXPOSE 8080 25502 25503', 'EXPOSE 8080 25502 25503 9000')}`, lock, extraPort);
    expect(extraPort).toContain('Dockerfile EXPOSE declares unlocked internal port 9000');
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
    expect(workflow).toContain('outputs:\n      source_sha: ${{ steps.source.outputs.source_sha }}');
    expect(workflow).toContain('EXPECTED_SOURCE_SHA: ${{ needs.quality.outputs.source_sha }}');
    expect(workflow).toContain('Release tag does not match the quality-verified commit');
    expect(workflow).toContain('source_sha=$(git rev-parse HEAD)');
     expect(workflow).toContain('timeout-minutes: 60');
     expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).toContain("semver_pattern='^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'");
    expect(workflow).toContain('[ "${#VERSION}" -le 128 ]');
    expect(workflow).toContain('[ "${#version}" -le 128 ]');
    expect(workflow).not.toContain('npm pkg get version');
    expect(workflow).toContain('[[ "$source_sha" == "$EXPECTED_SOURCE_SHA" ]]');
    expect(workflow.indexOf('[[ "$source_sha" == "$EXPECTED_SOURCE_SHA" ]]')).toBeLessThan(workflow.indexOf('name: Set up QEMU'));
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

  it('does not offer unmanaged runtime image overrides', () => {
    const environmentTemplate = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

    expect(environmentTemplate).toContain(
      'configure.sh generates REDIS_IMAGE, SUBCONVERTER_IMAGE, and MYURLS_IMAGE',
    );
    for (const variable of ['REDIS_IMAGE', 'SUBCONVERTER_IMAGE', 'MYURLS_IMAGE']) {
      expect(environmentTemplate).not.toMatch(new RegExp(`^#?\\s*${variable}=`, 'mu'));
    }
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
    expect(source).toContain('tags: ghcr.io/${{ env.GHCR_IMAGE }}:${{ steps.tag.outputs.version }}');
    expect(source).not.toContain('sha-${SHORT_SHA}');

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
    expect(source).toContain('node scripts/runtime-image-contract.mjs env >> "$GITHUB_ENV"');
    expect(source).toContain('scripts/runtime-image-contract.mjs rollback');
    expect(source).toContain('--argjson runtime_images "$runtime_images_json"');
    expect(source).toContain('runtime_images: $runtime_images');
     expect(source).toContain('(keys | sort) == ["myurls", "redis", "subconverter"]');
     expect(source).toContain('test("@sha256:[0-9a-f]{64}$")');
     expect(source).toContain('has("linux/amd64")');
  });
});
