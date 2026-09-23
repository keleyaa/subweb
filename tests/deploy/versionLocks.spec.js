import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateVersionLocks } from '../../scripts/verify-version-locks.mjs';
import {
  renderRuntimeImageEnv,
  resolveRuntimeImages,
  runtimeImagesForRollback,
} from '../../scripts/runtime-image-contract.mjs';

const lockPath = fileURLToPath(
  new URL('../../deploy/versions.lock.json', import.meta.url),
);
const validatorPath = fileURLToPath(
  new URL('../../scripts/verify-version-locks.mjs', import.meta.url),
);
const runtimeContractPath = fileURLToPath(
  new URL('../../scripts/runtime-image-contract.mjs', import.meta.url),
);
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const requiredPlatforms = ['linux/amd64', 'linux/arm64'];
const inventoryError =
  'services must contain exactly: gatewayBase, myurls, redis, subconverter';
const gatewayBaseSourceError =
  'services.gatewayBase.source.repository must equal docker-library/golang';
  const gatewayBaseImageError =
    'services.gatewayBase.image.reference must use docker.io/library/golang:1.27-alpine';
  const redisSourceError = 'services.redis.source.tag must equal 7.4.11';
  const redisImageError = 'services.redis.image.reference must equal docker.io/library/redis:7.4.11-alpine';
  const runtimeImageError =
  'services.gatewayBase.runtimeImages must contain exactly: distroless, frontend';
const imageReferenceError =
  'services.myurls.image.reference must be a valid tagged OCI/Docker reference';
const sourceTagError =
  'services.myurls.source.tag must be a valid non-latest source tag';
const myurlsReleaseError =
  'services.myurls.source.tag must be a published Rust v2 release tag';
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

const runRuntimeContractCli = (command, path) =>
  spawnSync(
    process.execPath,
    [runtimeContractPath, command, '--lock', path],
    { encoding: 'utf8' },
  );

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

  it('pins the approved Redis 7.4.11 Alpine security manifest', () => {
    expect(lock.verifiedAt).toBe('2026-09-18T18:59:27Z');
    expect(lock.services.redis.source).toEqual({
      url: 'https://github.com/redis/redis',
      repository: 'redis/redis',
      tag: '7.4.11',
      commit: 'aaf0ce63b3239f4b51f86ca1da8711b055721993',
      prerelease: false,
    });
    expect(lock.services.redis.image).toEqual({
      reference: 'docker.io/library/redis:7.4.11-alpine',
      digest: 'sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7',
      platforms: {
        'linux/amd64': 'sha256:ca0acbb137c1dc3339c8b147a58fd6f42775d4599327b50e7b116c23de501af2',
        'linux/arm64': 'sha256:1f09a89a207d794a8c61d9edfc26e7c58427de10ccef7c5d18d638df79a63b85',
      },
    });
  });

  it('uses the approved upstream repositories and Rust MyUrls release', () => {
    expect(lock.services.myurls.source).toMatchObject({
      repository: 'keleyaa/MyUrls',
      tag: 'v2.0.8',
      commit: '42234e8d1085b6c1449d16f04cd61e34104037f5',
    });
    expect(lock.services.myurls.image).toMatchObject({
      reference: 'ghcr.io/keleyaa/myurls:v2.0.8',
      digest: 'sha256:441aed70342b9071f4f64bdbb6fe7d659774c23f1f8bfd3db76c33936eb01d36',
      platforms: {
        'linux/amd64': 'sha256:a46f3edf00074b4cf9d576305a7fa1aea5b0dd64110cf2b402f5db7a041fdb3a',
        'linux/arm64': 'sha256:362d6d58fcecd7e6199c1d8ed2ca4f10c533a814c80655ceaf85d7a5ad250983',
      }
    });
    expect(lock.services.subconverter.source.repository).toBe(
      'Aethersailor/SubConverter-Extended',
    );
    expect(lock.services.subconverter.image.reference).toBe(
      'ghcr.io/aethersailor/subconverter-extended:v1.9.4',
    );
  });

  it('rejects a foreign or tag-mismatched SubConverter artifact', () => {
    const candidate = structuredClone(lock);
    candidate.services.subconverter.source.repository = 'untrusted/SubConverter';
    candidate.services.subconverter.image.reference =
      'ghcr.io/untrusted/subconverter:v9.9.9';

    expect(validateVersionLocks(candidate)).toEqual(expect.arrayContaining([
      'services.subconverter.source.repository must equal Aethersailor/SubConverter-Extended',
      'services.subconverter.image.reference must use ghcr.io/aethersailor/subconverter-extended',
      'services.subconverter.image.reference tag must match source.tag',
    ]));
  });

  it('pins the Go gateway builder and runtime image inputs used by Dockerfile', async () => {
    const fixtureDockerfile = await readFile(
      new URL('../fixtures/conversion-upstream/Dockerfile', import.meta.url),
      'utf8',
    );
    const fixtureBuilderReference = lock.services.gatewayBase.image.reference.replace(
      'docker.io/library/',
      '',
    );

    expect(fixtureDockerfile).toContain(
      `FROM ${fixtureBuilderReference}@${lock.services.gatewayBase.image.digest} AS build`,
    );
    expect(lock.services.gatewayBase.source).toMatchObject({
      repository: 'docker-library/golang', tag: '1.27/alpine3.24',
    });
    expect(lock.services.gatewayBase.image.reference).toBe('docker.io/library/golang:1.27-alpine');
    expect(lock.services.gatewayBase.runtimeImages).toMatchObject({
      frontend: expect.objectContaining({ reference: 'docker.io/library/node:24-alpine' }),
      distroless: expect.objectContaining({ reference: 'gcr.io/distroless/static-debian12:nonroot' }),
    });
    for (const image of Object.values(lock.services.gatewayBase.runtimeImages)) {
      expect(image.digest).toMatch(digestPattern);
      expect(image.platforms).toEqual(
        expect.objectContaining(
          Object.fromEntries(
            requiredPlatforms.map((platform) => [
              platform,
              expect.stringMatching(digestPattern),
            ]),
          ),
        ),
      );
    }
  });

  it('passes the reusable production lock validator', () => {
    expect(validateVersionLocks(lock)).toEqual([]);
  });

  it('derives Compose and rollback runtime images from the validated lock', () => {
    const images = resolveRuntimeImages(lock);

    expect(images).toEqual({
      REDIS_IMAGE: 'docker.io/library/redis:7.4.11-alpine@sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7',
      SUBCONVERTER_IMAGE: `${lock.services.subconverter.image.reference}@${lock.services.subconverter.image.digest}`,
      MYURLS_IMAGE: `${lock.services.myurls.image.reference}@${lock.services.myurls.image.digest}`,
    });
    expect(renderRuntimeImageEnv(images)).toBe([
      `REDIS_IMAGE=${images.REDIS_IMAGE}`,
      `SUBCONVERTER_IMAGE=${images.SUBCONVERTER_IMAGE}`,
      `MYURLS_IMAGE=${images.MYURLS_IMAGE}`,
      '',
    ].join('\n'));
    expect(runtimeImagesForRollback(lock)).toEqual({
      redis: {
        reference: `${lock.services.redis.image.reference}@${lock.services.redis.image.digest}`,
        digest: lock.services.redis.image.digest,
        platforms: { ...lock.services.redis.image.platforms },
      },
      subconverter: {
        reference: `${lock.services.subconverter.image.reference}@${lock.services.subconverter.image.digest}`,
        digest: lock.services.subconverter.image.digest,
        platforms: { ...lock.services.subconverter.image.platforms },
      },
      myurls: {
        reference: `${lock.services.myurls.image.reference}@${lock.services.myurls.image.digest}`,
        digest: lock.services.myurls.image.digest,
        platforms: { ...lock.services.myurls.image.platforms },
      },
    });
  });

  it('rejects runtime environment keys and values outside the exact contract', () => {
    const images = resolveRuntimeImages(lock);

    expect(() => renderRuntimeImageEnv({ ...images, EXTRA_IMAGE: images.REDIS_IMAGE })).toThrow(
      'Runtime image environment must contain exactly',
    );
    expect(() => renderRuntimeImageEnv({
      ...images,
      MYURLS_IMAGE: `${images.MYURLS_IMAGE}\nUNSAFE=value`,
    })).toThrow('MYURLS_IMAGE must be an immutable sha256 image reference');
  });

  it('refuses to derive runtime images from an invalid lock', () => {
    const candidate = structuredClone(lock);
    candidate.services.redis.image.digest = 'sha256:bad';

    expect(() => resolveRuntimeImages(candidate)).toThrow(
      'services.redis.image.digest must be a sha256 digest',
    );
  });

  it('rejects malformed locks before generating rollback images', () => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image = null;

    expect(() => runtimeImagesForRollback(candidate)).toThrow(
      'services.myurls.image must be an object',
    );
  });

  it.each([
    [
      'an invalid image digest',
      (candidate) => {
        candidate.services.redis.image.digest = 'sha256:bad';
      },
      'services.redis.image.digest must be a sha256 digest',
    ],
    [
      'an invalid platform digest',
      (candidate) => {
        candidate.services.redis.image.platforms['linux/arm64'] = 'sha256:bad';
      },
      'services.redis.image.platforms.linux/arm64 must be a sha256 digest',
    ],
  ])('rejects rollback generation with %s', (_label, mutate, expectedError) => {
    const candidate = structuredClone(lock);
    mutate(candidate);

    expect(() => runtimeImagesForRollback(candidate)).toThrow(expectedError);
  });

  it('rejects a Redis source or image outside the approved 7.4.11 Alpine lock', () => {
    const candidate = structuredClone(lock);
    candidate.services.redis.source.tag = '8.10.1';
    candidate.services.redis.image.reference = 'docker.io/library/redis:8.10.1';

    expect(validateVersionLocks(candidate)).toEqual(expect.arrayContaining([
      redisSourceError, redisImageError,
    ]));
  });

  it('rejects a Gateway base image or runtime input that differs from Dockerfile', () => {
    const candidate = structuredClone(lock);
    candidate.services.gatewayBase.source.repository = 'nginx/nginx';
    candidate.services.gatewayBase.image.reference = 'docker.io/nginxinc/nginx-unprivileged:1.30.4-alpine';
    delete candidate.services.gatewayBase.runtimeImages;

    expect(validateVersionLocks(candidate)).toEqual(expect.arrayContaining([
      gatewayBaseSourceError, gatewayBaseImageError, runtimeImageError,
    ]));
  });

  it.each([
    ['ghcr.io/keleyaa/myurls:v2.0.8', 'v2.0.8'],
    ['ghcr.io/keleyaa/myurls:v2.1.0', 'v2.1.0'],
  ])('accepts the tagged MyUrls image reference %s', (reference, tag) => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.source.tag = tag;
    candidate.services.myurls.image.reference = reference;

    expect(validateVersionLocks(candidate)).not.toContain(imageReferenceError);
  });

  it('rejects a legacy or foreign MyUrls artifact', () => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.source.repository = 'legacy/MyUrls';
    candidate.services.myurls.source.tag = 'v1.13.0';
    candidate.services.myurls.image.reference = 'ghcr.io/keleyaa/myurls:v2.0.8';

    expect(validateVersionLocks(candidate)).toEqual(
      expect.arrayContaining([
        'services.myurls.source.repository must equal keleyaa/MyUrls',
        myurlsReleaseError,
        'services.myurls.image.reference tag must match source.tag',
      ]),
    );
  });

  it('rejects a MyUrls image from an unapproved registry repository', () => {
    const candidate = structuredClone(lock);
    candidate.services.myurls.image.reference = 'docker.io/legacy/myurls:v2.0.8';

    expect(validateVersionLocks(candidate)).toContain(
      'services.myurls.image.reference must use ghcr.io/keleyaa/myurls',
    );
  });

  it.each([
    ['not a valid image :v1', imageReferenceError],
    ['ghcr.io/keleyaa/my urls:v1', imageReferenceError],
    ['ghcr.io/keleyaa/myurls:\tv1', imageReferenceError],
    ['docker..io/library/redis:v1', imageReferenceError],
    ['registry.example:99999/library/redis:v1', imageReferenceError],
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

  it.each(['v2.0.8', 'v2.1.0'])(
    'accepts the Rust MyUrls source tag %s when the image tag matches',
    (tag) => {
      const candidate = structuredClone(lock);
      candidate.services.myurls.source.tag = tag;
      candidate.services.myurls.image.reference = `ghcr.io/keleyaa/myurls:${tag}`;

      expect(validateVersionLocks(candidate)).toEqual([]);
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

  it.each(['v2.01.0', 'v2.1.00', 'v2.00.1'])(
    'rejects the non-canonical Rust MyUrls release tag %j',
    (tag) => {
      const candidate = structuredClone(lock);
      candidate.services.myurls.source.tag = tag;

      expect(validateVersionLocks(candidate)).toContain(myurlsReleaseError);
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

  it('renders the runtime environment through the CLI', () => {
    const result = runRuntimeContractCli('env', lockPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(renderRuntimeImageEnv(resolveRuntimeImages(lock)));
    expect(result.stderr).toBe('');
  });

  it('fails the runtime-image CLI for a missing lock file', () => {
    const missingLockPath = join(temporaryDirectory, 'missing-runtime.lock.json');

    const result = runRuntimeContractCli('rollback', missingLockPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to read version locks:');
  });
});
