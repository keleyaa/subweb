import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const installerPath = fileURLToPath(new URL('scripts/vps/install.sh', root));
const reconcilerPath = fileURLToPath(new URL('scripts/vps/reconcile-release.sh', root));
const temporaryDirectories = [];

const createTemporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const writeExecutable = async (path, source) => {
  await writeFile(path, source, { mode: 0o755 });
  await chmod(path, 0o755);
};

const runShell = (script, args, environment = {}) => spawnSync('sh', [
  '-c', script,
  'sh',
  ...args,
], {
  encoding: 'utf8',
  env: { ...process.env, ...environment },
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('VPS installer reconciliation safeguards', () => {
  it.each([
    ['equals the deployment target', (fixture) => [join(fixture, 'target'), join(fixture, 'target')]],
    ['is nested inside the deployment target', (fixture) => [join(fixture, 'target', 'release'), join(fixture, 'target')]],
    ['contains the deployment target', (fixture) => [fixture, join(fixture, 'target')]],
  ])('detects when the release source %s', async (_name, createPaths) => {
    const fixture = await createTemporaryDirectory('subweb-vps-overlap-');
    await mkdir(join(fixture, 'target', 'release'), { recursive: true });
    const [source, target] = createPaths(fixture);

    const result = runShell(
      'set -eu; . "$1"; release_trees_overlap "$2" "$3"',
      [reconcilerPath, source, target],
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it('refuses reconciliation when the target contains a nested mount point', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-mount-');
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const bin = join(fixture, 'bin');
    await mkdir(source);
    await mkdir(target);
    await mkdir(bin);
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeExecutable(join(bin, 'findmnt'), `#!/bin/sh
[ "$*" = '-rn -o TARGET' ] || exit 64
printf '%s\\n' "$NESTED_MOUNT"
`);

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcilerPath, source, target],
      {
        PATH: `${bin}:${process.env.PATH}`,
        NESTED_MOUNT: join(target, 'mounted-state'),
      },
    );

    expect(result.status).not.toBe(0);
    expect(await readFile(join(source, 'compose.yaml'), 'utf8')).toBe('new release\n');
  });

  it('pauses active enabled backup timers and resumes them after reconciliation', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-timers-');
    const bin = join(fixture, 'bin');
    const calls = join(fixture, 'calls');
    await mkdir(bin);
    await writeExecutable(join(bin, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'is-enabled --quiet'|'is-active --quiet'|'stop subweb-backup.timer'|'stop subweb-backup.service'|'stop subweb-backup-verify.timer'|'stop subweb-backup-verify.service'|'start subweb-backup.timer'|'start subweb-backup-verify.timer') exit 0 ;;
esac
exit 64
`);

    const result = runShell(
      'set -eu; . "$1"; pause_enabled_release_timers; resume_paused_release_timers',
      [reconcilerPath],
      { PATH: `${bin}:${process.env.PATH}`, CALL_LOG: calls },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(calls, 'utf8')).toBe([
      'is-enabled --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.timer',
      'stop subweb-backup.timer',
      'stop subweb-backup.service',
      'is-enabled --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.timer',
      'stop subweb-backup-verify.timer',
      'stop subweb-backup-verify.service',
      'start subweb-backup.timer',
      'start subweb-backup-verify.timer',
      '',
    ].join('\n'));
  });

  it('installs host configuration from the selected release tree and restores timers on exit', async () => {
    const installer = await readFile(installerPath, 'utf8');

    expect(installer).toContain('"$SOURCE_DIRECTORY/deploy/systemd/subweb.service"');
    expect(installer).toContain('"$SOURCE_DIRECTORY/nginx/snippets/security-headers.conf"');
    expect(installer).toContain('"$SOURCE_DIRECTORY/deploy/logrotate/subweb.conf"');
    expect(installer).toContain("trap 'resume_paused_release_timers >/dev/null 2>&1 || true' 0");
  });
});
