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
  return urls.split('\n').join('|');
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
  let finalUrl = api + '/sub?target=' + target + '&url=' + encodeURIComponent(normalizeLinks(urls));

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
 * @param {*} input.isShowRemoteConfig
 * @param {*} input.isShowMoreConfig
 * @param {MoreConfig} input.moreConfig
 * @returns {{ok: boolean, error?: string, api?: string, subUrl?: string}}
 */
const prepareConversion = function (input) {
  if (input.urls == '') {
    return { ok: false, error: 'missingUrls' };
  }
  if (!input.isShowManualApiUrl && !regexCheck(input.apiUrl)) {
    return { ok: false, error: 'invalidRuntimeApi' };
  }
  if (!regexCheck(input.api)) {
    return { ok: false, error: 'invalidApi' };
  }
  if (input.remoteConfig == '' && input.isShowRemoteConfig) {
    return { ok: false, error: 'missingRemoteConfig' };
  }

  const api = input.api.endsWith('/') ? input.api.slice(0, -1) : input.api;
  return {
    ok: true,
    api,
    subUrl: getSubLink(input.urls, api, input.target, input.remoteConfig, input.isShowMoreConfig, input.moreConfig),
  };
};

/**
 * Permissive HTTP(S) URL-shaped input guard, not a full URL validator.
 *
 * @param {*} url
 * @returns {boolean}
 */
const regexCheck = function (url) {
  const reg_url = /https?:\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]/;
  if (reg_url.test(url)) {
    return true;
  } else {
    return false;
  }
};

export { regexCheck, getSubLink, prepareConversion };
