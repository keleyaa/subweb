export const THEMES = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
});

export const THEME_STORAGE_KEY = 'subweb-theme';

export function isTheme(theme) {
  return theme === THEMES.LIGHT || theme === THEMES.DARK;
}

export function readStoredTheme(storage) {
  try {
    const theme = storage?.getItem(THEME_STORAGE_KEY);

    return isTheme(theme) ? theme : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(matchMedia) {
  try {
    return matchMedia?.('(prefers-color-scheme: dark)')?.matches ? THEMES.DARK : THEMES.LIGHT;
  } catch {
    return THEMES.LIGHT;
  }
}

export function resolveTheme({ storage, matchMedia } = {}) {
  return readStoredTheme(storage) ?? getSystemTheme(matchMedia);
}

export function applyTheme(root, theme) {
  if (!root || !isTheme(theme)) {
    return null;
  }

  try {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    return theme;
  } catch {
    return null;
  }
}

export function getNextTheme(theme) {
  return theme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
}

function getBrowserStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserMatchMedia() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
  } catch {
    return null;
  }
}

function getDocumentRoot() {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    return document.documentElement;
  } catch {
    return null;
  }
}

export function saveThemeAndApply(theme, { storage = getBrowserStorage(), root = getDocumentRoot() } = {}) {
  if (!isTheme(theme)) {
    return null;
  }

  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Saving can be unavailable in restricted browser contexts.
  }

  applyTheme(root, theme);

  return theme;
}

export function initializeTheme() {
  const theme = resolveTheme({
    storage: getBrowserStorage(),
    matchMedia: getBrowserMatchMedia(),
  });

  applyTheme(getDocumentRoot(), theme);

  return theme;
}
