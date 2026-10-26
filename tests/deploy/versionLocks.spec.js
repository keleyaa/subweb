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
const inventoryError = 'services must contain exactly: gatewayBase, subconverter';
const gatewayBaseSourceError =
  'services.gatewayBase.source.repository must equal docker-library/golang';
const gatewayBaseImageError =
  'services.gatewayBase.image.reference must use docker.io/library/golang:1.27-alpine';
const subconverterSourceError =
  'services.subconverter.source.repository must equal Aethersailor/SubConverter-Extended';
const subconverterImageError =
  'services.subconverter.image.reference must use ghcr.io/aethersailor/subconverter-extended';
const runtimeImageError =
  'services.gatewayBase.runtimeImages must contain exactly: distroless, frontend';
const verifiedAtError =
  'verifiedAt must be a canonical UTC timestamp in YYYY-MM-DDTHH:mm:ssZ format';

const cloneLock = () => structuredClone(lock);

let temporaryDirectory;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'subweb-version-locks-'));
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const runValidatorCli = (path) =>
  spawnSync(process.execPath, [validatorPath, path], { encoding: 'utf8' });

const runRuntimeContractCli = (command, path) =>
  spawnSync(process.execPath, [runtimeContractPath, command, '--lock', path], {
    encoding: 'utf8',
  });

const writeLock = async (name, value) => {
  const path = join(temporaryDirectory, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
};

describe('integrated service artifact locks', () => {
  it('uses the current schema and exact service inventory', () => {
    expect(lock.schemaVersion).toBe(1);
    expect(Object.keys(lock.services).sort()).toEqual(['gatewayBase', 'subconverter']);
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

  it('pins the approved Go builder and runtime images', () => {
    expect(lock.verifiedAt).toBe('2026-10-26T17:25:10Z');
    expect(lock.services.gatewayBase.source.repository).toBe('docker-library/golang');
    expect(lock.services.gatewayBase.image.reference).toBe(
      'docker.io/library/golang:1.27-alpine',
    );
    expect(Object.keys(lock.services.gatewayBase.runtimeImages).sort()).toEqual([
      'distroless',
      'frontend',
    ]);
    for (const image of Object.values(lock.services.gatewayBase.runtimeImages)) {
      expect(image.digest).toMatch(digestPattern);
      for (const platform of requiredPlatforms) {
        expect(image.platforms[platform]).toMatch(digestPattern);
      }
    }
  });

  it('pins SubConverter to its approved upstream release', () => {
    expect(lock.services.subconverter.source.repository).toBe(
      'Aethersailor/SubConverter-Extended',
    );
    expect(lock.services.subconverter.image.reference).toBe(
      `ghcr.io/aethersailor/subconverter-extended:${lock.services.subconverter.source.tag}`,
    );
    expect(lock.services.subconverter.container.internalPorts).toEqual([25500]);
  });

  it('accepts the checked-in lock without validation errors', () => {
    expect(validateVersionLocks(lock)).toEqual([]);
  });
});

describe('version lock validation', () => {
  it('rejects missing, renamed, and additional services', () => {
    const missing = cloneLock();
    delete missing.services.subconverter;
    expect(validateVersionLocks(missing)).toContain(inventoryError);

    const renamed = cloneLock();
    renamed.services.redis = renamed.services.subconverter;
    delete renamed.services.subconverter;
    expect(validateVersionLocks(renamed)).toContain(inventoryError);

    const additional = cloneLock();
    additional.services.redis = structuredClone(additional.services.subconverter);
    expect(validateVersionLocks(additional)).toContain(inventoryError);
  });

  it('rejects approved repository and image drift', () => {
    const gatewaySource = cloneLock();
    gatewaySource.services.gatewayBase.source.repository = 'library/golang';
    expect(validateVersionLocks(gatewaySource)).toContain(gatewayBaseSourceError);

    const gatewayImage = cloneLock();
    gatewayImage.services.gatewayBase.image.reference =
      'docker.io/library/golang:1.26-alpine';
    expect(validateVersionLocks(gatewayImage)).toContain(gatewayBaseImageError);

    const subconverterSource = cloneLock();
    subconverterSource.services.subconverter.source.repository = 'tindy2013/subconverter';
    expect(validateVersionLocks(subconverterSource)).toContain(subconverterSourceError);

    const subconverterImage = cloneLock();
    subconverterImage.services.subconverter.image.reference =
      'docker.io/library/subconverter:v1.9.4';
    expect(validateVersionLocks(subconverterImage)).toContain(subconverterImageError);
  });

  it('rejects mutable or untraceable artifacts', () => {
    const latestTag = cloneLock();
    latestTag.services.subconverter.source.tag = 'latest';
    expect(validateVersionLocks(latestTag)).toContain(
      'services.subconverter.source.tag must be a valid non-latest source tag',
    );

    const shortCommit = cloneLock();
    shortCommit.services.subconverter.source.commit = 'abc123';
    expect(validateVersionLocks(shortCommit)).toContain(
      'services.subconverter.source.commit must be a full 40-character commit',
    );

    const badDigest = cloneLock();
    badDigest.services.subconverter.image.digest = 'sha256:nothex';
    expect(validateVersionLocks(badDigest)).toContain(
      'services.subconverter.image.digest must be a sha256 digest',
    );

    const missingPlatform = cloneLock();
    delete missingPlatform.services.subconverter.image.platforms['linux/arm64'];
    expect(validateVersionLocks(missingPlatform)).toContain(
      'services.subconverter.image.platforms.linux/arm64 must be a sha256 digest',
    );
  });

  it('rejects runtime image drift and non-canonical timestamps', () => {
    const runtimeImages = cloneLock();
    delete runtimeImages.services.gatewayBase.runtimeImages.distroless;
    expect(validateVersionLocks(runtimeImages)).toContain(runtimeImageError);

    const schema = cloneLock();
    schema.schemaVersion = 2;
    expect(validateVersionLocks(schema)).toContain('schemaVersion must equal 1');

    const verifiedAt = cloneLock();
    verifiedAt.verifiedAt = '2026-10-17 16:23:31';
    expect(validateVersionLocks(verifiedAt)).toContain(verifiedAtError);
  });
});

describe('runtime image contract', () => {
  it('derives exactly the runtime images required by Compose', () => {
    const images = resolveRuntimeImages(lock);
    expect(Object.keys(images)).toEqual(['SUBCONVERTER_IMAGE']);
    expect(images.SUBCONVERTER_IMAGE).toMatch(
      /^ghcr\.io\/aethersailor\/subconverter-extended:v1\.9\.4@sha256:[0-9a-f]{64}$/u,
    );
    expect(renderRuntimeImageEnv(images)).toBe(`SUBCONVERTER_IMAGE=${images.SUBCONVERTER_IMAGE}\n`);
  });

  it('rejects runtime environments outside the exact contract', () => {
    const images = resolveRuntimeImages(lock);
    expect(() => renderRuntimeImageEnv({ ...images, REDIS_IMAGE: images.SUBCONVERTER_IMAGE })).toThrow(
      /exactly: SUBCONVERTER_IMAGE/u,
    );
    expect(() => renderRuntimeImageEnv({})).toThrow(/exactly: SUBCONVERTER_IMAGE/u);
    expect(() =>
      renderRuntimeImageEnv({ SUBCONVERTER_IMAGE: 'ghcr.io/aethersailor/subconverter-extended:v1.9.4' }),
    ).toThrow(/immutable sha256 image reference/u);
    expect(() =>
      renderRuntimeImageEnv({ SUBCONVERTER_IMAGE: `${images.SUBCONVERTER_IMAGE}\nREDIS_IMAGE=x` }),
    ).toThrow(/immutable sha256 image reference/u);
  });

  it('derives rollback images only for services that remain deployed', () => {
    expect(runtimeImagesForRollback(lock)).toEqual({
      subconverter: {
        reference: resolveRuntimeImages(lock).SUBCONVERTER_IMAGE,
        digest: lock.services.subconverter.image.digest,
        platforms: lock.services.subconverter.image.platforms,
      },
    });
  });

  it('refuses to derive runtime images from an invalid lock', () => {
    const invalid = cloneLock();
    delete invalid.services.subconverter;
    expect(() => resolveRuntimeImages(invalid)).toThrow(/Version locks are invalid/u);
    expect(() => runtimeImagesForRollback(invalid)).toThrow(/Version locks are invalid/u);
  });
});

describe('version lock CLI', () => {
  it('accepts the checked-in lock', () => {
    const result = runValidatorCli(lockPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Version locks are valid.');
  });

  it('exits unsuccessfully and prints every validation error', async () => {
    const invalid = cloneLock();
    delete invalid.services.subconverter;
    const invalidPath = await writeLock('invalid-lock.json', invalid);
    const result = runValidatorCli(invalidPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(inventoryError);
  });

  it('renders and verifies rollback data through the CLI', () => {
    const env = runRuntimeContractCli('env', lockPath);
    expect(env.status).toBe(0);
    expect(env.stdout).toBe(`SUBCONVERTER_IMAGE=${resolveRuntimeImages(lock).SUBCONVERTER_IMAGE}\n`);

    const rollback = runRuntimeContractCli('rollback', lockPath);
    expect(rollback.status).toBe(0);
    expect(JSON.parse(rollback.stdout)).toEqual(runtimeImagesForRollback(lock));
  });
});
