export const DEFAULT_RUNTIME_CONFIG = {
  siteName: 'Subweb',
  apiUrl: 'http://127.0.0.1:25500',
  shortUrl: '',
  menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
  remoteConfigOptions: [],
};

function hasStringValue(config, key) {
  return typeof config[key] === 'string';
}

function hasArrayValue(config, key) {
  return Array.isArray(config[key]);
}

function copyConfigArray(items) {
  return items.map((item) => {
    if (Array.isArray(item)) {
      return [...item];
    }

    return item && typeof item === 'object' ? { ...item } : item;
  });
}

export function normalizeRuntimeConfig(config) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};

  return {
    siteName: hasStringValue(source, 'siteName') ? source.siteName : DEFAULT_RUNTIME_CONFIG.siteName,
    apiUrl: hasStringValue(source, 'apiUrl') ? source.apiUrl : DEFAULT_RUNTIME_CONFIG.apiUrl,
    shortUrl: hasStringValue(source, 'shortUrl') ? source.shortUrl : DEFAULT_RUNTIME_CONFIG.shortUrl,
    menuItem: copyConfigArray(hasArrayValue(source, 'menuItem') ? source.menuItem : DEFAULT_RUNTIME_CONFIG.menuItem),
    remoteConfigOptions: copyConfigArray(
      hasArrayValue(source, 'remoteConfigOptions')
        ? source.remoteConfigOptions
        : DEFAULT_RUNTIME_CONFIG.remoteConfigOptions
    ),
  };
}

export function installRuntimeConfig(globalObject) {
  const config = normalizeRuntimeConfig(globalObject.config);

  globalObject.config = config;
  return config;
}
