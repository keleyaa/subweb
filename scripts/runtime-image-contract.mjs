import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateVersionLocks } from './verify-version-locks.mjs';

const runtimeImageServices = [
  ['REDIS_IMAGE', 'redis'],
  ['SUBCONVERTER_IMAGE', 'subconverter'],
  ['MYURLS_IMAGE', 'myurls'],
];
const runtimeImageVariableNames = runtimeImageServices.map(([variable]) => variable);
const immutableImageReferencePattern = /^[^@\s]+@sha256:[0-9a-f]{64}$/u;
const containsControlCharacter = (value) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 0x20 || codePoint === 0x7f;
  });

const defaultLockPath = fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validatedLock = (lock) => {
  const errors = validateVersionLocks(lock);
  if (errors.length > 0) {
    throw new Error(`Version locks are invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }

  return lock;
};

const immutableImageReference = (image) => `${image.reference}@${image.digest}`;

export function resolveRuntimeImages(lock) {
  const services = validatedLock(lock).services;

  return Object.fromEntries(
    runtimeImageServices.map(([variable, service]) => [
      variable,
      immutableImageReference(services[service].image),
    ]),
  );
}

export function renderRuntimeImageEnv(images) {
  if (
    !isRecord(images) ||
    JSON.stringify(Object.keys(images).sort()) !==
      JSON.stringify([...runtimeImageVariableNames].sort())
  ) {
    throw new Error(
      `Runtime image environment must contain exactly: ${runtimeImageVariableNames.join(', ')}`,
    );
  }

  return `${runtimeImageServices
    .map(([variable]) => {
      const image = images[variable];
      if (
        typeof image !== 'string' ||
        containsControlCharacter(image) ||
        !immutableImageReferencePattern.test(image)
      ) {
        throw new Error(`${variable} must be an immutable sha256 image reference`);
      }
      return `${variable}=${image}`;
    })
    .join('\n')}\n`;
}

export function runtimeImagesForRollback(lock) {
  const services = validatedLock(lock).services;

  return Object.fromEntries(
    runtimeImageServices.map(([, service]) => {
      const image = services[service].image;
      return [
        service,
        {
          reference: image.reference,
          digest: image.digest,
          platforms: { ...image.platforms },
        },
      ];
    }),
  );
}

const usage = () => {
  console.error('Usage: node scripts/runtime-image-contract.mjs <env|rollback> [--lock path]');
};

const parseArguments = (argumentsList) => {
  const [command, ...options] = argumentsList;
  if (command !== 'env' && command !== 'rollback') return null;

  let lockPath = defaultLockPath;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== '--lock' || index + 1 >= options.length) return null;
    lockPath = options[index + 1];
    index += 1;
  }

  return { command, lockPath };
};

const runCli = async () => {
  const argumentsResult = parseArguments(process.argv.slice(2));
  if (!argumentsResult) {
    usage();
    process.exitCode = 1;
    return;
  }

  let lock;
  try {
    lock = JSON.parse(await readFile(argumentsResult.lockPath, 'utf8'));
  } catch (error) {
    console.error(`Unable to read version locks: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    if (argumentsResult.command === 'env') {
      process.stdout.write(renderRuntimeImageEnv(resolveRuntimeImages(lock)));
    } else {
      process.stdout.write(`${JSON.stringify(runtimeImagesForRollback(lock))}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
};

const isCliInvocation = async () => {
  if (!process.argv[1]) return false;

  try {
    const [modulePath, invokedPath] = await Promise.all([
      realpath(fileURLToPath(import.meta.url)),
      realpath(process.argv[1]),
    ]);
    return modulePath === invokedPath;
  } catch {
    return false;
  }
};

if (await isCliInvocation()) {
  await runCli();
}
