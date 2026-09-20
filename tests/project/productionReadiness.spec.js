import fs from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  dockerComposeConfigTimeoutMs,
  runDockerComposeConfig,
  verifyRenderedCompose,
} from '../../scripts/verify-production-readiness.mjs';
import { resolveRuntimeImages } from '../../scripts/runtime-image-contract.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'scripts/verify-production-readiness.mjs');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'deploy/versions.lock.json'), 'utf8'));
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
const generatedEnvironment = {
  SUBWEB_IMAGE: 'subweb:readiness@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  MYURLS_IMAGE: resolveRuntimeImages(lock).MYURLS_IMAGE,
  REDIS_IMAGE: resolveRuntimeImages(lock).REDIS_IMAGE,
  SUBCONVERTER_IMAGE: resolveRuntimeImages(lock).SUBCONVERTER_IMAGE,
  TURNSTILE_SECRET_KEY: 'testing-only-placeholder',
  TURNSTILE_SITE_KEY: 'readiness-turnstile-site-key',
};

const secureService = (service) => ({
  read_only: true,
  cap_drop: ['ALL'],
  security_opt: ['no-new-privileges:true'],
  ...service,
});

const renderedProfile = (profile) => {
  const images = resolveRuntimeImages(lock);
  const gateway = secureService({
    user: '65532:65532',
    build: { dockerfile: 'Dockerfile' },
    image: generatedEnvironment.SUBWEB_IMAGE,
    ports: [{ host_ip: '127.0.0.1', published: 18080, target: 8080 }],
    networks: profile.shortLinksEnabled
      ? { default: {}, 'myurls-edge': {}, 'redis-policy': {}, 'subconverter-egress': {} }
      : { default: {}, 'subconverter-egress': {} },
    environment: profile.shortLinksEnabled
      ? {
        EGRESS_LISTEN_ADDR: '0.0.0.0:25502',
        EGRESS_RESTRICTED_LISTEN_ADDR: '0.0.0.0:25503',
        SHORT_LINKS_ENABLED: 'true',
        APP_DOMAIN: 'app.example.test',
        SHORT_DOMAIN: 'short.example.test',
        MYURLS_UPSTREAM: 'http://myurls-edge:3000',
        REDIS_URL: 'redis://redis:6379/1',
      }
      : { EGRESS_LISTEN_ADDR: '0.0.0.0:25502', SHORT_LINKS_ENABLED: 'false' },
  });
  const services = profile.shortLinksEnabled
    ? {
      gateway,
      myurls: secureService({
        user: '10001:10001',
        image: images.MYURLS_IMAGE,
        networks: { 'myurls-data': {}, 'myurls-edge': {} },
        environment: {
          HTTPS_PROXY: 'http://gateway:25503',
          PUBLIC_BASE_URL: 'https://short.example.test',
          REDIS_URL: 'redis://redis:6379/0',
          TURNSTILE_ENABLED: 'true',
          TURNSTILE_MODE: 'cloudflare',
          TURNSTILE_SITE_KEY: generatedEnvironment.TURNSTILE_SITE_KEY,
          TURNSTILE_SECRET_KEY: generatedEnvironment.TURNSTILE_SECRET_KEY,
          TURNSTILE_HOSTNAME: 'app.example.test',
        },
      }),
      redis: secureService({
        user: '999:999',
        image: images.REDIS_IMAGE,
        networks: { 'myurls-data': {}, 'redis-policy': {} },
      }),
      subconverter: secureService({
        user: '0:0',
        cap_add: ['CHOWN', 'SETGID', 'SETUID'],
        image: images.SUBCONVERTER_IMAGE,
        networks: { 'subconverter-egress': {} },
        environment: { HTTPS_PROXY: 'http://gateway:25502' },
        depends_on: { gateway: { condition: 'service_healthy', restart: true } },
      }),
    }
    : {
      gateway,
      subconverter: secureService({
        user: '0:0',
        cap_add: ['CHOWN', 'SETGID', 'SETUID'],
        image: images.SUBCONVERTER_IMAGE,
        networks: { 'subconverter-egress': {} },
        environment: { HTTPS_PROXY: 'http://gateway:25502' },
        depends_on: { gateway: { condition: 'service_healthy', restart: true } },
      }),
    };

  return {
    services,
    networks: profile.shortLinksEnabled
      ? {
        'myurls-data': { internal: true },
        'myurls-edge': { internal: true },
        'redis-policy': { internal: true },
        'subconverter-egress': { internal: true },
      }
      : { 'subconverter-egress': { internal: true } },
  };
};

const withServiceImage = (rendered, serviceName, image) => ({
  ...rendered,
  services: {
    ...rendered.services,
    [serviceName]: { ...rendered.services[serviceName], image },
  },
});

const withEnvironmentValue = (rendered, serviceName, name, value) => ({
  ...rendered,
  services: {
    ...rendered.services,
    [serviceName]: {
      ...rendered.services[serviceName],
      environment: { ...rendered.services[serviceName].environment, [name]: value },
    },
  },
});

const withDependsOn = (rendered, serviceName, dependsOn) => ({
  ...rendered,
  services: {
    ...rendered.services,
    [serviceName]: { ...rendered.services[serviceName], depends_on: dependsOn },
  },
});

const renderedErrors = (rendered, profile) => {
  const errors = [];
  verifyRenderedCompose(rendered, profile, lock, errors, generatedEnvironment);
  return errors;
};

const createDockerConfigStub = async (directory, renderedByComposeFile) => {
  const dockerPath = path.join(directory, 'docker');
  const expectedEnvironment = Object.entries(generatedEnvironment)
    .map(([name, value]) => `${name}=${value}`);
  const source = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const argumentsList = process.argv.slice(2);
const forbiddenNames = ${JSON.stringify(Object.keys(generatedEnvironment))};
for (const name of forbiddenNames) {
  if (process.env[name] !== undefined) {
    console.error('inherited environment was passed to docker: ' + name);
    process.exit(41);
  }
}
const envFile = argumentsList[argumentsList.indexOf('--env-file') + 1];
const composeFile = argumentsList[argumentsList.indexOf('-f') + 1];
const content = readFileSync(envFile, 'utf8');
for (const entry of ${JSON.stringify(expectedEnvironment)}) {
  if (!content.includes(entry + '\\n')) {
    console.error('generated environment is missing ' + entry);
    process.exit(42);
  }
}
const rendered = ${JSON.stringify(renderedByComposeFile)};
if (rendered[composeFile] === undefined) {
  console.error('unexpected Compose file: ' + composeFile);
  process.exit(43);
}
process.stdout.write(JSON.stringify(rendered[composeFile]));
`;

  await writeFile(dockerPath, source);
  await chmod(dockerPath, 0o755);
};

const runVerifier = (args, environment) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8',
  env: environment,
});

describe('production readiness verifier', () => {
  it.each([
    [
      'MyUrls Turnstile enabled flag',
      (rendered) => withEnvironmentValue(rendered, 'myurls', 'TURNSTILE_ENABLED', 'false'),
      'MyUrls Turnstile must be enabled',
    ],
    [
      'MyUrls Turnstile mode',
      (rendered) => withEnvironmentValue(rendered, 'myurls', 'TURNSTILE_MODE', 'managed'),
      'MyUrls Turnstile mode must be cloudflare',
    ],
    [
      'MyUrls Turnstile site key',
      (rendered) => withEnvironmentValue(rendered, 'myurls', 'TURNSTILE_SITE_KEY', 'wrong-site-key'),
      'MyUrls Turnstile site key must match the generated environment',
    ],
    [
      'MyUrls Turnstile secret key',
      (rendered) => withEnvironmentValue(rendered, 'myurls', 'TURNSTILE_SECRET_KEY', 'wrong-secret-key'),
      'MyUrls Turnstile secret key must match the generated environment',
    ],
    [
      'SubConverter Gateway health dependency',
      (rendered) => withDependsOn(rendered, 'subconverter', { gateway: { condition: 'service_started' } }),
      'SubConverter must depend on a healthy Gateway',
    ],
    [
      'Gateway to SubConverter dependency',
      (rendered) => withDependsOn(rendered, 'gateway', { subconverter: { condition: 'service_healthy' } }),
      'gateway must not depend on SubConverter',
    ],
  ])('rejects rendered %s drift', (_name, drift, expectedError) => {
    expect(renderedErrors(renderedProfile(fullProfile), fullProfile)).toEqual([]);
    expect(renderedErrors(drift(renderedProfile(fullProfile)), fullProfile)).toContain(expectedError);
  });

  it.each([
    ['enabled', fullProfile],
    ['disabled', disabledProfile],
  ])(
    'rejects a mutable rendered gateway image for the %s profile',
    (_name, profile) => {
      expect(renderedErrors(renderedProfile(profile), profile)).toEqual([]);
      expect(
        renderedErrors(
          withServiceImage(renderedProfile(profile), 'gateway', 'subweb:latest'),
          profile,
        ),
      ).toContain('gateway must use the generated SUBWEB_IMAGE');
    },
  );

  it.each([
    ['enabled profile', [], fullProfile],
    ['disabled profile', ['--short-links-disabled'], disabledProfile],
  ])('executes docker compose rendering for the %s with an isolated generated environment', async (_name, args, profile) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'subweb-readiness-test-'));
    const renderedByComposeFile = {
      [fullProfile.composeFile]: renderedProfile(fullProfile),
      [disabledProfile.composeFile]: renderedProfile(disabledProfile),
    };

    try {
      await createDockerConfigStub(directory, renderedByComposeFile);
      const result = runVerifier(args, {
        ...process.env,
        MYURLS_IMAGE: 'untrusted-myurls-image',
        REDIS_IMAGE: 'untrusted-redis-image',
        SUBCONVERTER_IMAGE: 'untrusted-subconverter-image',
        TURNSTILE_SECRET_KEY: 'untrusted-turnstile-secret',
        TURNSTILE_SITE_KEY: 'untrusted-turnstile-site-key',
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
      });

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `Production readiness unified lock gate passed (${profile.composeFile}).`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when docker compose config exits nonzero', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'subweb-readiness-test-'));
    const dockerPath = path.join(directory, 'docker');

    try {
      await writeFile(dockerPath, '#!/bin/sh\necho invalid Compose file >&2\nexit 17\n');
      await chmod(dockerPath, 0o755);
      const result = runVerifier([], {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'docker compose config failed with exit status 17: invalid Compose file',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing published host port', undefined],
    ['ephemeral published host port', ''],
    ['zero published host port', 0],
    ['out-of-range published host port', 65_536],
    ['non-numeric published host port', 'auto'],
  ])('rejects a rendered gateway with %s', (_name, published) => {
    const rendered = renderedProfile(fullProfile);
    rendered.services.gateway.ports = [{ host_ip: '127.0.0.1', published, target: 8080 }];

    expect(renderedErrors(rendered, fullProfile)).toContain('gateway must publish only loopback port 8080');
  });

  it('fails closed when docker compose config returns invalid JSON', () => {
    const spawn = () => ({ status: 0, stdout: 'not JSON' });

    expect(() => runDockerComposeConfig(spawn, {
      composeFile: fullProfile.composeFile,
      cwd: root,
      envFile: '/tmp/subweb-compose.env',
      environment: {},
    })).toThrow('docker compose config returned invalid JSON');
  });

  it('fails closed when docker compose config times out', () => {
    const spawn = () => ({
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
      status: null,
    });

    expect(() => runDockerComposeConfig(spawn, {
      composeFile: fullProfile.composeFile,
      cwd: root,
      envFile: '/tmp/subweb-compose.env',
      environment: {},
    })).toThrow(`docker compose config timed out after ${dockerComposeConfigTimeoutMs}ms`);
  });
});
