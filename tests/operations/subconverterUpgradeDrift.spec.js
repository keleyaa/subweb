import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];
const imageDigest = 'sha256:8e067383d26d6f3580e9255e13f11a83fd3500e9a3380eb69ae99af54c29f423';
const image = `ghcr.io/aethersailor/subconverter-extended:v1.9.4@${imageDigest}`;
const imageTemplateDigest = 'a'.repeat(64);
const driftingVolumeDigest = 'c'.repeat(64);

const normalizeComposeSnapshot = (log) => log.replace(
  /--env-file \S*subweb-env\.[^ ]+/gu,
  '--env-file <private-snapshot>',
);

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
if [ "$1" = compose ] && [ "$2" = version ]; then exit 0; fi
if [ "$1" = run ]; then
  printf '%s\\n' '${imageTemplateDigest}'
  exit 0
fi
[ "$1" = compose ] || exit 64
shift
[ "$1" = --env-file ] || exit 64
shift 2
compose_file=common
if [ "$1" = -f ]; then
  compose_file=$2
  shift 2
fi
case "$compose_file:$*" in
  'compose.yaml:pull gateway subconverter myurls redis') exit 0 ;;
  'compose.yaml:up -d --no-build --pull never --remove-orphans --wait') exit 0 ;;
  'common:config --format json') printf '{"services":{"subconverter":{"image":"${image}"}}}\\n' ;;
  'common:ps -q subconverter') printf 'container-id\\n' ;;
  'common:exec -T subconverter sh -eu -c'*) printf '%s\\n' '${volumeDigest}' ;;
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
    const log = normalizeComposeSnapshot(await readFile(join(root, 'docker.log'), 'utf8'));
    expect(log).toContain('compose --env-file <private-snapshot> -f compose.yaml pull gateway subconverter myurls redis\n');
    expect(log).toContain('compose --env-file <private-snapshot> -f compose.yaml up -d --no-build --pull never --remove-orphans --wait\n');
    expect(log).toContain('compose --env-file <private-snapshot> config --format json\n');
    expect(log).toContain('compose --env-file <private-snapshot> ps -q subconverter\n');
    expect(log).toContain('compose --env-file <private-snapshot> exec -T subconverter sh -eu -c');
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
