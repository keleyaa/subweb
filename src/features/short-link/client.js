const CREATE_LINK_ENDPOINT = '/short-api/links';
const DEFAULT_TIMEOUT_MS = 10_000;

const ERROR_CODES = new Set([
  'invalid_request',
  'challenge_required',
  'challenge_invalid',
  'alias_unavailable',
  'url_not_allowed',
  'alias_invalid',
  'rate_limited',
  'dependency_unavailable',
  'code_generation_exhausted',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isChallenge(value) {
  return (
    isRecord(value) &&
    value.provider === 'turnstile' &&
    typeof value.siteKey === 'string' &&
    value.siteKey.length > 0
  );
}

function errorDetails(value) {
  return isRecord(value?.error) ? value.error : value;
}

function isErrorResponse(value) {
  const error = errorDetails(value);
  return (
    isRecord(value) &&
    isRecord(error) &&
    ERROR_CODES.has(error.code) &&
    typeof error.requestId === 'string' &&
    error.requestId.length > 0 &&
    (value.challenge === undefined || isChallenge(value.challenge)) &&
    (error.retryAfterSeconds === undefined ||
      (Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0))
  );
}

function isCreateLinkResponse(value) {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    value.code.length < 4 ||
    value.code.length > 32 ||
    typeof value.shortUrl !== 'string' ||
    typeof value.expiresAt !== 'string'
  ) {
    return false;
  }

  try {
    const shortUrl = new URL(value.shortUrl);
    return (
      (shortUrl.protocol === 'http:' || shortUrl.protocol === 'https:') &&
      Number.isFinite(Date.parse(value.expiresAt))
    );
  } catch {
    return false;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export class ShortLinkError extends Error {
  constructor({ status, code, requestId = 'client', challenge, retryAfterSeconds }) {
    super(code);
    this.name = 'ShortLinkError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.challenge = challenge;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function dependencyError() {
  return new ShortLinkError({ status: 503, code: 'dependency_unavailable' });
}

export function createShortLinkClient({
  fetchImpl = globalThis.fetch,
  endpoint = CREATE_LINK_ENDPOINT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  return Object.freeze({
    async create(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;

      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json, application/problem+json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        throw dependencyError();
      } finally {
        clearTimeout(timeout);
      }

      const payload = await readJson(response);
      if (response.status !== 201) {
        if (isErrorResponse(payload)) {
          const error = errorDetails(payload);
          throw new ShortLinkError({
            status: response.status,
            code: error.code,
            requestId: error.requestId,
            challenge: payload.challenge,
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        throw dependencyError();
      }

      if (!isCreateLinkResponse(payload)) {
        throw dependencyError();
      }
      return payload;
    },
  });
}
