import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRuntimeImages } from './runtime-image-contract.mjs';
import { validateVersionLocks } from './verify-version-locks.mjs';

const defaultLockPath = fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);
const fullProfile = {
  composeFile: 'compose.yaml',
  services: ['gateway', 'myurls', 'redis', 'subconverter'],
  shortLinksEnabled: true,
};
const disabledProfile = {
  composeFile: 'compose.disabled-short-links.yaml',
  services: ['gateway', 'subconverter'],
  shortLinksEnabled: false,
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

const composeEnvironmentNames = [
  'API_DOMAIN', 'API_URL', 'APP_DOMAIN', 'CONVERSION_DNS_TIMEOUT_MS',
  'CONVERSION_EGRESS_CONNECT_TIMEOUT_MS', 'CONVERSION_MAX_CONCURRENCY',
  'CONVERSION_MAX_CONCURRENCY_PER_IP', 'CONVERSION_MAX_REQUEST_BYTES',
  'CONVERSION_MAX_RESPONSE_BYTES', 'CONVERSION_RATE_LIMIT', 'CONVERSION_RATE_WINDOW_SECONDS',
  'CONVERSION_REQUEST_TIMEOUT_MS', 'CUSTOM_BACKEND_ENABLED', 'EGRESS_ALLOWED_HOSTS',
  'IP_HASH_SECRET', 'LOG_LEVEL', 'MYURLS_GATEWAY_IP', 'MYURLS_IMAGE', 'MYURLS_IP',
  'MYURLS_LOG_LEVEL', 'MYURLS_NETWORK_SUBNET', 'MYURLS_TRUST_PROXY_CIDR', 'REDIS_IMAGE',
  'REDIS_PASSWORD', 'SHORT_DOMAIN', 'SHORT_LINKS_ENABLED', 'SUBCONVERTER_IMAGE',
  'SUBWEB_IMAGE', 'SUBWEB_PORT', 'TRUSTED_PROXY_CIDR', 'TURNSTILE_SECRET_KEY',
  'TURNSTILE_SITE_KEY',
];

const readinessEnvironment = (profile, lock) => ({
  APP_DOMAIN: 'app.readiness.test',
  API_DOMAIN: 'api.readiness.test',
  API_URL: 'https://api.readiness.test',
  CUSTOM_BACKEND_ENABLED: 'true',
  IP_HASH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  REDIS_PASSWORD: 'readiness-redis-password',
  SHORT_DOMAIN: 'short.readiness.test',
  SHORT_LINKS_ENABLED: String(profile.shortLinksEnabled),
  SUBWEB_IMAGE: 'subweb:readiness',
  TURNSTILE_SECRET_KEY: 'readiness-turnstile-secret',
  TURNSTILE_SITE_KEY: 'readiness-turnstile-site-key',
  ...resolveRuntimeImages(lock),
});

const controlledEnvironment = () => {
  const environment = { ...process.env };
  for (const name of composeEnvironmentNames) delete environment[name];
  return environment;
};

export const dockerComposeConfigTimeoutMs = 30_000;

export const runDockerComposeConfig = (spawn, {
  composeFile,
  cwd,
  envFile,
  environment,
}) => {
  const result = spawn(
    'docker',
    ['compose', '-f', composeFile, '--env-file', envFile, 'config', '--format', 'json'],
    {
      cwd,
      encoding: 'utf8',
      env: environment,
      timeout: dockerComposeConfigTimeoutMs,
    },
  );

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`docker compose config timed out after ${dockerComposeConfigTimeoutMs}ms`);
  }
  if (result.error) {
    throw new Error(`unable to start docker compose config: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`docker compose config was terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const status = result.status ?? 'unknown';
    throw new Error(`docker compose config failed with exit status ${status}${stderr ? `: ${stderr}` : ''}`);
  }

  return JSON.parse(result.stdout);
};

const dockerfileReference = (reference) =>
  reference.replace(/^docker\.io\/library\//u, '');

const checkContains = (content, value, label, errors) => {
  if (!content.includes(value)) errors.push(`${label} is missing ${value}`);
};

// exposedPorts reads the single EXPOSE instruction the Gateway image declares.
const exposedPorts = (dockerfile) => {
  const line = dockerfile.split('\n').find((entry) => entry.startsWith('EXPOSE '));
  if (line === undefined) return null;
  return line
    .slice('EXPOSE '.length)
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map(Number);
};

export const verifyDockerfile = (dockerfile, lock, errors) => {
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

  // The lock declares the Gateway's internal port contract, so the built image
  // must declare the same ports or the lock silently stops describing the
  // artifact it locks.
  const internalPorts = gateway.container?.internalPorts;
  if (!Array.isArray(internalPorts)) return;

  const declared = exposedPorts(dockerfile);
  if (declared === null) {
    errors.push('Dockerfile is missing the EXPOSE instruction for the locked internal ports');
    return;
  }
  for (const port of internalPorts) {
    if (!declared.includes(port)) {
      errors.push(`Dockerfile EXPOSE must declare the locked internal port ${port}`);
    }
  }
  for (const port of declared) {
    if (!internalPorts.includes(port)) {
      errors.push(`Dockerfile EXPOSE declares unlocked internal port ${port}`);
    }
  }
};

const check = (condition, message, errors) => {
  if (!condition) errors.push(message);
};

const environmentValue = (service, name) =>
  isRecord(service?.environment) ? service.environment[name] : undefined;

const serviceNetworks = (service) =>
  isRecord(service?.networks) ? Object.keys(service.networks).sort() : [];

const dependsOn = (service, dependency) => {
  const dependencies = service?.depends_on;
  if (Array.isArray(dependencies)) return dependencies.includes(dependency) ? {} : undefined;
  return isRecord(dependencies) ? dependencies[dependency] : undefined;
};

const expectedNetworks = (profile) => (profile.shortLinksEnabled
  ? {
    gateway: ['default', 'myurls-edge', 'redis-policy', 'subconverter-egress'],
    myurls: ['myurls-data', 'myurls-edge'],
    redis: ['myurls-data', 'redis-policy'],
    subconverter: ['subconverter-egress'],
  }
  : {
    gateway: ['default', 'subconverter-egress'],
    subconverter: ['subconverter-egress'],
  });

export const verifyRenderedCompose = (rendered, profile, lock, errors, environment) => {
  const services = isRecord(rendered?.services) ? rendered.services : {};
  const expectedServices = [...profile.services].sort();
  check(
    JSON.stringify(Object.keys(services).sort()) === JSON.stringify(expectedServices),
    `${profile.composeFile} services must equal ${expectedServices.join(', ')}`,
    errors,
  );

  const gateway = services.gateway;
  check(isRecord(gateway), 'gateway service is missing', errors);
  check(gateway?.read_only === true, 'gateway must set read_only to true', errors);
  check(gateway?.build?.dockerfile === 'Dockerfile', 'gateway must use Dockerfile', errors);
  check(
    Array.isArray(gateway?.ports) && gateway.ports.length === 1
      && gateway.ports[0].host_ip === '127.0.0.1' && Number(gateway.ports[0].target) === 8080,
    'gateway must publish only loopback port 8080',
    errors,
  );
  check(
    environmentValue(gateway, 'EGRESS_LISTEN_ADDR') === '0.0.0.0:25502',
    'gateway egress listener is invalid',
    errors,
  );
  check(
    environmentValue(gateway, 'SHORT_LINKS_ENABLED') === String(profile.shortLinksEnabled),
    'gateway short-link profile is invalid',
    errors,
  );
  if (isRecord(environment)) {
    check(
      dependsOn(services.subconverter, 'gateway')?.condition === 'service_healthy',
      'SubConverter must depend on a healthy Gateway',
      errors,
    );
    check(
      dependsOn(gateway, 'subconverter') === undefined,
      'gateway must not depend on SubConverter',
      errors,
    );
  }

  for (const [serviceName, networks] of Object.entries(expectedNetworks(profile))) {
    const service = services[serviceName];
    check(isRecord(service), `${serviceName} service is missing`, errors);
    check(service?.read_only === true, `${serviceName} must set read_only to true`, errors);
    check(
      Array.isArray(service?.cap_drop) && service.cap_drop.includes('ALL'),
      `${serviceName} must drop all capabilities`,
      errors,
    );
    check(
      Array.isArray(service?.security_opt) && service.security_opt.includes('no-new-privileges:true'),
      `${serviceName} must disable privilege escalation`,
      errors,
    );
    check(
      JSON.stringify(serviceNetworks(service)) === JSON.stringify(networks),
      `${serviceName} network membership is invalid`,
      errors,
    );
  }

  const images = resolveRuntimeImages(lock);
  const expectedImages = { subconverter: images.SUBCONVERTER_IMAGE };
  const internalNetworks = profile.shortLinksEnabled
    ? ['myurls-data', 'myurls-edge', 'redis-policy', 'subconverter-egress']
    : ['subconverter-egress'];
  for (const network of internalNetworks) {
    check(rendered?.networks?.[network]?.internal === true, `${network} must be an internal network`, errors);
  }

  if (profile.shortLinksEnabled) {
    const shortDomain = environmentValue(gateway, 'SHORT_DOMAIN');
    const appDomain = environmentValue(gateway, 'APP_DOMAIN');
    check(
      typeof shortDomain === 'string' && shortDomain.length > 0 && shortDomain !== appDomain,
      'gateway SHORT_DOMAIN is invalid',
      errors,
    );
    check(
      environmentValue(gateway, 'REDIS_URL') === 'redis://redis:6379/1',
      'gateway Redis URL must use database 1',
      errors,
    );
    check(
      environmentValue(services.myurls, 'PUBLIC_BASE_URL') === `https://${shortDomain}`,
      'MyUrls public base URL must match gateway SHORT_DOMAIN',
      errors,
    );
    check(
      environmentValue(services.myurls, 'REDIS_URL') === 'redis://redis:6379/0',
      'MyUrls Redis URL must use database 0',
      errors,
    );
    check(
      environmentValue(services.myurls, 'TURNSTILE_HOSTNAME') === appDomain,
      'MyUrls Turnstile hostname must match gateway APP_DOMAIN',
      errors,
    );
    if (isRecord(environment)) {
      check(
        environmentValue(services.myurls, 'TURNSTILE_ENABLED') === 'true',
        'MyUrls Turnstile must be enabled',
        errors,
      );
      check(
        environmentValue(services.myurls, 'TURNSTILE_MODE') === 'cloudflare',
        'MyUrls Turnstile mode must be cloudflare',
        errors,
      );
      check(
        environmentValue(services.myurls, 'TURNSTILE_SITE_KEY') === environment.TURNSTILE_SITE_KEY,
        'MyUrls Turnstile site key must match the generated environment',
        errors,
      );
      check(
        environmentValue(services.myurls, 'TURNSTILE_SECRET_KEY') === environment.TURNSTILE_SECRET_KEY,
        'MyUrls Turnstile secret key must match the generated environment',
        errors,
      );
    }
    expectedImages.myurls = images.MYURLS_IMAGE;
    expectedImages.redis = images.REDIS_IMAGE;
    check(
      environmentValue(gateway, 'EGRESS_RESTRICTED_LISTEN_ADDR') === '0.0.0.0:25503',
      'gateway restricted egress listener is invalid',
      errors,
    );
    check(
      environmentValue(gateway, 'MYURLS_UPSTREAM') === 'http://myurls-edge:3000',
      'gateway MyUrls upstream is invalid',
      errors,
    );
    check(
      environmentValue(services.myurls, 'HTTPS_PROXY') === 'http://gateway:25503',
      'MyUrls egress proxy is invalid',
      errors,
    );
  } else {
    for (const name of [
      'EGRESS_RESTRICTED_LISTEN_ADDR', 'IP_HASH_SECRET', 'MYURLS_UPSTREAM',
      'REDIS_PASSWORD', 'REDIS_URL', 'SHORT_DOMAIN', 'TURNSTILE_SECRET_KEY',
      'TURNSTILE_SITE_KEY',
    ]) {
      check(
        environmentValue(gateway, name) === undefined,
        `disabled short-link profile must not set ${name}`,
        errors,
      );
    }
  }

  for (const [serviceName, image] of Object.entries(expectedImages)) {
    check(services[serviceName]?.image === image, `${serviceName} must use its locked image`, errors);
  }
  check(
    environmentValue(services.subconverter, 'HTTPS_PROXY') === 'http://gateway:25502',
    'SubConverter egress proxy is invalid',
    errors,
  );
};

const renderCompose = async (profile, environment) => {
  const directory = await mkdtemp(join(tmpdir(), 'subweb-readiness-'));
  const envFile = join(directory, 'compose.env');
  await writeFile(
    envFile,
    `${Object.entries(environment).map(([name, value]) => `${name}=${value}`).join('\n')}\n`,
  );

  try {
    return runDockerComposeConfig(spawnSync, {
      composeFile: profile.composeFile,
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      envFile,
      environment: controlledEnvironment(),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
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
  try {
    [lock, dockerfile] = await Promise.all([
      readFile(parsed.lockPath, 'utf8').then(JSON.parse),
      readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
    ]);
  } catch (error) {
    console.error(`Production readiness blocked: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = validateVersionLocks(lock);
  verifyDockerfile(dockerfile, lock, errors);
  if (errors.length > 0) {
    console.error('Production readiness blocked: unified deployment contract is invalid.');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const environment = readinessEnvironment(parsed.profile, lock);
  let rendered;
  try {
    rendered = await renderCompose(parsed.profile, environment);
  } catch (error) {
    console.error(`Production readiness blocked: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  verifyRenderedCompose(rendered, parsed.profile, lock, errors, environment);
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
