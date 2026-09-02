import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateVersionLocks } from './verify-version-locks.mjs';

const defaultLockPath = fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);
const fullProfile = {
  composeFile: 'compose.yaml',
  services: ['gateway', 'myurls-app', 'myurls-short', 'redis', 'subconverter'],
};
const disabledProfile = {
  composeFile: 'compose.disabled-short-links.yaml',
  services: ['gateway', 'subconverter'],
};

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseArguments = (args) => {
  let profile = fullProfile;
  const lockPaths = [];

  for (const argument of args) {
    if (argument === '--short-links-disabled') {
      profile = disabledProfile;
    } else if (argument.startsWith('-')) {
      return { error: `Unknown option: ${argument}` };
    } else {
      lockPaths.push(argument);
    }
  }

  if (lockPaths.length > 1) {
    return { error: 'Expected at most one version-lock path.' };
  }

  return { lockPath: lockPaths[0] ?? defaultLockPath, profile };
};

const serviceNames = (compose) => {
  const services = [];
  let inServices = false;

  for (const line of compose.split('\n')) {
    if (line === 'services:') {
      inServices = true;
      continue;
    }
    if (inServices && /^[A-Za-z][A-Za-z0-9_-]*:$/.test(line)) break;

    const match = inServices && line.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):$/u);
    if (match) services.push(match[1]);
  }

  return services.sort();
};

const dockerfileReference = (reference) =>
  reference.replace(/^docker\.io\/library\//u, '');

const imageReference = (image) => `${image.reference}@${image.digest}`;

const checkContains = (content, value, label, errors) => {
  if (!content.includes(value)) errors.push(`${label} is missing ${value}`);
};

const verifyDockerfile = (dockerfile, lock, errors) => {
  const gateway = lock.services?.gatewayBase;
  if (!isRecord(gateway)) return;

  const frontend = gateway.runtimeImages?.frontend;
  const distroless = gateway.runtimeImages?.distroless;
  const images = [gateway.image, frontend, distroless];

  for (const image of images) {
    if (!isRecord(image)) continue;
    checkContains(
      dockerfile,
      `FROM ${dockerfileReference(image.reference)}@${image.digest}`,
      'Dockerfile',
      errors,
    );
  }
};

const verifyCompose = (compose, profile, lock, errors) => {
  const actualServices = serviceNames(compose);
  const expectedServices = [...profile.services].sort();
  if (JSON.stringify(actualServices) !== JSON.stringify(expectedServices)) {
    errors.push(
      `${profile.composeFile} services must equal ${expectedServices.join(', ')}`,
    );
  }

  checkContains(compose, 'dockerfile: Dockerfile', profile.composeFile, errors);
  checkContains(
    compose,
    '"127.0.0.1:${SUBWEB_PORT:-18080}:8080"',
    profile.composeFile,
    errors,
  );
  checkContains(
    compose,
    'EGRESS_LISTEN_ADDR: "0.0.0.0:25502"',
    profile.composeFile,
    errors,
  );
  checkContains(
    compose,
    'HTTPS_PROXY: http://gateway:25502',
    profile.composeFile,
    errors,
  );
  checkContains(compose, 'subconverter-egress:', profile.composeFile, errors);

  const subconverter = lock.services?.subconverter?.image;
  if (isRecord(subconverter)) {
    checkContains(
      compose,
      imageReference(subconverter),
      profile.composeFile,
      errors,
    );
  }

  if (profile === disabledProfile) {
    for (const privateSetting of [
      'MYURLS_',
      'REDIS_',
      'TURNSTILE_SECRET_KEY',
      'SHORT_DOMAIN',
    ]) {
      if (compose.includes(privateSetting)) {
        errors.push(
          `${profile.composeFile} must not require ${privateSetting} when short links are disabled`,
        );
      }
    }
    return;
  }

  for (const requiredNetwork of ['myurls-data:', 'myurls-edge:', 'redis-policy:']) {
    checkContains(compose, requiredNetwork, profile.composeFile, errors);
  }

  const redis = lock.services?.redis?.image;
  const myurls = lock.services?.myurls?.image;
  for (const image of [redis, myurls]) {
    if (isRecord(image)) {
      checkContains(
        compose,
        imageReference(image),
        profile.composeFile,
        errors,
      );
    }
  }

  for (const requiredSetting of [
    'MYURLS_APP_UPSTREAM: http://myurls-app-edge:3000',
    'MYURLS_SHORT_UPSTREAM: http://myurls-short-edge:3000',
    'REDIS_URL: redis://redis:6379/1',
    'SHORT_DOMAIN:',
  ]) {
    checkContains(compose, requiredSetting, profile.composeFile, errors);
  }
};

async function runCli() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.error) {
    console.error(`Production readiness blocked: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }

  let lock;
  let dockerfile;
  let compose;
  try {
    [lock, dockerfile, compose] = await Promise.all([
      readFile(parsed.lockPath, 'utf8').then(JSON.parse),
      readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
      readFile(new URL(`../${parsed.profile.composeFile}`, import.meta.url), 'utf8'),
    ]);
  } catch (error) {
    console.error(`Production readiness blocked: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = validateVersionLocks(lock);
  verifyDockerfile(dockerfile, lock, errors);
  verifyCompose(compose, parsed.profile, lock, errors);

  if (errors.length > 0) {
    console.error('Production readiness blocked: unified deployment contract is invalid.');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Production readiness unified lock gate passed (${parsed.profile.composeFile}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli();
}
