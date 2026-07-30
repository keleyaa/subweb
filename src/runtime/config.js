export const DEFAULT_RUNTIME_CONFIG = {
  siteName: 'Subweb',
  apiUrl: 'https://api.ml1.one',
  shortUrl: 'https://ml1.one',
  menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
  remoteConfigOptions: [
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini',
      text: 'ACL4SSR Online',
    },
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini',
      text: 'ACL4SSR Online Full',
    },
    {
      value: 'https://raw.githubusercontent.com/FDUZS/subconverter-config/main/config.ini',
      text: 'FDUZS 流媒体与 AI',
    },
    {
      value: 'https://raw.githubusercontent.com/BeingFun/config4subconverter/main/customize.ini',
      text: 'BeingFun Clash / Sing-box',
    },
  ],
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
