import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateVersionLocks } from '../../scripts/verify-version-locks.mjs';

const lockPath = fileURLToPath(
  new URL('../../deploy/versions.lock.json', import.meta.url),
);
const validatorPath = fileURLToPath(
  new URL('../../scripts/verify-version-locks.mjs', import.meta.url),
);
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const requiredPlatforms = ['linux/amd64', 'linux/arm64'];
const inventoryError =
  'services must contain exactly: gatewayBase, myurls, redis, subconverter';
const imageReferenceError =
  'services.myurls.image.reference must be a valid tagged OCI/Docker reference';
const sourceTagError =
  'services.myurls.source.tag must be a valid non-latest source tag';
const verifiedAtError =
  'verifiedAt must be a canonical UTC timestamp in YYYY-MM-DDTHH:mm:ssZ format';

let temporaryDirectory;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'subweb-version-locks-'));
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const runValidatorCli = (path) =>
  spawnSync(process.execPath, [validatorPath, path], {
    encoding: 'utf8',
  });

describe('integrated service artifact locks', () => {
  it('uses the current schema and exact service inventory', () => {
    expect(lock.schemaVersion).toBe(1);
    expect(Object.keys(lock.services).sort()).toEqual([
      'gatewayBase',
      'myurls',
      'redis',
      'subconverter',
    ]);
  });

  it('pins every service to traceable non-prerelease source and image artifacts', () => {
    for (const service of Object.values(lock.services)) {
      if (service.source.tag === null) {
        expect(service.source.release).toMatchObject({
          kind: 'workflow_dispatch',
          version: expect.any(String),
          runId: expect.any(Number),
        });
      } else {
        expect(service.source.tag).toEqual(expect.any(String));
      }
      expect(service.source.commit).toMatch(commitPattern);
      expect(service.source.prerelease).toBe(false);

      expect(service.image.reference).toEqual(expect.any(String));
      expect(service.image.reference.toLowerCase()).not.toContain('latest');
      expect(service.image.digest).toMatch(digestPattern);
      expect(service.image.platforms).toEqual(
        expect.objectContaining(
          Object.fromEntries(
            requiredPlatforms.map((platform) => [
              platform,
              expect.stringMatching(digestPattern),
            ]),
          ),
        ),
      );

      expect(service.container.internalPorts.length).toBeGreaterThan(0);
      for (const port of service.container.internalPorts) {
        expect(port).toBeGreaterThanOrEqual(1);
        expect(port).toBeLessThanOrEqual(65_535);
      }
    }
  });

  it('uses the approved upstream repositories and Rust MyUrls release', () => {
    expect(lock.services.myurls.source).toMatchObject({
      repository: 'keleyaa/MyUrls',
      tag: 'v2.0.5',
      commit: '0cf3f7dcb79041f87ff6c1827a0e09c1b4ca7417',
    });
    expect(lock.services.myurls.image).toMatchObject({
      reference: 'ghcr.io/keleyaa/myurls:v2.0.5',
      digest: 'sha256:8020ce81d843a2945b84470eb08c717aa880c61c056d1df15dfd79f8362d50b9',
      platforms: {
        'linux/amd64': 'sha256:9350c9aaa350f0fb5459576838a171d813e830a3fb0e3787c4ce91e3c3b3606c',
        'linux/arm64': 'sha256:06998deaafe2d0385d04f6242d6154ee466213c0361d43280302c10bae90befa',
      }
    });
    expect(lock.services.subconverter.source.repository).toBe(
      'Aethersailor/SubConverter-Extended',
    );
  });

  it('passes the reusable production lock validator', () => {
    expect(validateVersionLocks(lock)).toEqual([]);
  });

  it.each([
    'docker.io/nginxinc/nginx-unprivileged:1.30.4-alpine',
    'docker.io/library/redis:8.10.1',
    'ghcr.io/keleyaa/myurls:v1.13.0',
    'ghcr.io/aethersailor/subconverter-extended:v1.8.6',
  ])('accepts the tagged image reference %s', (reference) => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image.reference = reference;

    expect(validateVersionLocks(candidate)).not.toContain(imageReferenceError);
  });

  it.each([
    ['not a valid image :v1', imageReferenceError],
    ['ghcr.io/keleyaa/my urls:v1', imageReferenceError],
    ['ghcr.io/keleyaa/myurls:\tv1', imageReferenceError],
    ['docker..io/library/redis:v1', imageReferenceError],
    ['ghcr.io//myurls:v1', imageReferenceError],
    ['ghcr.io/keleyaa/myurls', imageReferenceError],
    [
      `ghcr.io/keleyaa/myurls@${'sha256:'.padEnd(71, 'a')}`,
      imageReferenceError,
    ],
    ['ghcr.io/keleyaa/myurls:-v1', imageReferenceError],
    ['ghcr.io/keleyaa/myurls:LATEST', 'must not use latest'],
  ])('rejects the invalid image reference %j', (reference, expectedError) => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image.reference = reference;

    expect(validateVersionLocks(candidate)).toEqual(
      expect.arrayContaining([expect.stringContaining(expectedError)]),
    );
  });

  it.each(['release-1.30.4', '8.10.1', 'v1.13.0', 'v1.8.6'])(
    'accepts the source tag %s',
    (tag) => {
      const candidate = structuredClone(lock);
      candidate.services.myurls.source.tag = tag;

      expect(validateVersionLocks(candidate)).not.toContain(sourceTagError);
    },
  );

  it.each(['', '   ', 'v1\n', 'LATEST'])(
    'rejects the invalid source tag %j',
    (tag) => {
      const candidate = structuredClone(lock);
      candidate.services.myurls.source.tag = tag;

      expect(validateVersionLocks(candidate)).toContain(sourceTagError);
    },
  );

  it.each([
    'nonsense',
    '2026-08-01T10:55:34+00:00',
    '2026-08-01T10:55:34.000Z',
    '2026-02-30T10:55:34Z',
  ])('rejects the non-canonical verifiedAt timestamp %j', (verifiedAt) => {
    const candidate = structuredClone(lock);
    candidate.verifiedAt = verifiedAt;

    expect(validateVersionLocks(candidate)).toContain(verifiedAtError);
  });

  it('validates every additional image platform entry', () => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image.platforms['linux/ppc64le'] = 'bad';
    candidate.services.myurls.image.platforms[''] = lock.services.redis.image.digest;

    expect(validateVersionLocks(candidate)).toEqual(
      expect.arrayContaining([
        'services.myurls.image.platforms.linux/ppc64le must be a sha256 digest',
        'services.myurls.image.platforms key "" must be a valid platform name',
      ]),
    );
  });

  it('accepts a valid additional image platform entry', () => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image.platforms['linux/ppc64le'] =
      lock.services.redis.image.digest;

    expect(validateVersionLocks(candidate)).toEqual([]);
  });

  it.each([
    [
      'missing service',
      (candidate) => {
        delete candidate.services.redis;
      },
    ],
    [
      'incorrectly named service',
      (candidate) => {
        candidate.services.myUrls = candidate.services.myurls;
        delete candidate.services.myurls;
      },
    ],
    [
      'additional service',
      (candidate) => {
        candidate.services.unapproved = structuredClone(
          candidate.services.redis,
        );
      },
    ],
  ])('rejects a %s in the service inventory', (_scenario, mutate) => {
    const candidate = structuredClone(lock);
    mutate(candidate);

    expect(validateVersionLocks(candidate)).toContain(inventoryError);
  });

  it('reports every validation error instead of stopping at the first one', () => {
    const invalidLock = {
      schemaVersion: 2,
      services: {
        myurls: {
          source: {
            url: 'http://example.com/source',
            repository: 'keleyaa/MyUrls',
            tag: '',
            commit: 'short',
            prerelease: true,
          },
          image: {
            reference: 'ghcr.io/keleyaa/myurls:latest',
            digest: 'sha256:bad',
            platforms: {},
          },
          container: { internalPorts: [0, 65_536] },
        },
      },
    };

    const errors = validateVersionLocks(invalidLock);

    expect(errors.length).toBeGreaterThanOrEqual(10);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('schemaVersion'),
        expect.stringContaining('source.url'),
        expect.stringContaining('source.commit'),
        expect.stringContaining('source.prerelease'),
        expect.stringContaining('image.reference'),
        expect.stringContaining('linux/amd64'),
        expect.stringContaining('linux/arm64'),
        expect.stringContaining('internalPorts[0]'),
        expect.stringContaining('internalPorts[1]'),
      ]),
    );
  });

  it('rejects image references without an explicit immutable version tag', () => {
    const invalidLock = structuredClone(lock);
    invalidLock.services.myurls.image.reference = 'ghcr.io/keleyaa/myurls';

    expect(validateVersionLocks(invalidLock)).toContain(imageReferenceError);
  });

  it('exits successfully when the CLI validates an explicit valid lock file', async () => {
    const validLockPath = join(temporaryDirectory, 'valid.lock.json');
    await writeFile(validLockPath, JSON.stringify(lock));

    const result = runValidatorCli(validLockPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Version locks are valid.');
    expect(result.stderr).toBe('');
  });

  it('exits unsuccessfully and prints every CLI validation error', async () => {
    const invalidLockPath = join(temporaryDirectory, 'invalid.lock.json');
    const invalidLock = {
      schemaVersion: 2,
      services: {
        myurls: {
          source: {
            url: 'http://example.com/source',
            repository: 'keleyaa/MyUrls',
            tag: '',
            commit: 'short',
            prerelease: true,
          },
          image: {
            reference: 'ghcr.io/keleyaa/myurls:latest',
            digest: 'sha256:bad',
            platforms: {},
          },
          container: { internalPorts: [0] },
        },
      },
    };
    await writeFile(invalidLockPath, JSON.stringify(invalidLock));

    const result = runValidatorCli(invalidLockPath);

    expect(result.status).not.toBe(0);
    for (const expectedError of [
      'schemaVersion',
      inventoryError,
      'source.url',
      'source.commit',
      'source.prerelease',
      'image.reference',
      'image.digest',
      'linux/amd64',
      'linux/arm64',
      'internalPorts[0]',
    ]) {
      expect(result.stderr).toContain(expectedError);
    }
  });

  it('exits unsuccessfully when the CLI cannot read its explicit lock file', () => {
    const missingLockPath = join(temporaryDirectory, 'missing.lock.json');

    const result = runValidatorCli(missingLockPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to read version locks:');
  });
});
