import { describe, expect, it } from 'vitest';
import {
  MAX_TEMPLATES,
  STORAGE_KEY,
  TEMPLATE_VERSION,
  createTemplate,
  loadTemplates,
  saveTemplates,
  serializeTemplates,
} from '../../../src/features/templates/preferences';

const createStorage = (initialValue = null) => {
  let value = initialValue;

  return {
    getItem() {
      return value;
    },
    setItem(key, nextValue) {
      expect(key).toBe(STORAGE_KEY);
      value = nextValue;
    },
    get value() {
      return value;
    },
  };
};

const completeMoreConfig = () => ({
  include: '',
  exclude: '',
  emoji: true,
  udp: true,
  sort: false,
  scv: false,
  list: false,
});

describe('local conversion templates', () => {
  it('whitelists a template without serializing conversion or runtime values', () => {
    const sensitiveUrl = 'https://subscription.example.test/input';
    const sensitiveApi = 'https://api.example.test';
    const sensitiveRemoteConfig = 'https://config.example.test';
    const sensitiveSubUrl = 'https://result.example.test/sub';
    const sensitiveShortUrl = 'https://short.example.test/result';

    const serialized = serializeTemplates([
      {
        id: 'clash-default',
        name: 'Clash default',
        target: 'clash',
        moreConfig: {
          include: 'HK',
          exclude: 'US',
          emoji: false,
          udp: false,
          sort: true,
          scv: true,
          list: true,
        },
        urls: sensitiveUrl,
        api: sensitiveApi,
        remoteConfig: sensitiveRemoteConfig,
        result: {
          subUrl: sensitiveSubUrl,
          shortUrl: sensitiveShortUrl,
        },
        apiUrl: sensitiveApi,
        shortUrl: sensitiveShortUrl,
      },
    ]);
    const parsed = JSON.parse(serialized);

    expect(parsed).toEqual({
      version: TEMPLATE_VERSION,
      templates: [
        {
          id: 'clash-default',
          name: 'Clash default',
          target: 'clash',
          moreConfig: {
            include: 'HK',
            exclude: 'US',
            emoji: false,
            udp: false,
            sort: true,
            scv: true,
            list: true,
          },
        },
      ],
    });
    expect(serialized).not.toContain(sensitiveUrl);
    expect(serialized).not.toContain(sensitiveApi);
    expect(serialized).not.toContain(sensitiveRemoteConfig);
    expect(serialized).not.toContain(sensitiveSubUrl);
    expect(serialized).not.toContain(sensitiveShortUrl);
  });

  it('fills safe defaults, normalizes unsupported targets, and caps saved templates', () => {
    expect(createTemplate({ name: 'Minimal template' }, 'minimal-template')).toEqual({
      id: 'minimal-template',
      name: 'Minimal template',
      target: 'clash',
      moreConfig: {
        include: '',
        exclude: '',
        emoji: true,
        udp: true,
        sort: false,
        scv: false,
        list: false,
      },
    });
    expect(createTemplate({ name: 'Invalid target', target: 'not-a-client' }, 'invalid-target').target).toBe('clash');

    const templates = Array.from({ length: MAX_TEMPLATES + 3 }, (_, index) => ({
      id: `template-${index}`,
      name: `Template ${index}`,
      target: 'clash',
    }));

    expect(JSON.parse(serializeTemplates(templates)).templates).toHaveLength(MAX_TEMPLATES);
  });

  it('never mutates the caller input or shares more-config defaults', () => {
    const input = {
      name: 'Existing setup',
      target: 'surge&ver=4',
      moreConfig: { include: 'JP', emoji: false },
      urls: 'https://subscription.example.test/input',
    };
    const inputBefore = JSON.parse(JSON.stringify(input));
    const firstTemplate = createTemplate(input, 'existing-setup');
    const secondTemplate = createTemplate({ name: 'Second setup' }, 'second-setup');

    firstTemplate.moreConfig.include = 'Changed';

    expect(input).toEqual(inputBefore);
    expect(secondTemplate.moreConfig.include).toBe('');
  });

  it('clears URL-like optional values and rejects URL-like names before persistence', () => {
    const includeUrl = 'https://include.example.test';
    const excludeUrl = 'www.exclude.example.test';
    const serialized = serializeTemplates([
      {
        id: 'safe-template',
        name: 'Safe template',
        target: 'clash',
        moreConfig: { include: includeUrl, exclude: excludeUrl },
      },
      {
        id: 'url-name',
        name: 'https://name.example.test',
        target: 'clash',
      },
    ]);
    const templates = JSON.parse(serialized).templates;

    expect(templates).toEqual([
      {
        id: 'safe-template',
        name: 'Safe template',
        target: 'clash',
        moreConfig: {
          include: '',
          exclude: '',
          emoji: true,
          udp: true,
          sort: false,
          scv: false,
          list: false,
        },
      },
    ]);
    expect(serialized).not.toContain(includeUrl);
    expect(serialized).not.toContain(excludeUrl);
    expect(serialized).not.toContain('https://name.example.test');
  });

  it('does not persist URI schemes or protocol-relative values', () => {
    const uriLikeValues = [
      'mailto:person@example.test',
      'data:text/plain,template',
      'javascript:alert(1)',
      'ftp:files.example.test',
      'about:blank',
      'about:',
      'intent:scan',
      'custom-scheme:opaque',
      '//host.example.test/path',
    ];

    for (const [index, value] of uriLikeValues.entries()) {
      const serialized = serializeTemplates([
        {
          id: `uri-value-${index}`,
          name: 'Safe template',
          target: 'clash',
          moreConfig: { include: value, exclude: value },
        },
        {
          id: `uri-name-${index}`,
          name: value,
          target: 'clash',
        },
      ]);
      const templates = JSON.parse(serialized).templates;

      expect(templates).toEqual([
        {
          id: `uri-value-${index}`,
          name: 'Safe template',
          target: 'clash',
          moreConfig: completeMoreConfig(),
        },
      ]);
      expect(serialized).not.toContain(value);
    }

    expect(createTemplate({ name: '普通名称: 默认', moreConfig: { include: '地区: HK' } }, 'ordinary-name')).toEqual({
      id: 'ordinary-name',
      name: '普通名称: 默认',
      target: 'clash',
      moreConfig: {
        ...completeMoreConfig(),
        include: '地区: HK',
      },
    });
  });

  it('rejects control-character-obfuscated URI values on write and read', () => {
    const obfuscatedUrl = 'https:\n//subscription.example.test/path?token=secret';
    const serialized = serializeTemplates([
      {
        id: 'obfuscated-uri',
        name: 'Safe template',
        target: 'clash',
        moreConfig: { include: obfuscatedUrl, exclude: obfuscatedUrl },
      },
      {
        id: 'obfuscated-uri-name',
        name: obfuscatedUrl,
        target: 'clash',
      },
    ]);

    expect(JSON.parse(serialized).templates).toEqual([
      {
        id: 'obfuscated-uri',
        name: 'Safe template',
        target: 'clash',
        moreConfig: completeMoreConfig(),
      },
    ]);
    expect(serialized).not.toContain('token=secret');

    const errors = [];
    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [
              {
                id: 'stored-obfuscated-uri',
                name: 'Stored template',
                target: 'clash',
                moreConfig: { ...completeMoreConfig(), include: obfuscatedUrl },
              },
            ],
          })
        ),
        (error) => errors.push(error.message)
      )
    ).toEqual([]);
    expect(errors).toEqual(['Invalid saved templates']);
  });

  it('rejects stored templates whose template fields contain URI values', () => {
    const errors = [];
    const onError = (error) => errors.push(error.message);
    const safeTemplate = {
      id: 'stored-uri',
      name: 'Stored template',
      target: 'clash',
      moreConfig: completeMoreConfig(),
    };
    const unsafeTemplates = [
      { ...safeTemplate, name: 'about:blank' },
      { ...safeTemplate, name: 'about:' },
      { ...safeTemplate, moreConfig: { ...completeMoreConfig(), include: 'intent:scan' } },
      { ...safeTemplate, moreConfig: { ...completeMoreConfig(), exclude: 'custom-scheme:opaque' } },
      { ...safeTemplate, moreConfig: { ...completeMoreConfig(), include: '//host.example.test/path' } },
    ];

    for (const template of unsafeTemplates) {
      expect(
        loadTemplates(
          createStorage(
            JSON.stringify({
              version: TEMPLATE_VERSION,
              templates: [template],
            })
          ),
          onError
        )
      ).toEqual([]);
    }

    expect(errors).toEqual([
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
    ]);
  });

  it('rejects stored envelopes that contain unknown or invalid schema fields', () => {
    const errors = [];
    const onError = (error) => errors.push(error.message);
    const safeTemplate = {
      id: 'stored-template',
      name: 'Stored template',
      target: 'clash',
      moreConfig: completeMoreConfig(),
    };

    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [safeTemplate],
            urls: 'https://subscription.example.test/input',
          })
        ),
        onError
      )
    ).toEqual([]);
    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [{ ...safeTemplate, api: 'https://api.example.test' }],
          })
        ),
        onError
      )
    ).toEqual([]);
    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [
              {
                ...safeTemplate,
                moreConfig: { ...completeMoreConfig(), remoteConfig: 'https://config.example.test' },
              },
            ],
          })
        ),
        onError
      )
    ).toEqual([]);
    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [{ ...safeTemplate, target: 'not-a-client' }],
          })
        ),
        onError
      )
    ).toEqual([]);
    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates: [{ ...safeTemplate, id: 123 }],
          })
        ),
        onError
      )
    ).toEqual([]);

    expect(errors).toEqual([
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
      'Invalid saved templates',
    ]);
  });

  it('round-trips complete safe templates through storage with isolated results', () => {
    const storage = createStorage();
    const source = [
      {
        id: 'round-trip',
        name: 'Round trip',
        target: 'singbox',
        moreConfig: { ...completeMoreConfig(), include: 'HK', emoji: false },
        urls: 'https://subscription.example.test/input',
      },
    ];

    expect(saveTemplates(storage, source)).toBe(true);
    expect(JSON.parse(storage.value)).toEqual({
      version: TEMPLATE_VERSION,
      templates: [
        {
          id: 'round-trip',
          name: 'Round trip',
          target: 'singbox',
          moreConfig: { ...completeMoreConfig(), include: 'HK', emoji: false },
        },
      ],
    });

    const firstLoad = loadTemplates(storage);
    firstLoad[0].moreConfig.include = 'Changed';

    expect(loadTemplates(storage)).toEqual([
      {
        id: 'round-trip',
        name: 'Round trip',
        target: 'singbox',
        moreConfig: { ...completeMoreConfig(), include: 'HK', emoji: false },
      },
    ]);
  });

  it('stably truncates complete safe stored templates at the template limit', () => {
    const templates = Array.from({ length: MAX_TEMPLATES + 3 }, (_, index) => ({
      id: `stored-template-${index}`,
      name: `Stored template ${index}`,
      target: 'clash',
      moreConfig: completeMoreConfig(),
    }));
    const errors = [];

    expect(
      loadTemplates(
        createStorage(
          JSON.stringify({
            version: TEMPLATE_VERSION,
            templates,
          })
        ),
        (error) => errors.push(error.message)
      )
    ).toEqual(templates.slice(0, MAX_TEMPLATES));
    expect(errors).toEqual([]);
  });

  it('returns an empty list for malformed storage data and reports storage errors', () => {
    const errors = [];
    const onError = (error) => errors.push(error.message);

    expect(loadTemplates(createStorage('{invalid json'), onError)).toEqual([]);
    expect(loadTemplates(createStorage(JSON.stringify({ version: 2, templates: [] })), onError)).toEqual([]);
    expect(loadTemplates(createStorage(JSON.stringify({ version: TEMPLATE_VERSION, templates: {} })), onError)).toEqual(
      []
    );
    expect(
      loadTemplates(
        {
          getItem() {
            throw new Error('storage read failed');
          },
        },
        onError
      )
    ).toEqual([]);

    expect(errors).toEqual([
      'Unable to parse saved templates',
      'Unsupported template version',
      'Invalid saved templates',
      'storage read failed',
    ]);
  });

  it('returns false and reports write failures without exposing caller values', () => {
    const errors = [];
    const saved = saveTemplates(
      {
        setItem() {
          throw new Error('storage write failed');
        },
      },
      [{ id: 'test-template', name: 'Test template', target: 'clash' }],
      (error) => errors.push(error.message)
    );

    expect(saved).toBe(false);
    expect(errors).toEqual(['storage write failed']);
  });
});
