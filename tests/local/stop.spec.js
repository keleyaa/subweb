import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const stopScript = new URL('../../scripts/local/stop.sh', import.meta.url).pathname;
const temporaryDirectories = [];
const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('local source stop', () => {
  it('stops in reverse order, removes generated state, and preserves data, builds, and logs', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'subweb-stop-'));
    temporaryDirectories.push(parent);
    const runtime = join(parent, '.runtime/local');
    const runRoot = join(runtime, 'runs/test-run');
    for (const directory of ['pids', 'config', 'redis', 'build', 'logs']) await mkdir(join(runtime, directory), { recursive: true });
    await mkdir(runRoot, { recursive: true });
    for (const directory of ['redis', 'build', 'logs']) await writeFile(join(runtime, directory, 'keep'), 'keep');
    await writeFile(join(runtime, 'config/local.env'), `RUN_ROOT=${runRoot}\n`, { mode: 0o600 });
    await writeFile(join(runtime, 'active-run'), `${runRoot}\n`, { mode: 0o600 });

    for (const service of ['redis', 'myurls', 'subconverter', 'vite', 'nginx']) {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', runRoot], { stdio: 'ignore' });
      children.push(child);
      await once(child, 'spawn');
      await writeFile(join(runtime, `pids/${service}.pid`), `PID=${child.pid}
SERVICE=${service}
RUN_PATH=${runRoot}
STARTED_AT=2026-08-02T00:00:00Z
HEALTH_URL=http://127.0.0.1/healthz
`, { mode: 0o600 });
    }
    const fakePs = join(parent, 'fake-ps');
    await writeFile(fakePs, `#!/bin/sh
case "$*" in
  *command=*) printf '%s\\n' "$PROCESS_TEST_COMMAND" ;;
  *stat=*) printf '%s\\n' S ;;
esac
`);
    await chmod(fakePs, 0o700);

    const environment = {
      ...process.env,
      LOCAL_RUNTIME_ROOT_OVERRIDE: runtime,
      PROCESS_PS_BIN: fakePs,
      PROCESS_TEST_COMMAND: `${runRoot}/service`,
      PROCESS_STOP_TIMEOUT: '0',
    };
    const result = spawnSync('sh', [stopScript], { cwd: root, encoding: 'utf8', env: environment });
    const second = spawnSync('sh', [stopScript], { cwd: root, encoding: 'utf8', env: environment });

    expect(result.status, result.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const output = result.stdout;
    const order = ['nginx=stopped', 'vite=stopped', 'subconverter=stopped', 'myurls=stopped', 'redis=stopped'];
    for (let index = 1; index < order.length; index += 1) {
      expect(output.indexOf(order[index - 1])).toBeLessThan(output.indexOf(order[index]));
    }
    await expect(readFile(join(runtime, 'config/local.env'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(runtime, 'active-run'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const directory of ['redis', 'build', 'logs']) {
      await expect(readFile(join(runtime, directory, 'keep'), 'utf8')).resolves.toBe('keep');
    }
  });
});
