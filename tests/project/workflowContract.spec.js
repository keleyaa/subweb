import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readWorkflow = (name) => readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');

const pinnedActions = (workflow) =>
  [...workflow.matchAll(/^\s+uses:\s+([^\s]+)@([^\s]+)$/gmu)].map(([, action, ref]) => ({ action, ref }));

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

  it('provides a deterministic local workflow verifier', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-workflows.sh', import.meta.url), 'utf8');

    expect(verifier).toContain('actionlint');
    expect(verifier).toContain('workflow contracts=passed');
    expect(verifier).not.toContain('latest');
  });
});
