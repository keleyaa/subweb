import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const releaseImageLibrary = new URL('scripts/lib/release-image.sh', repositoryRoot);
const temporaryDirectories = [];
const validVersion = 'v1.2.3';
const validDigest = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const otherDigest = 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const validSourceSha = '0123456789abcdef0123456789abcdef01234567';
const otherSourceSha = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba98';
const releasePredicateType = 'https://keleyaa.dev/subweb/release/v1';
const expectedReference = `ghcr.io/keleyaa/subweb:${validVersion}`;
const expectedImmutableReference = `ghcr.io/keleyaa/subweb@${validDigest}`;

const makeAttestationOutput = ({
  version = validVersion,
  ref = `refs/tags/${version}`,
  sourceSha = validSourceSha,
  digest = validDigest,
} = {}) => [version, ref, sourceSha, digest].join('\t');

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-release-image-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin);

  const docker = join(bin, 'docker');
  await writeFile(docker, [
    '#!/bin/sh',
    'set -eu',
    'printf \'%s\\n\' "$*" >> "$DOCKER_LOG"',
    'case "$*" in',
    "  'buildx version') exit \"${BUILDX_STATUS:-0}\" ;;",
    "  'buildx imagetools inspect '*)",
    "    [ \"${INSPECT_STATUS:-0}\" -eq 0 ] || exit \"$INSPECT_STATUS\"",
    "    printf '%s' \"${INSPECT_DIGEST-}\"",
    '    ;;',
    "  *'compose '* | *' pull '* | *' up'*) exit 97 ;;",
    '  *) exit 64 ;;',
    'esac',
    '',
  ].join('\n'));
  await chmod(docker, 0o755);

  const gh = join(bin, 'gh');
  await writeFile(gh, [
    '#!/bin/sh',
    'set -eu',
    'printf \'%s\\n\' "$*" >> "$GH_LOG"',
    'case "$*" in',
     "  *'commits/'*'--jq .sha'*)",
     '    [ "${SOURCE_STATUS:-0}" -eq 0 ] || exit "$SOURCE_STATUS"',
     '    printf \'%s\\n\' "${SOURCE_SHA:-0123456789abcdef0123456789abcdef01234567}"',
     '    ;;',
     "  'attestation verify '*)",
     '    [ "${ATTESTATION_STATUS:-0}" -eq 0 ] || exit "$ATTESTATION_STATUS"',
    '    printf \'%s\' "${ATTESTATION_OUTPUT-}"',
    '    ;;',
    '  *) exit 64 ;;',
    'esac',
    '',
  ].join('\n'));
  await chmod(gh, 0o755);
  return root;
};

const makeMissingDockerFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'subweb-release-image-no-docker-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin);

  const grep = join(bin, 'grep');
  await writeFile(grep, '#!/bin/sh\nexec /usr/bin/grep "$@"\n');
  await chmod(grep, 0o755);
  return root;
};

const runResolver = (root, version, environment = {}) => {
  const versions = version === undefined ? [] : (Array.isArray(version) ? version : [version]);

  return spawnSync('sh', ['-c', '. "$1"; shift; resolve_release_image "$@"', 'sh', releaseImageLibrary.pathname, ...versions], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      DOCKER_LOG: join(root, 'docker.log'),
       GH_LOG: join(root, 'gh.log'),
       INSPECT_DIGEST: validDigest,
       SOURCE_SHA: validSourceSha,
       ATTESTATION_OUTPUT: makeAttestationOutput(),
       ...environment,
    },
  });
};

const readDockerLog = async (root) => {
  try {
    return await readFile(join(root, 'docker.log'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

const readGhLog = async (root) => {
  try {
    return await readFile(join(root, 'gh.log'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

const resolverDockerCommand = '(?:buildx version|buildx imagetools inspect ghcr\\.io/keleyaa/subweb:v[0-9]+\\.[0-9]+\\.[0-9]+ --format \\{\\{\\.Manifest\\.Digest\\}\\})';
const resolverDockerLog = new RegExp(`^${resolverDockerCommand}(?:\\n${resolverDockerCommand})*\\n$`);

const expectNoDeploymentCommands = async (root) => {
  const log = await readDockerLog(root);
  if (log !== '') expect(log).toMatch(resolverDockerLog);
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('release image resolver', () => {
  it('resolves an exact release tag to its immutable manifest digest', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { INSPECT_DIGEST: validDigest });

     expect(result.status, result.stderr).toBe(0);
     expect(result.stdout).toBe(`ghcr.io/keleyaa/subweb@${validDigest}\n`);
    expect(await readDockerLog(root)).toBe([
      'buildx version',
      `buildx imagetools inspect ${expectedReference} --format {{.Manifest.Digest}}`,
      '',
    ].join('\n'));
    expect(await readGhLog(root)).toContain(
      `attestation verify oci://${expectedImmutableReference} --repo keleyaa/subweb --signer-workflow keleyaa/subweb/.github/workflows/docker-build-release.yml --predicate-type ${releasePredicateType} --format json --jq`,
    );
  });

  it('rejects a valid digest when signed release provenance verification fails', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, {
      ATTESTATION_STATUS: '17',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to verify release provenance');
    expect(result.stdout).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('rejects an attestation whose source commit differs from the authoritative tag', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, {
      ATTESTATION_OUTPUT: makeAttestationOutput({ sourceSha: otherSourceSha }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the requested release');
    expect(result.stdout).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('accepts a matching predicate among multiple verified statements', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, {
      ATTESTATION_OUTPUT: [
        makeAttestationOutput({ version: 'v1.2.4' }),
        makeAttestationOutput(),
      ].join('\n'),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${expectedImmutableReference}\n`);
    await expectNoDeploymentCommands(root);
  });

  it.each([
    ['version', { version: 'v1.2.4' }],
    ['ref', { ref: 'refs/tags/v1.2.4' }],
    ['digest', { digest: otherDigest }],
  ])('rejects signed provenance for a different %s', async (_name, attestation) => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, {
      ATTESTATION_OUTPUT: makeAttestationOutput(attestation),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the requested release');
    expect(result.stdout).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it.each([
    'not-tsv',
    `${makeAttestationOutput()}\textra-field`,
     `${validVersion}\t\t${validSourceSha}\t${validDigest}`,
     `${makeAttestationOutput()}\nnot-tsv`,
    `${makeAttestationOutput()}\n\n`,
  ])('rejects malformed attestation TSV output', async (attestationOutput) => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { ATTESTATION_OUTPUT: attestationOutput });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the requested release');
    expect(result.stdout).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('rejects a missing GitHub CLI before resolving the image', async () => {
    const root = await makeFixture();
    await rm(join(root, 'bin', 'gh'));

    const result = spawnSync('sh', [
      '-c',
      '. "$1"; resolve_release_image "$2"',
      'sh',
      releaseImageLibrary.pathname,
      validVersion,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        DOCKER_LOG: join(root, 'docker.log'),
        GH_LOG: join(root, 'gh.log'),
        INSPECT_DIGEST: validDigest,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('GitHub CLI is required to verify release provenance.\n');
    expect(result.stdout).toBe('');
    expect(await readDockerLog(root)).toBe('buildx version\n');
  });

  it('resolves a manifest digest with one terminal newline', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { INSPECT_DIGEST: `${validDigest}\n` });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`ghcr.io/keleyaa/subweb@${validDigest}\n`);
    await expectNoDeploymentCommands(root);
  });

  it('rejects a manifest digest with two terminal newlines', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { INSPECT_DIGEST: `${validDigest}\n\n` });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve immutable digest for: ${expectedReference}`);
    await expectNoDeploymentCommands(root);
  });

  it.each([
    '1.2.3',
    'v1.2',
    'v1.2.3-rc.1',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    `v${'1'.repeat(126)}.2.3`,
    'latest',
  ])('rejects invalid version %s before invoking Docker', async (version) => {
    const root = await makeFixture();

    const result = runResolver(root, version);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('Invalid release version (expected v<major>.<minor>.<patch>)\n');
    expect(await readDockerLog(root)).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('rejects a multiline version argument without echoing the invalid payload', async () => {
    const root = await makeFixture();

    const result = runResolver(root, 'v1.2.3\ninvalid');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('Invalid release version (expected v<major>.<minor>.<patch>)\n');
    expect(await readDockerLog(root)).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('rejects extra positional arguments before invoking Docker', async () => {
    const root = await makeFixture();

    const result = runResolver(root, [validVersion, 'extra']);

    expect(result.status).not.toBe(0);
    expect(await readDockerLog(root)).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('rejects a missing release version before invoking Docker', async () => {
    const root = await makeFixture();

    const result = runResolver(root);

    expect(result.status).not.toBe(0);
    expect(await readDockerLog(root)).toBe('');
    await expectNoDeploymentCommands(root);
  });

  it('fails clearly when Docker is missing from a fixture-local PATH', async () => {
    const root = await makeMissingDockerFixture();

    const result = spawnSync('/bin/sh', ['-c', '. "$1"; resolve_release_image "$2"', 'sh', releaseImageLibrary.pathname, validVersion], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: join(root, 'bin') },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('Docker with Buildx is required to resolve release images.\n');
  });

  it('fails clearly when Buildx is unavailable', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { BUILDX_STATUS: '23' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Docker Buildx is required');
    expect(await readDockerLog(root)).toBe('buildx version\n');
    await expectNoDeploymentCommands(root);
  });

  it('fails when manifest inspection returns a nonzero status under errexit', async () => {
    const root = await makeFixture();

    const result = spawnSync('sh', ['-c', 'set -e; . "$1"; resolve_release_image "$2"', 'sh', releaseImageLibrary.pathname, validVersion], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
         DOCKER_LOG: join(root, 'docker.log'),
         GH_LOG: join(root, 'gh.log'),
         SOURCE_SHA: validSourceSha,
         ATTESTATION_OUTPUT: makeAttestationOutput(),
         INSPECT_STATUS: '42',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve release image: ${expectedReference}`);
    expect(await readDockerLog(root)).toBe([
      'buildx version',
      `buildx imagetools inspect ${expectedReference} --format {{.Manifest.Digest}}`,
      '',
    ].join('\n'));
    await expectNoDeploymentCommands(root);
  });

  it('does not overwrite caller variables when validating and resolving an image', async () => {
    const root = await makeFixture();
    const result = spawnSync('sh', ['-c', [
      'set -e',
      'release_version=caller-release',
      'newline=caller-newline',
      'manifest_capture=caller-capture',
      'inspect_status=caller-status',
      'manifest_digest=caller-digest',
      'release_reference=caller-reference',
      'sentinel=caller-sentinel',
      '. "$1"',
      'validate_release_version "$2"',
      'resolve_release_image "$2" >/dev/null',
      'printf \'%s\\n\' "$release_version|$newline|$manifest_capture|$inspect_status|$manifest_digest|$release_reference|$sentinel"',
    ].join('; '), 'sh', releaseImageLibrary.pathname, validVersion], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        DOCKER_LOG: join(root, 'docker.log'),
        GH_LOG: join(root, 'gh.log'),
        INSPECT_DIGEST: validDigest,
        ATTESTATION_OUTPUT: makeAttestationOutput(),
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('caller-release|caller-newline|caller-capture|caller-status|caller-digest|caller-reference|caller-sentinel\n');
    await expectNoDeploymentCommands(root);
  });

  it.each([
    ['empty digest', ''],
    ['malformed digest', 'sha256:ABCDEF'],
  ])('rejects a %s from manifest inspection', async (_name, digest) => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { INSPECT_DIGEST: digest });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve immutable digest for: ${expectedReference}`);
    await expectNoDeploymentCommands(root);
  });

  it('rejects multiline manifest output after a valid digest', async () => {
    const root = await makeFixture();

    const result = runResolver(root, validVersion, { INSPECT_DIGEST: `${validDigest}\nunexpected-output` });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Unable to resolve immutable digest for: ${expectedReference}`);
    await expectNoDeploymentCommands(root);
  });
});
