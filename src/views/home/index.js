import { isValidHttpUrl } from '@/features/url/httpUrl';

/**
 * @typedef {Object} MoreConfig
 * @property {*} [include] Legacy loose-empty comparison value.
 * @property {*} [exclude] Legacy loose-empty comparison value.
 * @property {*} [emoji] Serialized using JavaScript truthiness.
 * @property {*} [udp] Serialized using JavaScript truthiness.
 * @property {*} [sort] Serialized using JavaScript truthiness.
 * @property {*} [scv] Serialized using JavaScript truthiness.
 * @property {*} [list] Serialized using JavaScript truthiness.
 */

/**
 * @param {string} urls
 * @returns {string}
 */
const normalizeLinks = function (urls) {
  return typeof urls === 'string' ? urls.replace(/\r\n?|\n/gu, '|') : '';
};

/**
 * @param {*} api
 * @returns {string}
 */
const normalizeApi = function (api) {
  return typeof api === 'string' && api.endsWith('/') ? api.slice(0, -1) : api;
};

/**
 * @param {string} baseUrl
 * @param {string} pathSegment
 * @returns {string}
 */
const createServiceEndpoint = function (baseUrl, pathSegment) {
  const endpoint = new URL(baseUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/' + pathSegment;
  endpoint.hash = '';
  return endpoint.toString();
};

/**
 * Creates a stable key for every input that changes a generated conversion URL.
 *
 * @param {Object} input
 * @param {*} input.urls
 * @param {*} input.api
 * @param {*} input.target
 * @param {*} input.remoteConfig
 * @param {*} input.isShowMoreConfig
 * @param {MoreConfig} input.moreConfig
 * @returns {string}
 */
const createConversionInputKey = function (input) {
  const moreConfig = input.isShowMoreConfig
    ? {
        include: input.moreConfig?.include ?? '',
        exclude: input.moreConfig?.exclude ?? '',
        emoji: Boolean(input.moreConfig?.emoji),
        udp: Boolean(input.moreConfig?.udp),
        sort: Boolean(input.moreConfig?.sort),
        scv: Boolean(input.moreConfig?.scv),
        list: Boolean(input.moreConfig?.list),
      }
    : null;

  return JSON.stringify({
    urls: normalizeLinks(input.urls),
    api: normalizeApi(input.api),
    target: input.target ?? '',
    remoteConfig: input.remoteConfig ?? '',
    moreConfig,
  });
};

/**
 * @param {*} conversionKey
 * @param {Object} input
 * @returns {boolean}
 */
const matchesConversionInput = function (conversionKey, input) {
  return typeof conversionKey === 'string' && conversionKey === createConversionInputKey(input);
};

/**
 * @param {*} result
 * @param {Object} input
 * @returns {boolean}
 */
const hasCurrentConversionResult = function (result, input) {
  return Boolean(
    result && typeof result.subUrl === 'string' && result.subUrl && matchesConversionInput(result.conversionKey, input)
  );
};

/**
 * @param {*} result
 * @param {Object} input
 * @returns {boolean}
 */
const hasCurrentShortUrlResult = function (result, input) {
  return Boolean(
    hasCurrentConversionResult(result, input) &&
      typeof result.shortUrl === 'string' &&
      result.shortUrl &&
      result.shortUrlConversionKey === result.conversionKey
  );
};

/**
 * @param {*} value
 * @returns {'true' | 'false'}
 */
const toBooleanQueryValue = function (value) {
  return value ? 'true' : 'false';
};

/**
 * @param {string} url
 * @param {MoreConfig} moreConfig
 * @returns {string}
 */
const appendMoreConfig = function (url, moreConfig) {
  let finalUrl = url;

  if (moreConfig.include != '') {
    finalUrl = finalUrl + '&include=' + encodeURIComponent(moreConfig.include);
  }
  if (moreConfig.exclude != '') {
    finalUrl = finalUrl + '&exclude=' + encodeURIComponent(moreConfig.exclude);
  }

  return (
    finalUrl +
    '&emoji=' +
    toBooleanQueryValue(moreConfig.emoji) +
    '&udp=' +
    toBooleanQueryValue(moreConfig.udp) +
    '&sort=' +
    toBooleanQueryValue(moreConfig.sort) +
    '&scv=' +
    toBooleanQueryValue(moreConfig.scv) +
    '&list=' +
    toBooleanQueryValue(moreConfig.list)
  );
};

/**
 * @param {string} urls
 * @param {string} api
 * @param {string} target
 * @param {*} remoteConfig
 * @param {*} isShowMoreConfig
 * @param {MoreConfig} moreConfig
 * @returns {string}
 */
const getSubLink = function (urls, api, target, remoteConfig, isShowMoreConfig, moreConfig) {
  const endpoint = createServiceEndpoint(api, 'sub');
  const separator = endpoint.includes('?') ? '&' : '?';
  let finalUrl = endpoint + separator + 'target=' + target + '&url=' + encodeURIComponent(normalizeLinks(urls));

  if (remoteConfig) {
    finalUrl = finalUrl + '&config=' + encodeURIComponent(remoteConfig);
  }
  if (isShowMoreConfig) {
    finalUrl = appendMoreConfig(finalUrl, moreConfig);
  }
  return finalUrl;
};

/**
 * Prepares the existing conversion inputs without presenting UI feedback or performing side effects.
 *
 * @param {Object} input
 * @param {*} input.urls
 * @param {*} input.api
 * @param {*} input.apiUrl
 * @param {*} input.target
 * @param {*} input.remoteConfig
 * @param {*} input.isShowManualApiUrl
 * @param {boolean} [input.customBackendEnabled=true]
 * @param {*} input.isShowRemoteConfig
 * @param {*} input.isShowMoreConfig
 * @param {MoreConfig} input.moreConfig
 * @returns {{ok: boolean, error?: string, api?: string, subUrl?: string}}
 */
const prepareConversion = function (input) {
  if (input.urls == '') {
    return { ok: false, error: 'missingUrls' };
  }
  const customBackendEnabled = input.customBackendEnabled !== false;
  if (!regexCheck(input.apiUrl)) {
    return { ok: false, error: 'invalidRuntimeApi' };
  }
  if (customBackendEnabled && !regexCheck(input.api)) {
    return { ok: false, error: 'invalidApi' };
  }

  const api = normalizeApi(customBackendEnabled ? input.api : input.apiUrl);
  if (input.remoteConfig == '' && input.isShowRemoteConfig) {
    return { ok: false, error: 'missingRemoteConfig' };
  }
  if (input.remoteConfig && !regexCheck(input.remoteConfig)) {
    return { ok: false, error: 'invalidRemoteConfig' };
  }

  return {
    ok: true,
    api,
    subUrl: getSubLink(input.urls, api, input.target, input.remoteConfig, input.isShowMoreConfig, input.moreConfig),
  };
};

/**
 * Strict HTTP(S) URL guard retained under its historical public name.
 *
 * @param {*} url
 * @returns {boolean}
 */
const regexCheck = function (url) {
  return isValidHttpUrl(url);
};

export {
  createConversionInputKey,
  getSubLink,
  hasCurrentConversionResult,
  hasCurrentShortUrlResult,
  matchesConversionInput,
  prepareConversion,
  regexCheck,
};
