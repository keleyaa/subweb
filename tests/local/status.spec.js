import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const statusScript = new URL('../../scripts/local/status.sh', import.meta.url).pathname;
const temporaryDirectories = [];
const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const parent = await mkdtemp(join(tmpdir(), 'subweb-status-'));
  temporaryDirectories.push(parent);
  const runtime = join(parent, '.runtime/local');
  const runRoot = join(runtime, 'runs/test-run');
  await mkdir(join(runtime, 'pids'), { recursive: true });
  await mkdir(join(runtime, 'config'), { recursive: true });
  await mkdir(runRoot, { recursive: true });
  await writeFile(join(runtime, 'secrets.env'), `MYURLS_API_TOKEN=${'a'.repeat(64)}\nREDIS_PASSWORD=${'b'.repeat(64)}\n`, { mode: 0o600 });
  await writeFile(join(runtime, 'config/local.env'), `RUN_ROOT=${runRoot}
LOCAL_VITE_PORT=5173
LOCAL_SUBCONVERTER_PORT=25500
LOCAL_MYURLS_PORT=18082
LOCAL_REDIS_PORT=16379
LOCAL_APP_PORT=18080
LOCAL_API_PORT=18081
LOCAL_SHORT_PORT=18083
`, { mode: 0o600 });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', runRoot], { stdio: 'ignore' });
  children.push(child);
  await once(child, 'spawn');
  for (const service of ['redis', 'myurls', 'subconverter', 'vite', 'nginx']) {
    await writeFile(join(runtime, `pids/${service}.pid`), `PID=${child.pid}
SERVICE=${service}
RUN_PATH=${runRoot}
STARTED_AT=2026-08-02T00:00:00Z
HEALTH_URL=http://127.0.0.1/healthz
PROCESS_START=Fri Aug 1 21:00:00 2026
`, { mode: 0o600 });
  }
  const bin = join(parent, 'bin');
  await mkdir(bin);
  const fakePs = join(bin, 'ps');
  await writeFile(fakePs, `#!/bin/sh
case "$*" in
  *command=*) printf '%s\\n' "$PROCESS_TEST_COMMAND" ;;
  *lstart=*) printf '%s\\n' 'Fri Aug 1 21:00:00 2026' ;;
  *stat=*) printf '%s\\n' S ;;
esac
`);
  const fakeCurl = join(bin, 'curl');
  await writeFile(fakeCurl, '#!/bin/sh\n[ "${LOCAL_TEST_HTTP_FAIL:-0}" = 0 ]\n');
  const fakeRedis = join(bin, 'redis-cli');
  await writeFile(fakeRedis, '#!/bin/sh\necho PONG\n');
  await Promise.all([fakePs, fakeCurl, fakeRedis].map((path) => chmod(path, 0o700)));
  return { runtime, runRoot, bin };
};

describe('local source status', () => {
  it('requires all five owned processes and seven health probes', async () => {
    const { runtime, runRoot, bin } = await fixture();
    const result = spawnSync('sh', [statusScript], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOCAL_RUNTIME_ROOT_OVERRIDE: runtime,
        PROCESS_PS_BIN: join(bin, 'ps'),
        PROCESS_TEST_COMMAND: `${runRoot}/service`,
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    for (const service of ['redis', 'myurls', 'subconverter', 'vite', 'nginx', 'nginx-api', 'nginx-short']) {
      expect(result.stdout).toContain(`${service}=healthy`);
    }
    expect(result.stdout).not.toContain('a'.repeat(64));
    expect(result.stdout).not.toContain('b'.repeat(64));
  });

  it('returns nonzero when a process is owned but an HTTP health probe fails', async () => {
    const { runtime, runRoot, bin } = await fixture();
    const result = spawnSync('sh', [statusScript], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOCAL_RUNTIME_ROOT_OVERRIDE: runtime,
        PROCESS_PS_BIN: join(bin, 'ps'),
        PROCESS_TEST_COMMAND: `${runRoot}/service`,
        LOCAL_TEST_HTTP_FAIL: '1',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('myurls=unhealthy');
    expect(result.stdout).toContain('vite=unhealthy');
  });
});
