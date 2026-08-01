import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const processLibrary = new URL('../../scripts/local/lib/processes.sh', import.meta.url).pathname;
const temporaryDirectories = [];
const children = [];

const processExists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (processExists(child.pid)) child.kill('SIGKILL');
  }
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const makeRecord = async (contents) => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-process-record-'));
  temporaryDirectories.push(directory);
  const record = join(directory, 'service.pid');
  await writeFile(record, contents, { mode: 0o600 });
  return record;
};

const makeFakePs = async (directory) => {
  const fakePs = join(directory, 'fake-ps');
  await writeFile(fakePs, `#!/bin/sh
case "$*" in
  *command=*) printf '%s\\n' "$PROCESS_TEST_COMMAND" ;;
  *stat=*) printf '%s\\n' S ;;
  *) exit 1 ;;
esac
`);
  await chmod(fakePs, 0o700);
  return fakePs;
};

describe('local source process ownership', () => {
  it('deletes a stale forged record without signaling an unrelated process', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'spawn');
    const record = await makeRecord([
      `PID=${child.pid}`,
      'SERVICE=redis',
      'RUN_PATH=/tmp/project/.runtime/local/run-forged',
      'STARTED_AT=2026-08-02T00:00:00Z',
      'HEALTH_URL=redis://127.0.0.1:16379',
      '',
    ].join('\n'));
    const fakePs = await makeFakePs(record.slice(0, record.lastIndexOf('/')));

    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; stop_owned_process "$2"', 'sh', processLibrary, record],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROCESS_PS_BIN: fakePs,
          PROCESS_TEST_COMMAND: 'sleep 30',
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('stale');
    expect(processExists(child.pid)).toBe(true);
    await expect(readFile(record)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('terminates only a process whose command contains the recorded runtime feature', async () => {
    const feature = join(root, '.runtime/local/run-owned-test');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', feature], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'spawn');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const record = await makeRecord([
      `PID=${child.pid}`,
      'SERVICE=myurls',
      `RUN_PATH=${feature}`,
      'STARTED_AT=2026-08-02T00:00:00Z',
      'HEALTH_URL=http://127.0.0.1:18082/healthz',
      '',
    ].join('\n'));
    const fakePs = await makeFakePs(record.slice(0, record.lastIndexOf('/')));

    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; PROCESS_STOP_TIMEOUT=2 stop_owned_process "$2"', 'sh', processLibrary, record],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROCESS_PS_BIN: fakePs,
          PROCESS_TEST_COMMAND: `${process.execPath} -e setInterval ${feature}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('owned process did not exit')), 2000)),
    ]);
    expect(processExists(child.pid)).toBe(false);
    await expect(readFile(record)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
