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

  it('returns an empty list for malformed storage data and reports storage errors', () => {
    const errors = [];
    const onError = (error) => errors.push(error.message);

    expect(loadTemplates(createStorage('{invalid json'), onError)).toEqual([]);
    expect(loadTemplates(createStorage(JSON.stringify({ version: 2, templates: [] })), onError)).toEqual([]);
    expect(loadTemplates(createStorage(JSON.stringify({ version: TEMPLATE_VERSION, templates: {} })), onError)).toEqual([]);
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
