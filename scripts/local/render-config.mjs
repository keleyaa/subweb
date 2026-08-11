#!/usr/bin/env node
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const fail = (message) => {
  throw new Error(`Local config error: ${message}`);
};

const parseArguments = () => {
  const allowed = new Set([
    '--project-root',
    '--run-root',
    '--subconverter-source',
    '--nginx-mime-types',
    '--ports-json',
  ]);
  const values = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!allowed.has(key) || value === undefined || Object.hasOwn(values, key)) fail('invalid arguments');
    values[key] = value;
  }
  for (const key of allowed) if (!Object.hasOwn(values, key)) fail(`missing ${key}`);
  return values;
};

const rejectControlCharacters = (value, name) => {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) fail(`${name} contains control characters`);
};

const quoteNginx = (value) => {
  rejectControlCharacters(value, 'Nginx path');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
};

const validateSecret = (value, name) => {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) fail(`${name} must be 64 lowercase hex characters`);
  return value;
};

const validatePorts = (source) => {
  let ports;
  try {
    ports = JSON.parse(source);
  } catch {
    fail('ports JSON is invalid');
  }
  const names = ['vite', 'subconverter', 'myurls', 'redis', 'app', 'api'];
  if (ports === null || Array.isArray(ports) || Object.keys(ports).sort().join(',') !== [...names].sort().join(',')) {
    fail('ports JSON must contain exactly six named ports');
  }
  for (const name of names) {
    if (!Number.isInteger(ports[name]) || ports[name] < 1 || ports[name] > 65535) fail(`${name} port is invalid`);
  }
  if (new Set(Object.values(ports)).size !== names.length) fail('local ports must be unique');
  return ports;
};

const replaceOnce = (source, search, replacement, name) => {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) fail(`${name} marker is missing or duplicated`);
  return source.replace(search, replacement);
};

const updateTomlKey = (source, section, key, serializedValue) => {
  const lines = source.split(/\r?\n/);
  let currentSection = '';
  let replacements = 0;
  const output = lines.map((line) => {
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (sectionMatch) currentSection = sectionMatch[1];
    if (currentSection === section && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replacements += 1;
      return `${key} = ${serializedValue}`;
    }
    return line;
  });
  if (replacements !== 1) fail(`expected one ${section}.${key} setting`);
  return output.join('\n');
};

const renderProxyHeaders = (source, publicHost) => source
  .replaceAll('@@PUBLIC_HOST@@', publicHost)
  .replaceAll('@@PUBLIC_SCHEME@@', 'http');

const indent = (source, spaces) => source.split('\n').map((line) => (line ? `${' '.repeat(spaces)}${line}` : line)).join('\n');

const writePrivateAtomically = async (path, contents) => {
  const temporaryPath = `${path}.tmp.${process.pid}`;
  try {
    await writeFile(temporaryPath, contents, { mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

const main = async () => {
  const args = parseArguments();
  const projectRoot = args['--project-root'];
  const runRoot = args['--run-root'];
  const subconverterSource = args['--subconverter-source'];
  const mimeTypes = args['--nginx-mime-types'];
  for (const [name, path] of Object.entries({ projectRoot, runRoot, subconverterSource, mimeTypes })) {
    rejectControlCharacters(path, name);
    if (!isAbsolute(path)) fail(`${name} must be absolute`);
  }
  const runStats = await lstat(runRoot);
  if (!runStats.isDirectory() || runStats.isSymbolicLink()) fail('run root must be a regular directory');
  const ports = validatePorts(args['--ports-json']);
  const myurlsToken = validateSecret(process.env.MYURLS_API_TOKEN, 'MYURLS_API_TOKEN');
  const redisPassword = validateSecret(process.env.REDIS_PASSWORD, 'REDIS_PASSWORD');

  let publicConfig = await readFile(join(projectRoot, 'public/conf/config.js'), 'utf8');
  publicConfig = replaceOnce(publicConfig, "apiUrl: 'https://api.ml1.one'", `apiUrl: 'http://127.0.0.1:${ports.api}'`, 'apiUrl');
  publicConfig = replaceOnce(publicConfig, "shortUrl: 'https://ml1.one'", `shortUrl: 'http://127.0.0.1:${ports.app}/short-api'`, 'shortUrl');

  const redisTemplate = await readFile(join(projectRoot, 'deploy/local/redis.conf.template'), 'utf8');
  const redisData = join(projectRoot, '.runtime/local/redis');
  const redisLog = join(projectRoot, '.runtime/local/logs/redis.log');
  let redisConfig = redisTemplate
    .replaceAll('@@REDIS_PORT@@', String(ports.redis))
    .replaceAll('@@RUN_ROOT@@', runRoot.replaceAll('\\', '\\\\').replaceAll('"', '\\"'))
    .replaceAll('@@REDIS_PASSWORD@@', redisPassword)
    .replaceAll('@@REDIS_DATA_DIR@@', quoteNginx(redisData))
    .replaceAll('@@REDIS_LOG_PATH@@', quoteNginx(redisLog));
  if (redisConfig.includes('@@')) fail('Redis template contains unresolved markers');

  let subconverterConfig = await readFile(join(subconverterSource, 'base/pref.example.toml'), 'utf8');
  subconverterConfig = updateTomlKey(subconverterConfig, 'managed_config', 'managed_config_prefix', `"http://127.0.0.1:${ports.api}"`);
  subconverterConfig = updateTomlKey(subconverterConfig, 'security', 'profile', '"public"');
  subconverterConfig = updateTomlKey(subconverterConfig, 'security', 'allow_public_upload', 'false');
  subconverterConfig = updateTomlKey(subconverterConfig, 'server', 'listen', '"127.0.0.1"');
  subconverterConfig = updateTomlKey(subconverterConfig, 'server', 'port', String(ports.subconverter));
  subconverterConfig = updateTomlKey(subconverterConfig, 'advanced', 'log_level', '"warn"');
  subconverterConfig = updateTomlKey(subconverterConfig, 'advanced', 'print_debug_info', 'false');

  const snippetsRoot = join(projectRoot, 'nginx/snippets');
  const appSource = await readFile(join(snippetsRoot, 'app-routes.conf.template'), 'utf8');
  const apiSource = await readFile(join(snippetsRoot, 'api-routes.conf.template'), 'utf8');
  const proxySource = await readFile(join(snippetsRoot, 'proxy-headers.conf.template'), 'utf8');
  const securityHeaders = await readFile(join(snippetsRoot, 'security-headers.conf'), 'utf8');
  const contentTypeMap = await readFile(join(snippetsRoot, 'content-type-map.conf'), 'utf8');
  const shortStart = appSource.indexOf('location = /short-api/short');
  const fallbackStart = appSource.lastIndexOf('location / {');
  if (shortStart < 0 || fallbackStart <= shortStart) fail('shared APP routes changed unexpectedly');
  // Locations with their own add_header do not inherit server-level security
  // headers; expand the marker so short-link responses carry the same set.
  const securityHeadersIndented = indent(securityHeaders.trimEnd(), 2);
  const expandSecurityHeaders = (source) => source.replaceAll('@@SECURITY_HEADERS@@', () => securityHeadersIndented);
  let sharedShortRoutes = appSource.slice(shortStart, fallbackStart).trim();
  sharedShortRoutes = expandSecurityHeaders(sharedShortRoutes)
    .replaceAll('@@APP_PROXY_HEADERS@@', () => renderProxyHeaders(proxySource, `127.0.0.1:${ports.app}`).trimEnd())
    .replaceAll('@@MYURLS_MAX_BODY_BYTES@@', '1048576')
    .replaceAll('@@MYURLS_API_TOKEN@@', myurlsToken)
    .replaceAll('@@MYURLS_UPSTREAM@@', `http://127.0.0.1:${ports.myurls}`);
  const localAppRoutes = `location = /healthz {
  access_log off;
  default_type text/plain;
  return 200 "ok\\n";
}

location = /conf/config.js {
  alias ${quoteNginx(join(runRoot, 'config.js'))};
  default_type application/javascript;
  expires -1;
}

${sharedShortRoutes}

location / {
${indent(renderProxyHeaders(proxySource, `127.0.0.1:${ports.app}`).trimEnd(), 2)}
  proxy_pass http://127.0.0.1:${ports.vite}$request_uri;
}`;
  const localApiRoutes = expandSecurityHeaders(
    apiSource
      .replaceAll('@@API_PROXY_HEADERS@@', () => renderProxyHeaders(proxySource, `127.0.0.1:${ports.api}`).trimEnd())
      .replaceAll('@@SUBCONVERTER_UPSTREAM@@', `http://127.0.0.1:${ports.subconverter}`),
  );

  let nginxConfig = await readFile(join(projectRoot, 'deploy/local/nginx.conf.template'), 'utf8');
  const replacements = {
    '@@NGINX_PID_PATH@@': quoteNginx(join(runRoot, 'nginx.pid')),
    '@@NGINX_ERROR_LOG@@': quoteNginx(join(projectRoot, '.runtime/local/logs/nginx-error.log')),
    '@@NGINX_MIME_TYPES@@': quoteNginx(mimeTypes),
    '@@CONTENT_TYPE_MAP@@': indent(contentTypeMap.trimEnd(), 2),
    '@@NGINX_CLIENT_TEMP@@': quoteNginx(join(runRoot, 'nginx/client_temp')),
    '@@NGINX_PROXY_TEMP@@': quoteNginx(join(runRoot, 'nginx/proxy_temp')),
    '@@NGINX_ACCESS_LOG@@': quoteNginx(join(projectRoot, '.runtime/local/logs/nginx-access.log')),
    '@@APP_PORT@@': String(ports.app),
    '@@API_PORT@@': String(ports.api),
    '@@SECURITY_HEADERS@@': indent(securityHeaders.trimEnd(), 4),
    '@@APP_ROUTES@@': indent(localAppRoutes, 4),
    '@@API_ROUTES@@': indent(localApiRoutes.trimEnd(), 4),
  };
  for (const [marker, value] of Object.entries(replacements)) nginxConfig = nginxConfig.replaceAll(marker, () => value);
  if (nginxConfig.includes('@@')) fail('Nginx template contains unresolved markers');

  await mkdir(join(runRoot, 'nginx/client_temp'), { recursive: true, mode: 0o700 });
  await mkdir(join(runRoot, 'nginx/proxy_temp'), { recursive: true, mode: 0o700 });
  await Promise.all([
    writePrivateAtomically(join(runRoot, 'config.js'), publicConfig),
    writePrivateAtomically(join(runRoot, 'redis.conf'), redisConfig),
    writePrivateAtomically(join(runRoot, 'subconverter.toml'), subconverterConfig),
    writePrivateAtomically(join(runRoot, 'nginx.conf'), nginxConfig),
  ]);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
