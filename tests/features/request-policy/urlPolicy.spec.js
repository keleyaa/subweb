import { describe, expect, it } from 'vitest';
import { PolicyError, validateConversionQuery } from '../../../services/request-policy/src/url-policy.mjs';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

const query = (values) => new URLSearchParams({ target: 'clash', url: 'https://example.com/sub', ...values });

describe('request policy URL validation', () => {
  it('accepts public HTTPS subscriptions and remote configs', async () => {
    const result = await validateConversionQuery(
      query({ config: 'https://example.com/config.ini' }),
      { lookup: publicDns },
    );

    expect(result.urls).toEqual(['https://example.com/sub']);
    expect(result.config).toBe('https://example.com/config.ini');
  });

  it.each([
    'http://example.com/sub',
    'ftp://example.com/sub',
    'https://user:password@example.com/sub',
    'https://example.com/sub#fragment',
  ])('rejects unsafe subscription URL %s', async (url) => {
    await expect(validateConversionQuery(query({ url }), { lookup: publicDns })).rejects.toMatchObject({
      code: 'url_not_allowed',
      status: 403,
    });
  });

  it.each([
    'https://127.0.0.1/sub',
    'https://10.0.0.1/sub',
    'https://192.168.1.10/sub',
    'https://[::1]/sub',
    'https://[fc00::1]/sub',
  ])('rejects private subscription URL %s', async (url) => {
    await expect(validateConversionQuery(query({ url }), { lookup: publicDns })).rejects.toMatchObject({
      code: 'private_address',
      status: 403,
    });
  });

  it('rejects a hostname when any DNS answer is private', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];

    await expect(validateConversionQuery(query(), { lookup })).rejects.toMatchObject({
      code: 'private_address',
      status: 403,
    });
  });

  it('bounds slow DNS lookups before they can hold a request open', async () => {
    const lookup = () => new Promise(() => {});

    await expect(validateConversionQuery(query(), { lookup, dnsTimeoutMs: 10 })).rejects.toMatchObject({
      code: 'dns_timeout',
      status: 403,
    });
  });

  it('keeps supported node URIs compatible without resolving them', async () => {
    const result = await validateConversionQuery(
      query({ url: 'vmess://eyJhZGQiOiIxOTguNTEuMTAwLjEwIn0=' }),
      { lookup: async () => { throw new Error('node URI must not resolve'); } },
    );

    expect(result.urls).toHaveLength(1);
    expect(result.urls[0]).toMatch(/^vmess:\/\/eyJhZGQiOiIxOTguNTEuMTAwLjEwIn0=$/);
  });

  it('rejects duplicate or unsupported target versions', async () => {
    for (const params of [
      'target=surge&ver=2&ver=3&url=https%3A%2F%2Fexample.com%2Fsub',
      'target=surge&ver=1&url=https%3A%2F%2Fexample.com%2Fsub',
      'target=surge&ver=two&url=https%3A%2F%2Fexample.com%2Fsub',
    ]) {
      await expect(validateConversionQuery(new URLSearchParams(params), { lookup: publicDns })).rejects.toMatchObject({
        code: 'invalid_request',
        status: 400,
      });
    }
  });

  it('accepts the supported Surge target versions', async () => {
    for (const version of ['2', '3', '4']) {
      await expect(validateConversionQuery(
        new URLSearchParams(`target=surge&ver=${version}&url=https%3A%2F%2Fexample.com%2Fsub`),
        { lookup: publicDns },
      )).resolves.toMatchObject({ target: 'surge' });
    }
  });

  it('rejects missing, empty, oversized and excessive inputs', async () => {
    await expect(validateConversionQuery(new URLSearchParams({ target: 'clash' }), { lookup: publicDns })).rejects.toMatchObject({
      code: 'missing_url',
      status: 400,
    });

    await expect(validateConversionQuery(query({ url: '   ' }), { lookup: publicDns })).rejects.toMatchObject({
      code: 'missing_url',
      status: 400,
    });

    await expect(
      validateConversionQuery(query({ url: `https://${'a'.repeat(300)}.example/sub` }), { lookup: publicDns, maxUrlLength: 256 }),
    ).rejects.toMatchObject({ code: 'url_too_long', status: 413 });

    const urls = Array.from({ length: 17 }, (_, index) => `https://example.com/${index}`).join('|');
    await expect(validateConversionQuery(query({ url: urls }), { lookup: publicDns })).rejects.toMatchObject({
      code: 'too_many_urls',
      status: 413,
    });
  });

  it('never exposes the original URL in policy errors', async () => {
    const secretUrl = 'https://10.0.0.1/private?token=do-not-log';

    try {
      await validateConversionQuery(query({ url: secretUrl }), { lookup: publicDns });
      throw new Error('expected policy error');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyError);
      expect(error.message).not.toContain(secretUrl);
      expect(error.message).not.toContain('do-not-log');
    }
  });
});
