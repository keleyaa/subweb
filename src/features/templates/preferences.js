export const STORAGE_KEY = 'subweb.local-conversion-templates';
export const TEMPLATE_VERSION = 1;
export const MAX_TEMPLATES = 12;

const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const URL_LIKE_PATTERN = /:\/\/|www\.|^[A-Za-z][A-Za-z0-9+.-]*:(?:\S|$)|^\/\//i;
const ENVELOPE_KEYS = ['version', 'templates'];
const TEMPLATE_KEYS = ['id', 'name', 'target', 'moreConfig'];
const MORE_CONFIG_KEYS = ['include', 'exclude', 'emoji', 'udp', 'sort', 'scv', 'list'];

export const TARGET_OPTIONS = [
  { value: 'clash', text: 'Clash' },
  { value: 'clashr', text: 'ClashR' },
  { value: 'v2ray', text: 'V2Ray' },
  { value: 'quan', text: 'Quantumult' },
  { value: 'quanx', text: 'Quantumult X' },
  { value: 'surge&ver=2', text: 'SurgeV2' },
  { value: 'surge&ver=3', text: 'SurgeV3' },
  { value: 'surge&ver=4', text: 'SurgeV4' },
  { value: 'surfboard', text: 'Surfboard' },
  { value: 'ss', text: 'SS (SIP002)' },
  { value: 'sssub', text: 'SS Android' },
  { value: 'ssd', text: 'SSD' },
  { value: 'ssr', text: 'SSR' },
  { value: 'loon', text: 'Loon' },
  { value: 'singbox', text: 'Sing-box' },
];

const SUPPORTED_TARGETS = new Set(TARGET_OPTIONS.map((option) => option.value));
const DEFAULT_TARGET = 'clash';
const MORE_CONFIG_DEFAULTS = Object.freeze({
  include: '',
  exclude: '',
  emoji: true,
  udp: true,
  sort: false,
  scv: false,
  list: false,
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const hasUrlLikeValue = (value) => typeof value === 'string' && URL_LIKE_PATTERN.test(value);

const normalizeOptionalText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  return hasUrlLikeValue(normalized) ? '' : normalized;
};

const normalizeName = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  return normalized && !hasUrlLikeValue(normalized) ? normalized : '';
};

const normalizeTarget = (value) => (SUPPORTED_TARGETS.has(value) ? value : DEFAULT_TARGET);

export const createDefaultMoreConfig = () => ({ ...MORE_CONFIG_DEFAULTS });

export const normalizeMoreConfig = (input) => {
  const source = isPlainObject(input) ? input : {};
  const defaults = createDefaultMoreConfig();

  return {
    include: normalizeOptionalText(source.include),
    exclude: normalizeOptionalText(source.exclude),
    emoji: typeof source.emoji === 'boolean' ? source.emoji : defaults.emoji,
    udp: typeof source.udp === 'boolean' ? source.udp : defaults.udp,
    sort: typeof source.sort === 'boolean' ? source.sort : defaults.sort,
    scv: typeof source.scv === 'boolean' ? source.scv : defaults.scv,
    list: typeof source.list === 'boolean' ? source.list : defaults.list,
  };
};

const isStoredMoreConfig = (value) => {
  if (!hasExactKeys(value, MORE_CONFIG_KEYS)) {
    return false;
  }

  const normalized = normalizeMoreConfig(value);
  return MORE_CONFIG_KEYS.every((key) => normalized[key] === value[key]);
};

export const createTemplate = (input, id) => {
  const source = isPlainObject(input) ? input : {};
  const normalizedId = typeof id === 'string' ? id : '';
  const name = normalizeName(source.name);

  if (!TEMPLATE_ID_PATTERN.test(normalizedId) || !name) {
    return null;
  }

  return {
    id: normalizedId,
    name,
    target: normalizeTarget(source.target),
    moreConfig: normalizeMoreConfig(source.moreConfig),
  };
};

const isStoredTemplate = (value) => {
  if (!hasExactKeys(value, TEMPLATE_KEYS) || typeof value.id !== 'string' || !TEMPLATE_ID_PATTERN.test(value.id)) {
    return false;
  }

  const name = normalizeName(value.name);
  return (
    Boolean(name) && name === value.name && SUPPORTED_TARGETS.has(value.target) && isStoredMoreConfig(value.moreConfig)
  );
};

const normalizeTemplates = (templates) => {
  if (!Array.isArray(templates)) {
    return [];
  }

  const ids = new Set();
  const normalizedTemplates = [];

  for (const template of templates) {
    const normalized = createTemplate(template, isPlainObject(template) ? template.id : '');

    if (!normalized || ids.has(normalized.id)) {
      continue;
    }

    ids.add(normalized.id);
    normalizedTemplates.push(normalized);

    if (normalizedTemplates.length === MAX_TEMPLATES) {
      break;
    }
  }

  return normalizedTemplates;
};

const readStoredTemplates = (templates) => {
  if (!Array.isArray(templates)) {
    return null;
  }

  const ids = new Set();

  for (const template of templates) {
    if (!isStoredTemplate(template) || ids.has(template.id)) {
      return null;
    }

    ids.add(template.id);
  }

  return templates.slice(0, MAX_TEMPLATES).map((template) => createTemplate(template, template.id));
};

const reportStorageError = (onError, error) => {
  if (typeof onError === 'function') {
    onError(error);
  }
};

const getStorageMethod = (storage, method) => {
  if (!storage || typeof storage[method] !== 'function') {
    throw new Error('Template storage is unavailable');
  }

  return storage[method].bind(storage);
};

export const loadTemplates = (storage, onError) => {
  try {
    const getItem = getStorageMethod(storage, 'getItem');
    const serialized = getItem(STORAGE_KEY);

    if (serialized === null) {
      return [];
    }

    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error('Unable to parse saved templates');
    }

    if (!hasExactKeys(parsed, ENVELOPE_KEYS) || !Array.isArray(parsed.templates)) {
      throw new Error('Invalid saved templates');
    }
    if (parsed.version !== TEMPLATE_VERSION) {
      throw new Error('Unsupported template version');
    }

    const templates = readStoredTemplates(parsed.templates);
    if (templates === null) {
      throw new Error('Invalid saved templates');
    }

    return templates;
  } catch (error) {
    reportStorageError(onError, error);
    return [];
  }
};

export const serializeTemplates = (templates) =>
  JSON.stringify({
    version: TEMPLATE_VERSION,
    templates: normalizeTemplates(templates),
  });

export const saveTemplates = (storage, templates, onError) => {
  try {
    const setItem = getStorageMethod(storage, 'setItem');
    setItem(STORAGE_KEY, serializeTemplates(templates));
    return true;
  } catch (error) {
    reportStorageError(onError, error);
    return false;
  }
};
