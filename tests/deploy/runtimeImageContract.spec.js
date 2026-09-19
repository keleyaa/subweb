import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  renderRuntimeImageEnv,
  resolveRuntimeImages,
  runtimeImagesForRollback,
} from '../../scripts/runtime-image-contract.mjs';

const lockPath = fileURLToPath(
  new URL('../../deploy/versions.lock.json', import.meta.url),
);
const runtimeContractPath = fileURLToPath(
  new URL('../../scripts/runtime-image-contract.mjs', import.meta.url),
);
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const immutableImageReferencePattern = /^[^@\s]+@sha256:[0-9a-f]{64}$/u;
const runtimeImageVariableNames = [
  'REDIS_IMAGE',
  'SUBCONVERTER_IMAGE',
  'MYURLS_IMAGE',
];

let temporaryDirectory;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'subweb-runtime-image-contract-'));
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const runRuntimeContractCli = (argumentsList) =>
  spawnSync(process.execPath, [runtimeContractPath, ...argumentsList], {
    encoding: 'utf8',
  });

const validCustomLock = () => {
  const candidate = structuredClone(lock);
  candidate.services.myurls.source.tag = 'v2.1.0';
  candidate.services.myurls.image.reference = 'ghcr.io/keleyaa/myurls:v2.1.0';
  candidate.services.myurls.image.digest = `sha256:${'a'.repeat(64)}`;
  return candidate;
};

describe('runtime image contract', () => {
  it.each([
    [
      'an image reference with trailing whitespace',
      (candidate) => {
        candidate.services.subconverter.image.reference += ' ';
      },
      'services.subconverter.image.reference must be a valid tagged OCI/Docker reference',
    ],
    [
      'an image reference with a control character',
      (candidate) => {
        candidate.services.subconverter.image.reference += '\u001f';
      },
      'services.subconverter.image.reference must be a valid tagged OCI/Docker reference',
    ],
  ])('rejects a lock containing %s before producing any runtime image output', (
    _scenario,
    mutate,
    expectedError,
  ) => {
    const candidate = structuredClone(lock);
    mutate(candidate);

    expect(() => resolveRuntimeImages(candidate)).toThrow(expectedError);
    expect(() => runtimeImagesForRollback(candidate)).toThrow(expectedError);
  });

  it('requires exactly the managed runtime environment variable set', () => {
    const images = resolveRuntimeImages(lock);
    const imagesWithoutMyUrls = Object.fromEntries(
      Object.entries(images).filter(([name]) => name !== 'MYURLS_IMAGE'),
    );

    expect(Object.keys(images)).toEqual(runtimeImageVariableNames);
    expect(() => renderRuntimeImageEnv(imagesWithoutMyUrls)).toThrow(
      'Runtime image environment must contain exactly',
    );
  });

  it.each([
    ['trailing whitespace', (image) => `${image} `],
    ['a tab', (image) => `${image}\t`],
    ['a C0 control character', (image) => `${image}\u001f`],
    ['a delete control character', (image) => `${image}\u007f`],
    ['a short digest', (image) => image.replace(/sha256:[0-9a-f]{64}$/u, 'sha256:bad')],
    ['an uppercase digest', (image) => image.replace(/sha256:[0-9a-f]{64}$/u, `sha256:${'A'.repeat(64)}`)],
  ])('rejects a runtime image value containing %s', (_scenario, transform) => {
    const images = resolveRuntimeImages(lock);

    expect(() => renderRuntimeImageEnv({
      ...images,
      MYURLS_IMAGE: transform(images.MYURLS_IMAGE),
    })).toThrow('MYURLS_IMAGE must be an immutable sha256 image reference');
  });

  it('uses the explicit --lock file for environment and rollback output', async () => {
    const customLock = validCustomLock();
    const customLockPath = join(temporaryDirectory, 'custom.lock.json');
    await writeFile(customLockPath, JSON.stringify(customLock));

    const environment = runRuntimeContractCli(['env', '--lock', customLockPath]);
    const rollback = runRuntimeContractCli(['rollback', '--lock', customLockPath]);

    expect(environment.status, environment.stderr).toBe(0);
    expect(environment.stderr).toBe('');
    expect(environment.stdout).toBe(renderRuntimeImageEnv(resolveRuntimeImages(customLock)));
    expect(environment.stdout.trim().split('\n').map((line) => line.split('=', 1)[0])).toEqual(
      runtimeImageVariableNames,
    );

    expect(rollback.status, rollback.stderr).toBe(0);
    expect(rollback.stderr).toBe('');
    expect(JSON.parse(rollback.stdout)).toEqual(runtimeImagesForRollback(customLock));
  });

  it('rejects an invalid explicit --lock file before writing output', async () => {
    const invalidLock = structuredClone(lock);
    invalidLock.services.redis.image.digest = 'sha256:bad';
    const invalidLockPath = join(temporaryDirectory, 'invalid.lock.json');
    await writeFile(invalidLockPath, JSON.stringify(invalidLock));

    const result = runRuntimeContractCli(['env', '--lock', invalidLockPath]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('services.redis.image.digest must be a sha256 digest');
  });

  it('renders a complete rollback payload with immutable image references', () => {
    const rollback = runtimeImagesForRollback(lock);

    expect(Object.keys(rollback).sort()).toEqual(['myurls', 'redis', 'subconverter']);
    for (const [serviceName, image] of Object.entries(rollback)) {
      const sourceImage = lock.services[serviceName].image;

      expect(image.reference).toBe(`${sourceImage.reference}@${sourceImage.digest}`);
      expect(image.reference).toMatch(immutableImageReferencePattern);
      expect(image.digest).toBe(sourceImage.digest);
      expect(image.platforms).toEqual(sourceImage.platforms);
      expect(image.platforms).not.toBe(sourceImage.platforms);
    }
  });
});
