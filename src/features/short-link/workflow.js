import { ShortLinkError } from './client.js';

export const MAX_SHORT_LINK_URL_BYTES = 4096;

export const SHORT_LINK_MESSAGES = Object.freeze({
  invalid_request: '短链请求格式无效，请重新生成转换链接。',
  challenge_required: '请完成验证后继续。',
  challenge_invalid: '验证未通过，请重试。',
  alias_unavailable: '短链别名不可用。',
  url_not_allowed: '转换链接不符合短链服务的安全规则。',
  alias_invalid: '短链别名格式无效。',
  rate_limited: '短链请求过于频繁，请稍后再试。',
  request_timeout: '短链服务处理超时，请稍后重试。',
  dependency_unavailable: '短链服务暂时不可用，请稍后重试。',
  code_generation_exhausted: '暂时无法生成短码，请稍后重试。',
  url_too_long: '转换链接超过短链服务 4096 字节上限，请减少订阅或高级参数。',
});

export function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function createShortLinkWorkflow({ client, copy }) {
  if (!client || typeof client.create !== 'function') {
    throw new TypeError('client must implement create(input)');
  }
  if (typeof copy !== 'function') {
    throw new TypeError('copy must be a function');
  }

  return Object.freeze({
    async execute({ url, conversionKey, challengeToken, isCurrent }) {
      const byteLength = utf8ByteLength(url);
      if (byteLength > MAX_SHORT_LINK_URL_BYTES) {
        return {
          kind: 'error',
          code: 'url_too_long',
          message: SHORT_LINK_MESSAGES.url_too_long,
          byteLength,
          maxBytes: MAX_SHORT_LINK_URL_BYTES,
        };
      }

      const input = challengeToken ? { url, challengeToken } : { url };
      try {
        const result = await client.create(input);
        if (!isCurrent(conversionKey)) {
          return { kind: 'stale' };
        }

        let copied = false;
        try {
          await copy(result.shortUrl);
          copied = true;
        } catch {
          copied = false;
        }
        if (!isCurrent(conversionKey)) {
          return { kind: 'stale' };
        }
        return { kind: 'success', result, copied };
      } catch (error) {
        if (!isCurrent(conversionKey)) {
          return { kind: 'stale' };
        }
        if (!(error instanceof ShortLinkError)) {
          return {
            kind: 'error',
            code: 'dependency_unavailable',
            message: SHORT_LINK_MESSAGES.dependency_unavailable,
          };
        }
        if (
          (error.code === 'challenge_required' || error.code === 'challenge_invalid') &&
          error.challenge
        ) {
          return {
            kind: 'challenge',
            code: error.code,
            challenge: error.challenge,
            message: SHORT_LINK_MESSAGES[error.code],
          };
        }
        return {
          kind: 'error',
          code: error.code,
          message: SHORT_LINK_MESSAGES[error.code] ?? SHORT_LINK_MESSAGES.dependency_unavailable,
          retryAfterSeconds: error.retryAfterSeconds,
        };
      }
    },
  });
}
