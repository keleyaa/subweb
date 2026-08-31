import { lookup as defaultLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const DEFAULT_MAX_URL_LENGTH = 4096;
const DEFAULT_MAX_URLS = 16;
const DEFAULT_DNS_TIMEOUT_MS = 2000;
const DEFAULT_ALLOWED_PORTS = new Set(['', '443']);
const NODE_URI_SCHEMES = new Set(['http', 'https', 'ss', 'ssr', 'ssd', 'vmess', 'vless', 'trojan', 'socks', 'socks5']);

export class PolicyError extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.status = status;
  }
}

const reject = (code, status) => {
  throw new PolicyError(code, status);
};

const isBlockedAddress = (address) => {
  if (!ipaddr.isValid(address)) return true;
  const parsed = ipaddr.parse(address);
  return parsed.range() !== 'unicast';
};

const getHostnameAddresses = async (hostname, lookup, timeoutMs) => {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
  if (isIP(normalizedHostname)) return [{ address: normalizedHostname }];

  let timer;
  try {
    const lookupPromise = lookup(normalizedHostname, { all: true, verbatim: true });
    const timeoutPromise = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => rejectTimeout(new PolicyError('dns_timeout', 403)), timeoutMs);
    });
    const addresses = await Promise.race([lookupPromise, timeoutPromise]);
    return Array.isArray(addresses) ? addresses : [];
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    reject('dns_unresolvable', 403);
  } finally {
    clearTimeout(timer);
  }
};

export const resolvePublicAddresses = async (hostname, inputOptions = {}) => {
  const options = {
    lookup: inputOptions.lookup ?? defaultLookup,
    dnsTimeoutMs: inputOptions.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
  };
  const addresses = await getHostnameAddresses(hostname, options.lookup, options.dnsTimeoutMs);
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    reject('private_address', 403);
  }
  return addresses.map(({ address }) => address);
};

const validateRemoteUrl = async (value, options) => {
  if (typeof value !== 'string' || value.length > options.maxUrlLength) {
    reject('url_too_long', 413);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    reject('url_not_allowed', 403);
  }

  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !options.allowedPorts.has(parsed.port)
  ) {
    reject('url_not_allowed', 403);
  }

  await resolvePublicAddresses(parsed.hostname, options);
  return parsed.toString();
};

const validateNodeUri = (value, maxUrlLength) => {
  const hasControlCharacter = typeof value === 'string'
    && [...value].some((character) => {
      const code = character.codePointAt(0);
      return code <= 0x20 || code === 0x7f;
    });
  if (typeof value !== 'string' || value.length > maxUrlLength || hasControlCharacter) {
    reject('url_too_long', 413);
  }

  const scheme = value.slice(0, value.indexOf('://')).toLowerCase();
  if (!NODE_URI_SCHEMES.has(scheme)) reject('url_not_allowed', 403);
  return value;
};

const validateSubscriptionValue = async (value, options) => {
  if (typeof value !== 'string' || value.trim() === '') reject('missing_url', 400);

  const values = value.split('|').map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) reject('missing_url', 400);
  if (values.length > options.maxUrls) reject('too_many_urls', 413);

  return Promise.all(values.map((item) => {
    if (item.includes('://')) {
      const scheme = item.slice(0, item.indexOf('://')).toLowerCase();
      return scheme === 'http' || scheme === 'https'
        ? validateRemoteUrl(item, options)
        : validateNodeUri(item, options.maxUrlLength);
    }
    reject('url_not_allowed', 403);
  }));
};

const validateTarget = (target) => {
  if (typeof target !== 'string' || target.length === 0 || target.length > 64 || !/^[a-z0-9&=_-]+$/i.test(target)) {
    reject('invalid_target', 400);
  }
  return target;
};

export const validateConversionQuery = async (params, inputOptions = {}) => {
  const options = {
    lookup: defaultLookup,
    maxUrlLength: DEFAULT_MAX_URL_LENGTH,
    maxUrls: DEFAULT_MAX_URLS,
    dnsTimeoutMs: DEFAULT_DNS_TIMEOUT_MS,
    allowedPorts: DEFAULT_ALLOWED_PORTS,
    ...inputOptions,
  };

  if (!(params instanceof URLSearchParams)) reject('invalid_request', 400);
  if (
    params.getAll('target').length !== 1
    || params.getAll('ver').length > 1
    || params.getAll('url').length > 1
    || params.getAll('config').length > 1
  ) {
    reject('invalid_request', 400);
  }

  const target = validateTarget(params.get('target'));
  const version = params.get('ver');
  if (version !== null && !['2', '3', '4'].includes(version)) reject('invalid_request', 400);
  const urls = await validateSubscriptionValue(params.get('url'), options);
  const configValue = params.get('config');
  const config = configValue ? await validateRemoteUrl(configValue, options) : '';

  return { target, urls, config };
};

export const isBlockedIpAddress = isBlockedAddress;
