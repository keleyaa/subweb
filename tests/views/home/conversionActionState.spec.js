import { describe, expect, it } from 'vitest';
import {
  createConversionInputKey,
  hasCurrentConversionResult,
  hasCurrentShortUrlResult,
  matchesConversionInput,
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
