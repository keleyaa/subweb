import { describe, expect, it } from 'vitest';
import {
  createShortUrlRequestConfig,
  createConversionInputKey,
  getSubLink,
  hasCurrentConversionResult,
  hasCurrentShortUrlResult,
  matchesConversionInput,
  prepareConversion,
  regexCheck,
} from '../../../src/views/home/index.js';

const input = {
  urls: 'https://subscription.example.test/a\nhttps://subscription.example.test/b',
  api: 'https://api.ml1.one/',
  target: 'clash',
  remoteConfig: '',
  isShowMoreConfig: false,
  moreConfig: {
    include: '',
    exclude: '',
    emoji: true,
    udp: true,
    sort: false,
    scv: false,
    list: false,
  },
};

describe('conversion action state', () => {
  it('accepts only complete HTTP(S) URLs', () => {
    expect(regexCheck('https://api.example.test/path?value=1')).toBe(true);
    expect(regexCheck('http://127.0.0.1:25500')).toBe(true);
    expect(regexCheck('prefixhttps://api.example.test')).toBe(false);
    expect(regexCheck('javascript:alert(1)')).toBe(false);
    expect(regexCheck('https://user:password@api.example.test')).toBe(false);
    expect(regexCheck('https://')).toBe(false);
  });

  it('lets the browser set the multipart boundary for short-link FormData', () => {
    const data = new FormData();
    const request = createShortUrlRequestConfig('https://ml1.one/', data);

    expect(request).toEqual({
      method: 'post',
      url: 'https://ml1.one/short',
      data,
    });
    expect(request).not.toHaveProperty('headers');
    expect(request).not.toHaveProperty('header');
  });

  it('joins service paths before existing query parameters and removes URL fragments', () => {
    const data = new FormData();

    expect(createShortUrlRequestConfig('https://short.example.test/base/?token=abc#fragment', data)).toEqual({
      method: 'post',
      url: 'https://short.example.test/base/short?token=abc',
      data,
    });
    expect(
      getSubLink(
        'https://subscription.example.test/token',
        'https://api.example.test/base/?token=abc#fragment',
        'clash',
        '',
        false,
        input.moreConfig
      )
    ).toBe(
      'https://api.example.test/base/sub?token=abc&target=clash&url=https%3A%2F%2Fsubscription.example.test%2Ftoken'
    );
  });

  it('rejects malformed manual remote configuration URLs', () => {
    expect(
      prepareConversion({
        ...input,
        apiUrl: input.api,
        isShowManualApiUrl: false,
        isShowRemoteConfig: true,
        remoteConfig: 'not-a-complete-url',
      })
    ).toEqual({ ok: false, error: 'invalidRemoteConfig' });
  });

  it('keeps a result current only while its URL-affecting input is unchanged', () => {
    const conversionKey = createConversionInputKey(input);
    const result = {
      subUrl: 'https://api.ml1.one/sub?target=clash',
      conversionKey,
    };

    expect(createConversionInputKey({ ...input, api: 'https://api.ml1.one' })).toBe(conversionKey);
    expect(hasCurrentConversionResult(result, input)).toBe(true);
    expect(hasCurrentConversionResult(result, { ...input, target: 'v2ray' })).toBe(false);
    expect(hasCurrentConversionResult(result, { ...input, urls: 'https://subscription.example.test/c' })).toBe(false);
  });

  it('rejects an asynchronous short-link response when its captured input is no longer current', () => {
    const conversionKey = createConversionInputKey(input);

    expect(matchesConversionInput(conversionKey, input)).toBe(true);
    expect(matchesConversionInput(conversionKey, { ...input, target: 'v2ray' })).toBe(false);
  });

  it('makes the short-link action copyable only for the current conversion result', () => {
    const conversionKey = createConversionInputKey(input);
    const result = {
      subUrl: 'https://api.ml1.one/sub?target=clash',
      shortUrl: 'https://ml1.one/example',
      conversionKey,
      shortUrlConversionKey: conversionKey,
    };

    expect(hasCurrentShortUrlResult(result, input)).toBe(true);
    expect(hasCurrentShortUrlResult(result, { ...input, target: 'singbox' })).toBe(false);
    expect(hasCurrentShortUrlResult({ ...result, shortUrlConversionKey: 'old' }, input)).toBe(false);
  });
});
