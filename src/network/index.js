import axios from 'axios';

const DEFAULT_TIMEOUT = 5000;

/**
 * @typedef {Object} RequestConfig
 * @property {Object|null|undefined} [header] Legacy fallback used only when headers is undefined.
 * @property {Object|null|undefined} [headers] Preferred Axios headers value.
 */

/**
 * Preserves Axios resolve and reject values without response normalization.
 *
 * @param {RequestConfig} [config] Axios request config; additional fields pass through unchanged.
 * @returns {Promise<*>}
 */
export function request(config = {}) {
  const { header, headers, ...requestConfig } = config;
  const instance = axios.create({
    timeout: DEFAULT_TIMEOUT,
  });

  return instance({
    ...requestConfig,
    headers: headers === undefined ? header : headers,
  });
}
