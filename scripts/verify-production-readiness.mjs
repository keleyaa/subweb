import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRuntimeImages } from './runtime-image-contract.mjs';
import { validateVersionLocks } from './verify-version-locks.mjs';

const defaultLockPath = process.env.VERSION_LOCK_FILE || fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);
const fullProfile = {
  composeFile: 'compose.yaml',
  services: ['gateway', 'subconverter'],
  shortLinksEnabled: true,
};
const disabledProfile = {
  composeFile: 'compose.disabled-short-links.yaml',
  services: ['gateway', 'subconverter'],
  shortLinksEnabled: false,
};
const readinessGatewayImage = 'subweb:readiness@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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


const readinessEnvironment = (profile, lock) => ({
  APP_DOMAIN: 'app.readiness.test',
  API_DOMAIN: 'api.readiness.test',
  API_URL: 'https://api.readiness.test',
  CUSTOM_BACKEND_ENABLED: 'true',
  IP_HASH_SECRET: 'readiness-hash-placeholder',
  SHORT_DOMAIN: 'short.readiness.test',
  SHORT_LINKS_ENABLED: String(profile.shortLinksEnabled),
  SUBWEB_IMAGE: readinessGatewayImage,
  TURNSTILE_SECRET_KEY: 'testing-only-placeholder',
  TURNSTILE_SITE_KEY: 'readiness-turnstile-site-key',
  ...resolveRuntimeImages(lock),
});

const dockerConnectionEnvironmentNames = [
  'DOCKER_API_VERSION', 'DOCKER_CERT_PATH', 'DOCKER_CONFIG', 'DOCKER_CONTEXT',
  'DOCKER_HOST', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'HOME', 'PATH', 'SSH_AUTH_SOCK',
  'TMPDIR',
];

const controlledEnvironment = () => Object.fromEntries(
  dockerConnectionEnvironmentNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);

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

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`docker compose config returned invalid JSON: ${error.message}`, { cause: error });
  }
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

const allowedServiceFields = {
  gateway: new Set([
    'build', 'cap_drop', 'command', 'depends_on', 'entrypoint', 'environment',
    'healthcheck', 'image', 'logging', 'networks', 'ports', 'read_only',
    'restart', 'security_opt', 'stop_grace_period', 'user', 'volumes',
  ]),
  subconverter: new Set([
    'cap_add', 'cap_drop', 'command', 'depends_on', 'entrypoint', 'environment',
    'healthcheck', 'image', 'logging', 'networks', 'read_only', 'restart',
    'security_opt', 'stop_grace_period', 'tmpfs', 'user', 'volumes',
  ]),
};

const allowedEnvironmentNames = {
  gateway: new Set([
    'API_DOMAIN', 'API_URL', 'APP_DOMAIN', 'CONVERSION_DNS_TIMEOUT_MS',
    'CONVERSION_EGRESS_CONNECT_TIMEOUT_MS', 'CONVERSION_MAX_CONCURRENCY',
    'CONVERSION_MAX_CONCURRENCY_PER_IP', 'CONVERSION_MAX_REQUEST_BYTES',
    'CONVERSION_MAX_RESPONSE_BYTES', 'CONVERSION_RATE_LIMIT',
    'CONVERSION_RATE_WINDOW_SECONDS', 'CONVERSION_REQUEST_TIMEOUT_MS',
    'CUSTOM_BACKEND_ENABLED', 'EGRESS_ALLOWED_HOSTS', 'EGRESS_LISTEN_ADDR',
    'EGRESS_RESTRICTED_LISTEN_ADDR', 'IP_HASH_SECRET', 'LISTEN_ADDR',
    'LOG_LEVEL', 'SHORT_DOMAIN', 'SHORT_LINKS_ENABLED', 'SHORT_LINK_DB_PATH',
    'SHORT_LINK_TTL_SECONDS', 'SHORT_LINK_CREATE_LIMIT_10M',
    'SHORT_LINK_DAILY_LIMIT', 'SHORT_LINK_RESOLVE_LIMIT_10S',
    'SUBCONVERTER_UPSTREAM', 'TRUSTED_PROXY_CIDR', 'TURNSTILE_ENABLED',
    'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_TIMEOUT_MS', 'TZ',
  ]),
  subconverter: new Set([
    'HTTPS_PROXY', 'MANAGED_CONFIG_PREFIX', 'NO_PROXY',
    'SUBCONVERTER_ALLOW_PUBLIC_UPLOAD', 'SUBCONVERTER_SECURITY_PROFILE', 'TZ',
    'https_proxy', 'no_proxy',
  ]),
};

const dependsOn = (service, dependency) => {
  const dependencies = service?.depends_on;
  if (Array.isArray(dependencies)) return dependencies.includes(dependency) ? {} : undefined;
  return isRecord(dependencies) ? dependencies[dependency] : undefined;
};

const expectedNetworks = () => ({
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
      && gateway.ports[0].host_ip === '127.0.0.1'
      && Number(gateway.ports[0].target) === 8080
      && /^\d+$/u.test(String(gateway.ports[0].published))
      && Number(gateway.ports[0].published) >= 1
      && Number(gateway.ports[0].published) <= 65_535,
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
      gateway?.image === environment.SUBWEB_IMAGE,
      'gateway must use the generated SUBWEB_IMAGE',
      errors,
    );
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

  const authorizedSubconverterCapabilities = ['CHOWN', 'SETGID', 'SETUID'];
  for (const [serviceName, networks] of Object.entries(expectedNetworks())) {
    const service = services[serviceName];
    const unexpectedFields = Object.keys(service ?? {}).filter(
      (field) => !allowedServiceFields[serviceName]?.has(field),
    );
    check(
      unexpectedFields.length === 0,
      `${serviceName} has unsupported service fields: ${unexpectedFields.join(', ')}`,
      errors,
    );
    const environment = isRecord(service?.environment) ? service.environment : {};
    const unexpectedEnvironmentNames = Object.keys(environment).filter(
      (name) => !allowedEnvironmentNames[serviceName]?.has(name),
    );
    check(
      unexpectedEnvironmentNames.length === 0,
      `${serviceName} has unsupported environment entries: ${unexpectedEnvironmentNames.join(', ')}`,
      errors,
    );
    const capabilities = Array.isArray(service?.cap_add) ? [...service.cap_add].sort() : [];
    const isAuthorizedSubconverterBootstrap = serviceName === 'subconverter'
      && service?.user === '0:0'
      && JSON.stringify(capabilities) === JSON.stringify(authorizedSubconverterCapabilities);
    check(
      capabilities.length === 0 || isAuthorizedSubconverterBootstrap,
      `${serviceName} has unapproved capabilities`,
      errors,
    );
    check(
      serviceName === 'subconverter'
        ? service?.user === '0:0'
        : /^[1-9][0-9]*:[1-9][0-9]*$/u.test(String(service?.user ?? '')),
      `${serviceName} runtime user is invalid`,
      errors,
    );
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
  const internalNetworks = ['subconverter-egress'];
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
      environmentValue(gateway, 'SHORT_LINK_DB_PATH') === '/data/links.db',
      'gateway short-link database path is invalid',
      errors,
    );
    check(
      environmentValue(gateway, 'TURNSTILE_ENABLED') === 'true',
      'gateway Turnstile must be enabled',
      errors,
    );
    if (isRecord(environment)) {
      check(
        environmentValue(gateway, 'TURNSTILE_SITE_KEY') === environment.TURNSTILE_SITE_KEY,
        'gateway Turnstile site key must match the generated environment',
        errors,
      );
      check(
        environmentValue(gateway, 'TURNSTILE_SECRET_KEY') === environment.TURNSTILE_SECRET_KEY,
        'gateway Turnstile secret key must match the generated environment',
        errors,
      );
    }
    check(
      environmentValue(gateway, 'EGRESS_RESTRICTED_LISTEN_ADDR') === '0.0.0.0:25503',
      'gateway restricted egress listener is invalid',
      errors,
    );
    check(
      environmentValue(gateway, 'MYURLS_UPSTREAM') === undefined
        && environmentValue(gateway, 'REDIS_URL') === undefined,
      'the embedded profile must not configure MyUrls or Redis',
      errors,
    );
    const gatewayVolumes = Array.isArray(gateway?.volumes) ? gateway.volumes : [];
    check(
      gatewayVolumes.some((volume) => (isRecord(volume)
        ? volume.source === 'links-data'
        : String(volume).startsWith('links-data:'))),
      'gateway must mount the links-data volume',
      errors,
    );
  } else {
    for (const name of [
      'EGRESS_RESTRICTED_LISTEN_ADDR', 'IP_HASH_SECRET', 'SHORT_DOMAIN',
      'SHORT_LINK_DB_PATH', 'TURNSTILE_ENABLED', 'TURNSTILE_SECRET_KEY',
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
