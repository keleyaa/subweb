import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const temporaryDirectories = [];
const releaseVersion = 'v1.2.3';
const releaseDigest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const resolvedImage = `ghcr.io/keleyaa/subweb@sha256:${releaseDigest}`;
const interactiveInstallTimeoutMs = 30_000;

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-interactive-install-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'bin'), { recursive: true });
  await cp(new URL('scripts/subweb.sh', repositoryRoot), join(root, 'scripts/subweb.sh'));
  await cp(new URL('scripts/lib/config.sh', repositoryRoot), join(root, 'scripts/lib/config.sh'));
  await cp(new URL('scripts/lib/release-image.sh', repositoryRoot), join(root, 'scripts/lib/release-image.sh'));
  await cp(new URL('scripts/install-wizard.sh', repositoryRoot), join(root, 'scripts/install-wizard.sh'));
  await chmod(join(root, 'scripts/subweb.sh'), 0o755);
  await chmod(join(root, 'scripts/install-wizard.sh'), 0o755);

  await writeFile(join(root, 'scripts/docker-deploy.sh'), `#!/bin/sh
set -eu
printf '<%s>\\n' "$@" > "$DEPLOY_ARGS_LOG"
if [ -t 0 ]; then
  printf '<tty>\\n' > "$DEPLOY_STDIN_LOG"
else
  cat > "$DEPLOY_STDIN_LOG"
fi
`);
  await chmod(join(root, 'scripts/docker-deploy.sh'), 0o755);

  await writeFile(join(root, 'bin/docker'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'buildx version') exit 0 ;;
  'buildx imagetools inspect ghcr.io/keleyaa/subweb:${releaseVersion} --format {{.Manifest.Digest}}')
    inspect_stdin=$(cat)
    printf 'INSPECT_STDIN=%s\\n' "\${inspect_stdin:-<none>}" >> "$DOCKER_LOG"
    [ "\${DOCKER_RESOLVE_STATUS:-0}" -eq 0 ] || exit "\${DOCKER_RESOLVE_STATUS}"
    printf 'sha256:${releaseDigest}'
    ;;
  *) exit 64 ;;
esac
`);
  await chmod(join(root, 'bin/docker'), 0o755);

  const gh = join(root, 'bin/gh');
  await writeFile(gh, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$GH_LOG"
case "$*" in
  'attestation verify '*)
    printf '%s\\trefs/tags/%s\\tsha256:%s' '${releaseVersion}' '${releaseVersion}' '${releaseDigest}'
    ;;
  *) exit 64 ;;
esac
`);
  await chmod(gh, 0o755);
  return root;
};

const runScript = (root, script, args, input, environment = {}) => spawnSync(
  'sh',
  [join(root, 'scripts', script), ...args],
  {
    cwd: root,
    encoding: 'utf8',
    input,
    env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        DOCKER_LOG: join(root, 'docker.log'),
        GH_LOG: join(root, 'gh.log'),
        DEPLOY_ARGS_LOG: join(root, 'deploy-args.log'),
      DEPLOY_STDIN_LOG: join(root, 'deploy-stdin.log'),
      ...environment,
    },
  },
);

const runWizard = (root, input, environment = {}) => runScript(
  root,
  'install-wizard.sh',
  [],
  input,
  environment,
);

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const runInteractiveInstall = async (root, input, environment = {}) => {
  const scriptPath = join(root, 'scripts', 'subweb.sh');
  const inputPath = join(root, 'interactive-input');
  await writeFile(inputPath, input);
  const inputFd = openSync(inputPath, 'r');
  const command = 'IFS= read -r discarded || :; exec "$1" install';
  const args = process.platform === 'linux'
    ? ['-e', '-q', '-c', `IFS= read -r discarded || :; exec ${shellQuote(scriptPath)} install`, '/dev/null']
    : ['-q', '/dev/null', 'sh', '-c', command, 'sh', scriptPath];

  try {
    return spawnSync('script', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: [inputFd, 'pipe', 'pipe'],
      timeout: interactiveInstallTimeoutMs,
      killSignal: 'SIGTERM',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        DOCKER_LOG: join(root, 'docker.log'),
        GH_LOG: join(root, 'gh.log'),
        DEPLOY_ARGS_LOG: join(root, 'deploy-args.log'),
        DEPLOY_STDIN_LOG: join(root, 'deploy-stdin.log'),
        ...environment,
      },
    });
  } finally {
    closeSync(inputFd);
  }
};

const readOptional = async (path) => readFile(path, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});

const readArgs = async (root) => (await readOptional(join(root, 'deploy-args.log')))
  .trimEnd()
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(1, -1));

const readDeployStdin = async (root) => readOptional(join(root, 'deploy-stdin.log'));

const disabledInput = (confirmation = 'yes', gatewayVersion = releaseVersion) => [
  'app.example.com',
  'api.example.com',
  'false',
  '',
  gatewayVersion,
  confirmation,
  '',
].join('\n');

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('interactive deployment install', () => {
  it('rejects parameterless non-TTY dispatcher invocation without deployment', async () => {
    const root = await makeFixture();

    const result = runScript(root, 'subweb.sh', ['install'], '');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('interactive terminal');
    expect(result.stderr).toContain('arguments are required for automation');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
  });

  it('dispatches a parameterless install through the wizard in a PTY', async () => {
    const root = await makeFixture();

    const result = await runInteractiveInstall(root, disabledInput());
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('Deployment summary');
    expect(output).toContain('Continue with this deployment (yes/no):');
    expect(output).not.toContain('interactive install requires an interactive terminal');
    expect(await readArgs(root)).toEqual([
      '--app-domain', 'app.example.com',
      '--api-domain', 'api.example.com',
      '--short-links-enabled', 'false',
      '--image', resolvedImage,
    ]);
  }, 35_000);

  it('returns a failure from a parameterless PTY install when release resolution fails', async () => {
    const root = await makeFixture();

    const result = await runInteractiveInstall(root, disabledInput(), { DOCKER_RESOLVE_STATUS: '23' });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).not.toBe(0);
    expect(output).toContain(`Unable to resolve release image: ghcr.io/keleyaa/subweb:${releaseVersion}`);
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
    expect(await readOptional(join(root, '.env'))).toBe('');
  }, 35_000);

  it('forwards a confirmed enabled profile and its secret through the public installer', async () => {
    const root = await makeFixture();
    const secret = 'test-turnstile-secret-key';
    const input = [
      'app.example.com',
      'api.example.com',
      'maybe',
      'true',
      'short.example.com',
      'site-key-not-secret',
      '10.0.0.0/8',
      releaseVersion,
      'yes',
      secret,
      '',
    ].join('\n');

    const result = await runInteractiveInstall(root, input);
    const output = `${result.stdout}\n${result.stderr}`;
    const deploymentOutput = output.slice(output.indexOf('Deployment summary'));

    expect(result.status, output).toBe(0);
    const args = await readArgs(root);
    const deployLog = await readFile(join(root, 'deploy-args.log'), 'utf8');
    expect(args).toEqual([
      '--app-domain', 'app.example.com',
      '--api-domain', 'api.example.com',
      '--short-links-enabled', 'true',
      '--short-domain', 'short.example.com',
      '--turnstile-site-key', 'site-key-not-secret',
      '--turnstile-secret-key-stdin',
      '--trusted-proxy-cidr', '10.0.0.0/8',
      '--image', resolvedImage,
    ]);
    expect(await readDeployStdin(root)).toBe(`${secret}\n`);
    expect(deploymentOutput).not.toContain(secret);
    expect(deployLog).not.toContain(secret);
    expect(output).toContain('Invalid value: expected true or false.');
    expect(deploymentOutput).toContain('Deployment summary');
    expect(deploymentOutput).toContain('  APP domain: app.example.com');
    expect(deploymentOutput).toContain('  API domain: api.example.com');
    expect(deploymentOutput).toContain('  SHORT domain: short.example.com');
    expect(deploymentOutput).toContain('  Profile: true');
    expect(deploymentOutput).toContain('  Trusted proxy CIDR: 10.0.0.0/8');
    expect(deploymentOutput).toContain(`  Gateway version: ${releaseVersion}`);
    expect(deploymentOutput).toContain(`  Immutable image: ${resolvedImage}`);
    expect(deploymentOutput).toContain('Continue with this deployment (yes/no): ');
    expect(deploymentOutput).not.toContain('TURNSTILE_SECRET_KEY');
    expect(deploymentOutput).not.toContain('secret key');
    expect(deploymentOutput).not.toContain('site-key-not-secret');
    expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain('INSPECT_STDIN=<none>');
    expect(await readFile(join(root, 'docker.log'), 'utf8')).not.toContain(secret);
    expect(await readOptional(join(root, '.env'))).toBe('');
  });

  it('omits short-link arguments for a confirmed disabled profile', async () => {
    const root = await makeFixture();

    const result = runWizard(root, disabledInput());

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readArgs(root)).toEqual([
      '--app-domain', 'app.example.com',
      '--api-domain', 'api.example.com',
      '--short-links-enabled', 'false',
      '--image', resolvedImage,
    ]);
    expect(result.stderr).not.toContain('TURNSTILE');
    expect(result.stderr).not.toContain('SHORT domain:');
    expect(result.stderr).toContain('  Profile: false');
    expect(result.stderr).toContain('  Trusted proxy CIDR: none');
    expect(await readOptional(join(root, '.env'))).toBe('');
  });

  it.each([
    ['an invalid APP domain', [
      'https://app.example.com',
      'api.example.com',
    ], 'APP domain must be a plain hostname.'],
    ['a duplicate API domain', [
      'app.example.com',
      'app.example.com',
    ], 'APP and API domains must be different.'],
    ['an invalid trusted-proxy CIDR', [
      'app.example.com',
      'api.example.com',
      'true',
      'short.example.com',
      'site-key-not-secret',
      '10.0.0.1/8',
    ], 'TRUSTED_PROXY_CIDR must be a canonical IPv4 CIDR.'],
  ])('stops before confirmation, secret handling, or deployment for %s', async (_scenario, lines, errorMessage) => {
    const root = await makeFixture();

    const result = runWizard(root, [...lines, 'test-turnstile-secret-key'].join('\n'));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(errorMessage);
    expect(result.stderr).not.toContain('Continue with this deployment (yes/no):');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
    expect(await readOptional(join(root, '.env'))).toBe('');
  });

  it('does not deploy after a non-yes confirmation', async () => {
    const root = await makeFixture();

    const result = runWizard(root, disabledInput('no'));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Deployment cancelled.');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
    expect(await readOptional(join(root, '.env'))).toBe('');
  });

  it('stops on release resolution failure before confirmation or deployment', async () => {
    const root = await makeFixture();

    const result = runWizard(root, disabledInput('yes'), { DOCKER_RESOLVE_STATUS: '23' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve release image: ghcr.io/keleyaa/subweb:${releaseVersion}`);
    expect(result.stderr).not.toContain('Continue with this deployment');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
    expect(await readOptional(join(root, '.env'))).toBe('');
  });

  it('stops before confirmation or Docker resolution for an invalid nonempty release version', async () => {
    const root = await makeFixture();

    const result = runWizard(root, disabledInput('yes', '1.2.3'));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid release version (expected v<major>.<minor>.<patch>)');
    expect(result.stderr).not.toContain('Continue with this deployment (yes/no):');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
    expect(await readOptional(join(root, '.env'))).toBe('');
    expect(await readOptional(join(root, 'docker.log'))).toBe('');
  });

  it('rejects a non-default deployment env file before dispatching the deployer', async () => {
    const root = await makeFixture();
    const args = [
      '--app-domain', 'app.example.com',
      '--api-domain', 'api.example.com',
      '--short-links-enabled', 'false',
      '--image', 'ghcr.io/example/subweb@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ];

    const result = runScript(root, 'subweb.sh', ['install', ...args], '', {
      SUBWEB_ENV_FILE: 'custom.env',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('install requires the repository .env');
    expect(await readOptional(join(root, 'deploy-args.log'))).toBe('');
  });

  it('passes parameterized install arguments transparently to the deployer', async () => {
    const root = await makeFixture();
    const args = [
      '--app-domain', 'app.example.com',
      '--api-domain', 'api.example.com',
      '--short-links-enabled', 'false',
      '--image', 'ghcr.io/example/subweb@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ];

    const result = runScript(root, 'subweb.sh', ['install', ...args], 'unexpected-wizard-input\n');

    expect(result.status, result.stderr).toBe(0);
    expect(await readArgs(root)).toEqual(args);
    expect(await readOptional(join(root, 'docker.log'))).toBe('');
  });
});
