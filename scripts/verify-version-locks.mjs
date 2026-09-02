import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const sourceTagPattern = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/;
const registryPattern =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)(?::[1-9][0-9]{0,4})?$/;
const repositoryComponentPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const platformPattern =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const canonicalUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const requiredServices = [
  'gatewayBase',
  'myurls',
  'redis',
  'subconverter',
];
const requiredPlatforms = ['linux/amd64', 'linux/arm64'];
const myurlsSourceRepository = 'keleyaa/MyUrls';
const myurlsImageRepository = 'ghcr.io/keleyaa/myurls';
const myurlsReleaseTagPattern = /^v2\.\d+\.\d+$/u;
const gatewayBaseSourceRepository = 'docker-library/golang';
const gatewayBaseImageReference = 'docker.io/library/golang:1.25-alpine';
const gatewayRuntimeImageNames = ['distroless', 'frontend'];

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCompleteHttpsUrl = (value) => {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
};

const isValidSourceTag = (tag) =>
  typeof tag === 'string' &&
  sourceTagPattern.test(tag) &&
  tag.toLowerCase() !== 'latest';

const isValidWorkflowRelease = (release) =>
  isRecord(release) &&
  release.kind === 'workflow_dispatch' &&
  isValidSourceTag(release.version) &&
  Number.isSafeInteger(release.runId) &&
  release.runId > 0;

const containsWhitespaceOrControl = (value) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return /\s/u.test(character) || codePoint < 32 || codePoint === 127;
  });

const parseTaggedImageReference = (reference) => {
  if (
    typeof reference !== 'string' ||
    reference.includes('@') ||
    containsWhitespaceOrControl(reference)
  ) {
    return null;
  }

  const registrySeparator = reference.indexOf('/');
  if (registrySeparator <= 0 || registrySeparator === reference.length - 1) {
    return null;
  }

  const registry = reference.slice(0, registrySeparator);
  const repositoryAndTag = reference.slice(registrySeparator + 1);
  const tagSeparator = repositoryAndTag.lastIndexOf(':');
  const lastPathSeparator = repositoryAndTag.lastIndexOf('/');
  if (tagSeparator <= lastPathSeparator || tagSeparator === repositoryAndTag.length - 1) {
    return null;
  }

  const repository = repositoryAndTag.slice(0, tagSeparator);
  const tag = repositoryAndTag.slice(tagSeparator + 1);
  const repositoryParts = repository.split('/');

  if (
    !isValidRegistry(registry) ||
    repositoryParts.length === 0 ||
    repositoryParts.some((part) => !repositoryComponentPattern.test(part)) ||
    !tagPattern.test(tag)
  ) {
    return null;
  }

  return { registry, repository, tag };
};

const isValidRegistry = (registry) => {
  if (!registryPattern.test(registry)) return false;
  const portSeparator = registry.lastIndexOf(':');
  if (portSeparator < 0) return true;
  return Number(registry.slice(portSeparator + 1)) <= 65_535;
};

const isCanonicalUtcTimestamp = (value) => {
  if (typeof value !== 'string' || !canonicalUtcPattern.test(value)) {
    return false;
  }

  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.getTime()) &&
    timestamp.toISOString().replace('.000Z', 'Z') === value
  );
};

const validateImageDescriptor = (prefix, image, errors) => {
  if (!isRecord(image)) {
    errors.push(`${prefix} must be an object`);
    return null;
  }

  const parsedReference = parseTaggedImageReference(image.reference);
  if (!parsedReference) {
    errors.push(`${prefix}.reference must be a valid tagged OCI/Docker reference`);
  } else if (parsedReference.tag.toLowerCase() === 'latest') {
    errors.push(`${prefix}.reference must not use latest`);
  }
  if (!digestPattern.test(image.digest ?? '')) {
    errors.push(`${prefix}.digest must be a sha256 digest`);
  }
  if (!isRecord(image.platforms)) {
    errors.push(`${prefix}.platforms must be an object`);
  } else {
    for (const platform of requiredPlatforms) {
      if (!Object.hasOwn(image.platforms, platform)) {
        errors.push(`${prefix}.platforms.${platform} must be a sha256 digest`);
      }
    }
    for (const [platform, digest] of Object.entries(image.platforms)) {
      if (!platformPattern.test(platform)) {
        errors.push(`${prefix}.platforms key ${JSON.stringify(platform)} must be a valid platform name`);
      }
      if (!digestPattern.test(digest ?? '')) {
        errors.push(`${prefix}.platforms.${platform} must be a sha256 digest`);
      }
    }
  }

  return parsedReference;
};

export function validateVersionLocks(lock) {
  const errors = [];

  if (!isRecord(lock)) {
    return ['lock must be a JSON object'];
  }

  if (lock.schemaVersion !== 1) {
    errors.push('schemaVersion must equal 1');
  }

  if (!isCanonicalUtcTimestamp(lock.verifiedAt)) {
    errors.push(
      'verifiedAt must be a canonical UTC timestamp in YYYY-MM-DDTHH:mm:ssZ format',
    );
  }

  if (!isRecord(lock.services)) {
    errors.push('services must be an object');
    return errors;
  }

  const serviceNames = Object.keys(lock.services).sort();
  if (JSON.stringify(serviceNames) !== JSON.stringify(requiredServices)) {
    errors.push(`services must contain exactly: ${requiredServices.join(', ')}`);
  }

  for (const [name, service] of Object.entries(lock.services)) {
    const prefix = `services.${name}`;

    if (!isRecord(service)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const source = service.source;
    if (!isRecord(source)) {
      errors.push(`${prefix}.source must be an object`);
    } else {
      if (!isCompleteHttpsUrl(source.url)) {
        errors.push(`${prefix}.source.url must be a complete HTTPS URL`);
      }
      if (typeof source.repository !== 'string' || source.repository === '') {
        errors.push(`${prefix}.source.repository must be non-empty`);
      }
      if (!isValidSourceTag(source.tag) && !(source.tag === null && isValidWorkflowRelease(source.release))) {
        errors.push(`${prefix}.source.tag must be a valid non-latest source tag`);
      }
      if (!commitPattern.test(source.commit ?? '')) {
        errors.push(`${prefix}.source.commit must be a full 40-character commit`);
      }
      if (source.prerelease !== false) {
        errors.push(`${prefix}.source.prerelease must equal false`);
      }
      if (name === 'myurls') {
        if (source.repository !== myurlsSourceRepository) {
          errors.push(
            `${prefix}.source.repository must equal ${myurlsSourceRepository}`,
          );
        }
        if (!myurlsReleaseTagPattern.test(source.tag ?? '')) {
          errors.push(`${prefix}.source.tag must be a published Rust v2 release tag`);
        }
      }
    }

    const parsedReference = validateImageDescriptor(`${prefix}.image`, service.image, errors);
    if (name === 'myurls' && parsedReference) {
      const imageRepository = `${parsedReference.registry}/${parsedReference.repository}`;
      if (imageRepository !== myurlsImageRepository) {
        errors.push(`${prefix}.image.reference must use ${myurlsImageRepository}`);
      }
      if (parsedReference.tag !== service.source?.tag) {
        errors.push(`${prefix}.image.reference tag must match source.tag`);
      }
    }
    if (name === 'gatewayBase') {
      if (service.source?.repository !== gatewayBaseSourceRepository) {
        errors.push(
          `${prefix}.source.repository must equal ${gatewayBaseSourceRepository}`,
        );
      }
      if (service.image?.reference !== gatewayBaseImageReference) {
        errors.push(`${prefix}.image.reference must use ${gatewayBaseImageReference}`);
      }

      const runtimeImages = service.runtimeImages;
      if (!isRecord(runtimeImages) ||
        JSON.stringify(Object.keys(runtimeImages ?? {}).sort()) !== JSON.stringify(gatewayRuntimeImageNames)) {
        errors.push(
          `${prefix}.runtimeImages must contain exactly: ${gatewayRuntimeImageNames.join(', ')}`,
        );
      } else {
        for (const [runtimeName, runtimeImage] of Object.entries(runtimeImages)) {
          validateImageDescriptor(`${prefix}.runtimeImages.${runtimeName}`, runtimeImage, errors);
        }
      }
    }

    const internalPorts = service.container?.internalPorts;
    if (!Array.isArray(internalPorts) || internalPorts.length === 0) {
      errors.push(`${prefix}.container.internalPorts must be a non-empty array`);
    } else {
      internalPorts.forEach((port, index) => {
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          errors.push(
            `${prefix}.container.internalPorts[${index}] must be an integer from 1 to 65535`,
          );
        }
      });
      if (
        name === 'gatewayBase' &&
        JSON.stringify(internalPorts) !== JSON.stringify([8080, 25502])
      ) {
        errors.push(`${prefix}.container.internalPorts must equal 8080, 25502`);
      }
    }
  }

  return errors;
}

async function runCli() {
  const lockPath =
    process.argv[2] ??
    fileURLToPath(new URL('../deploy/versions.lock.json', import.meta.url));
  let lock;

  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    console.error(`Unable to read version locks: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = validateVersionLocks(lock);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('Version locks are valid.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli();
}
