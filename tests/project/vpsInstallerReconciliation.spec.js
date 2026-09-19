import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

const runShell = (script, args, environment = {}) => spawnSync('/bin/sh', [
  '-c', script,
  'sh',
  ...args,
], {
  encoding: 'utf8',
  env: { ...process.env, ...environment },
});

const workTrees = async (directory, targetName) => (await readdir(directory)).filter((entry) =>
  entry.startsWith(`.${targetName}.stage.`)
    || entry.startsWith(`.${targetName}.old.`)
    || entry.startsWith(`.${targetName}.failed.`));

const writeMountInspector = async (bin) => writeExecutable(join(bin, 'findmnt'), `#!/bin/sh
[ "$*" = '-rn -o TARGET' ] || exit 64
printf '/\\n'
`);

const writeTimerSystemctl = async (bin) => writeExecutable(join(bin, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'is-enabled --quiet')
    case "${'${TIMER_STATE:-disabled}'}" in
      disabled|disabled-active) exit 3 ;;
      *) exit 0 ;;
    esac
    ;;
  'is-active --quiet')
    case "${'${TIMER_STATE:-disabled}'}:$3" in
      active:subweb-backup.timer|active:subweb-backup-verify.timer|active:subweb-backup.service|active:subweb-backup-verify.service|disabled-active:subweb-backup.timer|disabled-active:subweb-backup-verify.timer|disabled-active:subweb-backup.service|disabled-active:subweb-backup-verify.service) exit 0 ;;
    esac
    exit 3
    ;;
  'stop subweb-backup.timer'|'stop subweb-backup-verify.timer'|'stop subweb-backup.service'|'stop subweb-backup-verify.service'|'start subweb-backup.timer'|'start subweb-backup-verify.timer'|'start subweb-backup.service'|'start subweb-backup-verify.service') exit 0 ;;
esac
exit 64
`);

const writeReleaseSystemctl = async (bin) => writeExecutable(join(bin, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'is-active --quiet')
    [ "$3" = subweb.service ] || exit 64
    [ "${'${SUBWEB_SERVICE_ACTIVE:-0}'}" = 1 ] && exit 0
    exit 3
    ;;
  'stop subweb.service')
    if [ "${'${SUBWEB_SERVICE_STOP_FAIL_ONCE:-0}'}" = 1 ] && [ ! -e "$SERVICE_STATE_FILE" ]; then
      : > "$SERVICE_STATE_FILE"
      exit 1
    fi
    exit 0
    ;;
  'start subweb.service')
    if [ "${'${SUBWEB_SERVICE_START_FAIL_ONCE:-0}'}" = 1 ] && [ ! -e "$SERVICE_STATE_FILE" ]; then
      : > "$SERVICE_STATE_FILE"
      exit 1
    fi
    exit 0
    ;;
esac
exit 64
`);

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

  it('uses mountinfo to allow a safe target when findmnt is unavailable', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-mountinfo-safe-');
    const bin = join(fixture, 'bin');
    const target = join(fixture, 'target');
    await mkdir(bin);

    const result = runShell(
      'set -eu; . "$1"; RECONCILE_TEST_MOUNTINFO=$2; reconcile_mountinfo_stream() { printf "%s\\n" "$RECONCILE_TEST_MOUNTINFO"; }; if reconcile_target_has_nested_mount "$3"; then exit 1; else exit 0; fi',
      [reconcilerPath, '36 25 0:32 / / rw,relatime - tmpfs tmpfs rw', target],
      { PATH: bin },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it('uses mountinfo to reject a nested target mount when findmnt is unavailable', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-mountinfo-nested-');
    const bin = join(fixture, 'bin');
    const target = join(fixture, 'target');
    await mkdir(bin);

    const result = runShell(
      'set -eu; . "$1"; RECONCILE_TEST_MOUNTINFO=$2; reconcile_mountinfo_stream() { printf "%s\\n" "$RECONCILE_TEST_MOUNTINFO"; }; reconcile_target_has_nested_mount "$3"',
      [reconcilerPath, `36 25 0:32 / ${join(target, 'state')} rw,relatime - tmpfs tmpfs rw`, target],
      { PATH: bin },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it('fails closed when mount information cannot be read', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-mountinfo-unreadable-');
    const bin = join(fixture, 'bin');
    const target = join(fixture, 'target');
    await mkdir(bin);

    const result = runShell(
      'set -eu; . "$1"; reconcile_mountinfo_stream() { return 1; }; reconcile_target_has_nested_mount "$2"',
      [reconcilerPath, target],
      { PATH: bin },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ['disabled', [
      'is-enabled --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.service',
      'is-enabled --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.service',
    ]],
    ['disabled but active', [
      'is-enabled --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.service',
      'stop subweb-backup.timer',
      'stop subweb-backup.service',
      'is-enabled --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.service',
      'stop subweb-backup-verify.timer',
      'stop subweb-backup-verify.service',
      'start subweb-backup.service',
      'start subweb-backup-verify.service',
      'start subweb-backup.timer',
      'start subweb-backup-verify.timer',
    ]],
    ['enabled but inactive', [
      'is-enabled --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.service',
      'stop subweb-backup.timer',
      'is-enabled --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.timer',
       'is-active --quiet subweb-backup-verify.service',
       'stop subweb-backup-verify.timer',
     ]],
    ['enabled and active', [
      'is-enabled --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.timer',
      'is-active --quiet subweb-backup.service',
      'stop subweb-backup.timer',
      'stop subweb-backup.service',
      'is-enabled --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.timer',
      'is-active --quiet subweb-backup-verify.service',
      'stop subweb-backup-verify.timer',
      'stop subweb-backup-verify.service',
      'start subweb-backup.service',
      'start subweb-backup-verify.service',
      'start subweb-backup.timer',
      'start subweb-backup-verify.timer',
    ]],
  ])('restores timers and services to the prior %s state', async (state, expectedCalls) => {
    const fixture = await createTemporaryDirectory('subweb-vps-timers-');
    const bin = join(fixture, 'bin');
    const calls = join(fixture, 'calls');
    await mkdir(bin);
    await writeTimerSystemctl(bin);

    const result = runShell(
      'set -eu; . "$1"; pause_enabled_release_timers; resume_paused_release_timers',
      [reconcilerPath],
      {
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: calls,
        TIMER_STATE: state === 'disabled'
          ? 'disabled'
          : state === 'disabled but active'
            ? 'disabled-active'
            : state === 'enabled but inactive'
              ? 'inactive'
              : 'active',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(calls, 'utf8')).toBe(`${expectedCalls.join('\n')}\n`);
  });

  it('keeps the live tree intact when a staged copy fails', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-staging-failure-');
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const bin = join(fixture, 'bin');
    await mkdir(source);
    await mkdir(target);
    await mkdir(bin);
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeFile(join(source, 'fail-during-copy'), 'copy me last\n');
    await writeFile(join(target, 'compose.yaml'), 'old release\n');
    await writeFile(join(target, 'stale.txt'), 'preserve on failure\n');
    await writeMountInspector(bin);
    await writeExecutable(join(bin, 'cp'), `#!/bin/sh
case "$*" in
  *fail-during-copy*) exit 1 ;;
esac
exec /bin/cp "$@"
`);

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcilerPath, source, target],
      { PATH: `${bin}:${process.env.PATH}` },
    );

    expect(result.status).not.toBe(0);
    expect(await readFile(join(target, 'compose.yaml'), 'utf8')).toBe('old release\n');
    expect(await readFile(join(target, 'stale.txt'), 'utf8')).toBe('preserve on failure\n');
    expect(await workTrees(fixture, 'target')).toEqual([]);
  });

  it('restores an active service when stopping it for cutover fails', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-stop-rollback-');
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const bin = join(fixture, 'bin');
    const calls = join(fixture, 'calls');
    const serviceState = join(fixture, 'service-state');
    await mkdir(source);
    await mkdir(target);
    await mkdir(bin);
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeFile(join(target, 'compose.yaml'), 'old release\n');
    await writeMountInspector(bin);
    await writeReleaseSystemctl(bin);

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcilerPath, source, target],
      {
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: calls,
        SERVICE_STATE_FILE: serviceState,
        SUBWEB_SERVICE_ACTIVE: '1',
        SUBWEB_SERVICE_STOP_FAIL_ONCE: '1',
      },
    );

    expect(result.status).not.toBe(0);
    expect(await readFile(join(target, 'compose.yaml'), 'utf8')).toBe('old release\n');
    expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual([
      'is-active --quiet subweb.service',
      'stop subweb.service',
      'start subweb.service',
    ]);
    expect(await workTrees(fixture, 'target')).toEqual([]);
  });

  it('cuts over a staged release while preserving safe runtime state', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-cutover-');
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const bin = join(fixture, 'bin');
    const calls = join(fixture, 'calls');
    const serviceState = join(fixture, 'service-state');
    await mkdir(join(source, 'scripts'), { recursive: true });
    await mkdir(join(target, '.runtime'), { recursive: true });
    await mkdir(join(target, '.local'), { recursive: true });
    await mkdir(bin);
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeFile(join(source, 'scripts', 'current.sh'), 'current\n');
    await writeFile(join(source, '.env'), 'APP_DOMAIN=source.example\n');
    await writeFile(join(target, 'compose.yaml'), 'old release\n');
    await writeFile(join(target, 'stale.txt'), 'remove me\n');
    await writeFile(join(target, '.env'), 'APP_DOMAIN=kept.example\n');
    await writeFile(join(target, '.runtime', 'state'), 'runtime state\n');
    await writeFile(join(target, '.local', 'state'), 'local state\n');
    await writeMountInspector(bin);
    await writeReleaseSystemctl(bin);

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcilerPath, source, target],
      {
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: calls,
        SERVICE_STATE_FILE: serviceState,
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(target, 'compose.yaml'), 'utf8')).toBe('new release\n');
    expect(await readFile(join(target, 'scripts', 'current.sh'), 'utf8')).toBe('current\n');
    await expect(readFile(join(target, 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(target, '.env'), 'utf8')).toBe('APP_DOMAIN=kept.example\n');
    expect(await readFile(join(target, '.runtime', 'state'), 'utf8')).toBe('runtime state\n');
    expect(await readFile(join(target, '.local', 'state'), 'utf8')).toBe('local state\n');
    expect(await readFile(calls, 'utf8')).toBe('is-active --quiet subweb.service\n');
    expect(await workTrees(fixture, 'target')).toEqual([]);
  });

  it('atomically restores the old tree and active service when the new release cannot start', async () => {
    const fixture = await createTemporaryDirectory('subweb-vps-cutover-rollback-');
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const bin = join(fixture, 'bin');
    const calls = join(fixture, 'calls');
    const serviceState = join(fixture, 'service-state');
    await mkdir(source);
    await mkdir(target);
    await mkdir(bin);
    await writeFile(join(source, 'compose.yaml'), 'new release\n');
    await writeFile(join(target, 'compose.yaml'), 'old release\n');
    await writeMountInspector(bin);
    await writeReleaseSystemctl(bin);

    const result = runShell(
      'set -eu; . "$1"; reconcile_release_tree "$2" "$3"',
      [reconcilerPath, source, target],
      {
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: calls,
        SERVICE_STATE_FILE: serviceState,
        SUBWEB_SERVICE_ACTIVE: '1',
        SUBWEB_SERVICE_START_FAIL_ONCE: '1',
      },
    );

    expect(result.status).not.toBe(0);
    expect(await readFile(join(target, 'compose.yaml'), 'utf8')).toBe('old release\n');
    expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual([
      'is-active --quiet subweb.service',
      'stop subweb.service',
      'start subweb.service',
      'stop subweb.service',
      'start subweb.service',
    ]);
    expect(await workTrees(fixture, 'target')).toEqual([]);
  });

  it('installs host configuration from the selected release tree and restores cleanup state on exit', async () => {
    const installer = await readFile(installerPath, 'utf8');

    expect(installer).toContain('"$SOURCE_DIRECTORY/deploy/systemd/subweb.service"');
    expect(installer).toContain('"$SOURCE_DIRECTORY/nginx/snippets/security-headers.conf"');
    expect(installer).toContain('"$SOURCE_DIRECTORY/deploy/logrotate/subweb.conf"');
    expect(installer).toContain('reconcile_release_abort >/dev/null 2>&1 || true');
    expect(installer).toContain('resume_paused_release_timers >/dev/null 2>&1 || true');
  });
});
