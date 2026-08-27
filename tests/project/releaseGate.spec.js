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
      'stage quality npm run verify',
      'stage browser npm run test:e2e',
      'stage locks npm run verify:locks',
      'stage production-readiness node scripts/verify-production-readiness.mjs',
      'stage compose npm run verify:compose',
      'stage documentation npm run verify:docs',
      'stage container ./scripts/verify-container.sh subweb:release-check',
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

  it('accepts production readiness when the locked MyUrls artifact has a stable source tag', () => {
    const script = path.join(root, 'scripts/verify-production-readiness.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('tag gate passed');
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
