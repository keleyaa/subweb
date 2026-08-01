import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const bootstrap = new URL('../../scripts/local/bootstrap.sh', import.meta.url).pathname;
const sources = new URL('../../scripts/local/lib/sources.sh', import.meta.url).pathname;
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const temporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-bootstrap-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

const fakeGit = async (directory) => {
  const git = join(directory, 'git');
  await writeFile(git, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case "$*" in
  *' remote get-url origin') printf '%s\\n' "$FAKE_GIT_REMOTE" ;;
  *' rev-parse HEAD') printf '%s\\n' "$FAKE_GIT_HEAD" ;;
  'clone --no-checkout '*)
    destination=
    for argument do destination=$argument; done
    mkdir -p "$destination/.git"
    ;;
esac
`);
  await chmod(git, 0o700);
  return git;
};

describe('pinned local source resolution', () => {
  it('validates an existing checkout without mutating it', async () => {
    const directory = await temporaryDirectory();
    const checkout = join(directory, 'MyUrls');
    await mkdir(join(checkout, '.git'), { recursive: true });
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await fakeGit(bin);
    const log = join(directory, 'git.log');
    const commit = '68527398a2b4019f7ee5a176eb8645f68055d0ae';

    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; ensure_pinned_source myurls "$2" "$3" "$4" "$5"', 'sh', sources, 'https://github.com/keleyaa/MyUrls.git', commit, checkout, join(directory, 'cache')],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_GIT_LOG: log,
          FAKE_GIT_REMOTE: 'https://github.com/keleyaa/MyUrls.git',
          FAKE_GIT_HEAD: commit,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(checkout);
    const calls = await readFile(log, 'utf8');
    expect(calls).toContain('remote get-url origin');
    expect(calls).toContain('rev-parse HEAD');
    expect(calls).not.toMatch(/\b(?:clone|checkout|pull|reset)\b/);
  });

  it('clones a missing cache once and uses a detached locked commit', async () => {
    const directory = await temporaryDirectory();
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await fakeGit(bin);
    const log = join(directory, 'git.log');
    const cache = join(directory, 'cache');
    const commit = '4db6a63f078f27da2cfb6cc90d47eb2dbd80c1cd';
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GIT_LOG: log,
      FAKE_GIT_REMOTE: 'https://github.com/Aethersailor/SubConverter-Extended.git',
      FAKE_GIT_HEAD: commit,
    };
    const args = ['-c', '. "$1"; ensure_pinned_source subconverter "$2" "$3" "" "$4"', 'sh', sources, environment.FAKE_GIT_REMOTE, commit, cache];

    const first = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env: environment });
    const second = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env: environment });

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const calls = await readFile(log, 'utf8');
    expect(calls.match(/^clone --no-checkout /gm)).toHaveLength(1);
    expect(calls).toContain(`checkout --detach ${commit}`);
    expect(calls).not.toMatch(/\b(?:pull|reset)\b/);
  });
});

describe('local source bootstrap contract', () => {
  it('reports all missing dependencies without attempting installation', async () => {
    const directory = await temporaryDirectory();
    const bin = join(directory, 'bin');
    await mkdir(bin);
    const uname = join(bin, 'uname');
    await writeFile(uname, "#!/bin/sh\nprintf '%s\\n' Linux\n");
    await chmod(uname, 0o700);

    const result = spawnSync('/bin/sh', [bootstrap], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    });

    expect(result.status).not.toBe(0);
    for (const tool of ['node', 'npm', 'go', 'cmake', 'pkg-config', 'redis-server', 'redis-cli', 'nginx', 'git', 'curl', 'lsof', 'tar', 'bash', 'file']) {
      expect(result.stderr).toContain(tool);
    }
    expect(result.stderr).toContain('手动安装');
  });

  it('pins build outputs, preserves secrets, and avoids package reinstall when the lock is unchanged', async () => {
    const source = await readFile(bootstrap, 'utf8');

    expect(source).toContain('deploy/versions.lock.json');
    expect(source).toContain('go build -trimpath -o');
    expect(source).toContain('cmake -S');
    expect(source).toContain('cmake --build');
    expect(source).toContain('scripts/ci/dependencies.lock.json');
    expect(source).toContain('quickjspp');
    expect(source).toContain('libcron');
    expect(source).toContain('git -C "$subconverter_source" archive');
    expect(source).toContain('bridge/build.sh');
    expect(source).toContain('subconverter_work_source');
    expect(source).toContain('-DCMAKE_PREFIX_PATH="$subconverter_dependency_prefix"');
    expect(source).toContain('runtime_root/bin/subconverter');
    expect(source).toContain('SUBCONVERTER_BINARY=');
    expect(source).toContain('secrets_file=$runtime_root/secrets.env');
    expect(source).toContain('load_existing_secret');
    expect(source).toContain('package-lock.sha256');
    expect(source).not.toMatch(/^\s*(?:brew|apt(?:-get)?|sudo)\s/m);
  });
});
