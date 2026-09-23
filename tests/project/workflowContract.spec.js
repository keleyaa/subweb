import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];
const verifierPath = new URL('../../scripts/verify-workflows.sh', import.meta.url).pathname;
const readWorkflow = (name) => readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');

const pinnedActions = (workflow) =>
  [...workflow.matchAll(/^\s+uses:\s+([^\s]+)@([^\s]+)$/gmu)].map(([, action, ref]) => ({ action, ref }));

const makeLocalActionlintFixture = async (version, { dockerInfoFails = false } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-actionlint-'));
  const bin = join(root, 'bin');
  temporaryDirectories.push(root);
  await mkdir(bin);

  const commands = new Map([
    ['dirname', '#!/bin/sh\nexec /usr/bin/dirname "$@"\n'],
    ['awk', '#!/bin/sh\nexec /usr/bin/awk "$@"\n'],
    ['actionlint', [
      '#!/bin/sh',
      'if [ "${1-}" = -version ]; then',
      `  printf '%s\\n' '${version}'`,
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n')],
    ...(dockerInfoFails ? [['docker', '#!/bin/sh\nexit 1\n']] : []),
  ]);
  await Promise.all([...commands].map(async ([name, contents]) => {
    const path = join(bin, name);
    await writeFile(path, contents);
    await chmod(path, 0o755);
  }));

  return root;
};

const runVerifierWithoutDocker = (root) => spawnSync('/bin/sh', [verifierPath], {
  cwd: root,
  encoding: 'utf8',
  env: { PATH: join(root, 'bin') },
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('GitHub Actions workflow contract', () => {
  it('runs repository quality checks for pull requests and main', async () => {
    const workflow = await readWorkflow('local-dev.yml');

    expect(workflow).toContain('push:\n    branches: [main]');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('quality:');
    for (const command of [
      'npm run verify:ci',
      'npm run verify:locks',
      'npm run verify:production-readiness',
      'npm run verify:compose',
      'npm run verify:docs',
      'npm run verify:evidence',
      'npm run verify:workflows',
      'shellcheck',
      'Clean quality resources',
      'docker compose down --volumes --remove-orphans',
    ]) {
      expect(workflow).toContain(command);
    }
  });

  it('pins every third-party action to a full commit SHA', async () => {
    const workflows = await Promise.all([
      readWorkflow('local-dev.yml'),
      readWorkflow('docker-build-release.yml'),
    ]);

    for (const workflow of workflows) {
      const actions = pinnedActions(workflow);
      expect(actions.length).toBeGreaterThan(0);
      for (const { action, ref } of actions) {
        expect(ref, `${action} must use a commit SHA`).toMatch(/^[0-9a-f]{40}$/u);
      }
    }
  });

  it('bounds release-tag inputs in both workflow release steps', async () => {
    const workflow = await readWorkflow('docker-build-release.yml');

    for (const [stepName, versionVariable] of [
      ['Checkout requested release tag', 'VERSION'],
      ['Set release tags', 'version'],
    ]) {
      const start = workflow.indexOf(`- name: ${stepName}`);
      const next = workflow.indexOf('\n      - name:', start + 1);
      const step = workflow.slice(start, next === -1 ? undefined : next);

      expect(start).toBeGreaterThan(-1);
      expect(step).toContain(`[ "\${#${versionVariable}}" -le 128 ]`);
      expect(step).toContain('semver_pattern=');
    }
  });

  it('rejects a local actionlint version that differs from the pinned verifier', async () => {
    const root = await makeLocalActionlintFixture('1.7.12');

    const result = runVerifierWithoutDocker(root);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('actionlint 1.7.7');
    expect(result.stdout).toBe('');
  });

  it('accepts the pinned local actionlint fallback when Docker is unavailable', async () => {
    const root = await makeLocalActionlintFixture('1.7.7');

    const result = runVerifierWithoutDocker(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('workflow contracts=passed\n');
  });

  it('falls back to pinned local actionlint when the Docker daemon is unavailable', async () => {
    const root = await makeLocalActionlintFixture('1.7.7', { dockerInfoFails: true });

    const result = runVerifierWithoutDocker(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('workflow contracts=passed\n');
  });

  it('declares the release version for pinned actionlint shell analysis', async () => {
    const workflow = await readWorkflow('docker-build-release.yml');
    const start = workflow.indexOf('- name: Set release tags');
    const next = workflow.indexOf('\n      - name:', start + 1);
    const step = workflow.slice(start, next === -1 ? undefined : next);

    expect(start).toBeGreaterThan(-1);
    expect(step).toContain('readonly VERSION');
  });

  it('provides a deterministic local workflow verifier', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-workflows.sh', import.meta.url), 'utf8');
    const dockerCheck = verifier.indexOf('if command -v docker');
    const actionlintCheck = verifier.indexOf('elif command -v actionlint');

    expect(verifier).toContain('actionlint');
    expect(verifier).toMatch(/rhysd\/actionlint:1\.7\.7@sha256:[0-9a-f]{64}/u);
    expect(dockerCheck).toBeGreaterThan(-1);
    expect(actionlintCheck).toBeGreaterThan(-1);
    expect(dockerCheck).toBeLessThan(actionlintCheck);
    expect(verifier).toContain('workflow contracts=passed');
    expect(verifier).not.toContain('latest');
  });
});
