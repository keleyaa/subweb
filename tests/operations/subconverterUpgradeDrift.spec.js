import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];
const imageDigest = 'sha256:5986d0db938d85482185e51b55be3a0326e56c1ba3e3f8326895e89f31804475';
const image = `ghcr.io/aethersailor/subconverter-extended:v1.9.4@${imageDigest}`;
const imageTemplateDigest = 'a'.repeat(64);
const driftingVolumeDigest = 'c'.repeat(64);

const makeFixture = async ({ volumeDigest }) => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-subconverter-upgrade-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, '.env'), 'SHORT_LINKS_ENABLED=true\n', { mode: 0o600 });
  await writeFile(join(root, 'scripts/subweb.sh'), await readFile(new URL('scripts/subweb.sh', repositoryRoot), 'utf8'));
  await chmod(join(root, 'scripts/subweb.sh'), 0o755);
  await writeFile(
    join(root, 'scripts/verify-subconverter-runtime.sh'),
    await readFile(new URL('scripts/verify-subconverter-runtime.sh', repositoryRoot), 'utf8'),
  );
  await chmod(join(root, 'scripts/verify-subconverter-runtime.sh'), 0o755);
  await writeFile(join(root, 'scripts/validate-compose.sh'), '#!/bin/sh\nprintf "validate\\n" >> "$DOCKER_LOG"\n');
  await chmod(join(root, 'scripts/validate-compose.sh'), 0o755);

  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'docker'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose version') exit 0 ;;
  'compose -f compose.yaml pull gateway subconverter myurls redis') exit 0 ;;
  'compose -f compose.yaml up -d --no-build --pull never --remove-orphans --wait') exit 0 ;;
  'compose config --format json') printf '{"services":{"subconverter":{"image":"${image}"}}}\\n' ;;
  'compose ps -q subconverter') printf 'container-id\\n' ;;
  'run --rm --entrypoint sh'*) printf '%s\\n' '${imageTemplateDigest}' ;;
  'compose exec -T subconverter sh -eu -c'*) printf '%s\\n' '${volumeDigest}' ;;
  *) exit 64 ;;
esac
`);
  await chmod(join(bin, 'docker'), 0o755);
  return root;
};

const runUpgrade = (root) => {
  const env = {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    DOCKER_LOG: join(root, 'docker.log'),
  };
  delete env.SUBWEB_IMAGE;
  return spawnSync('sh', [join(root, 'scripts/subweb.sh'), 'upgrade'], { cwd: root, encoding: 'utf8', env });
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SubConverter upgrade runtime volume gate', () => {
  it('pulls, starts, and then verifies the runtime volume against the resolved image', async () => {
    const root = await makeFixture({ volumeDigest: imageTemplateDigest });

    const result = runUpgrade(root);

    expect(result.status, result.stderr).toBe(0);
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).toContain('compose -f compose.yaml pull gateway subconverter myurls redis\n');
    expect(log).toContain('compose -f compose.yaml up -d --no-build --pull never --remove-orphans --wait\n');
    expect(log).toContain('compose config --format json\n');
    expect(log).toContain('compose ps -q subconverter\n');
    expect(log).toContain('compose exec -T subconverter sh -eu -c');
  });

  it('fails the upgrade with remediation when the volume keeps the previous image content', async () => {
    const root = await makeFixture({ volumeDigest: driftingVolumeDigest });

    const result = runUpgrade(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SubConverter upgrade is incomplete');
    expect(result.stderr).toContain('docker volume rm subweb_subconverter-runtime');
    expect(result.stderr).toContain('./scripts/subweb.sh up');
    // The check must not modify the volume or stop the stack on its own.
    const log = await readFile(join(root, 'docker.log'), 'utf8');
    expect(log).not.toContain('compose -f compose.yaml down');
    expect(log).not.toContain('volume rm');
  });
});
