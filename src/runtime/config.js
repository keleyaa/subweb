import { isValidHttpUrl } from '@/features/url/httpUrl';
import { getGithubRepositoryLabel } from '@/features/site/github';

export const DEFAULT_RUNTIME_CONFIG = {
  apiUrl: import.meta.env.DEV ? (import.meta.env.VITE_LOCAL_SUBCONVERTER_URL ?? 'https://api.ml1.one') : 'https://api.ml1.one',
  shortLinksEnabled: true,
  customBackendEnabled: true,
  turnstileSiteKey: '',
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

function normalizeApiUrl(source) {
  return isValidHttpUrl(source.apiUrl) ? source.apiUrl : DEFAULT_RUNTIME_CONFIG.apiUrl;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeTurnstileSiteKey(value) {
  if (typeof value !== 'string' || value.length > 256) {
    return DEFAULT_RUNTIME_CONFIG.turnstileSiteKey;
  }
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || code === 0x7f) return DEFAULT_RUNTIME_CONFIG.turnstileSiteKey;
  }
  return value;
}

function isSafeGithubMenuItem(item) {
  return Boolean(getGithubRepositoryLabel(item));
}

function isRemoteConfigOption(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.text === 'string' &&
    Boolean(item.text.trim()) &&
    isValidHttpUrl(item.value)
  );
}

export function normalizeRuntimeConfig(config) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};

  return {
    apiUrl: normalizeApiUrl(source),
    shortLinksEnabled: normalizeBoolean(source.shortLinksEnabled, DEFAULT_RUNTIME_CONFIG.shortLinksEnabled),
    customBackendEnabled: normalizeBoolean(source.customBackendEnabled, DEFAULT_RUNTIME_CONFIG.customBackendEnabled),
    turnstileSiteKey: normalizeTurnstileSiteKey(source.turnstileSiteKey),
    menuItem: (Array.isArray(source.menuItem) ? source.menuItem.filter(isSafeGithubMenuItem) : DEFAULT_RUNTIME_CONFIG.menuItem)
      .map((item) => (Array.isArray(item) ? [...item] : item && typeof item === 'object' ? { ...item } : item)),
    remoteConfigOptions: (Array.isArray(source.remoteConfigOptions)
      ? source.remoteConfigOptions.filter(isRemoteConfigOption)
      : DEFAULT_RUNTIME_CONFIG.remoteConfigOptions
    ).map((item) => (Array.isArray(item) ? [...item] : item && typeof item === 'object' ? { ...item } : item)),
  };
}

export function installRuntimeConfig(globalObject) {
  const source = globalObject.__SUBWEB_CONFIG__ ?? globalObject.config;
  const config = normalizeRuntimeConfig(source);

  globalObject.__SUBWEB_CONFIG__ = config;
  globalObject.config = config;
  return config;
}
