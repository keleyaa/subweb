import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  getNextTheme,
  initializeTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  saveThemeAndApply,
} from '../../../src/features/theme/theme.js';

const themeToggleUrl = new URL('../../../src/layouts/main/navbar/ThemeToggle.vue', import.meta.url);

describe('theme preferences', () => {
  it('exports the supported theme values', () => {
    expect(THEMES).toEqual({ LIGHT: 'light', DARK: 'dark' });
    expect(THEME_STORAGE_KEY).toBe('subweb-theme');
    expect(isTheme(THEMES.LIGHT)).toBe(true);
    expect(isTheme(THEMES.DARK)).toBe(true);
    expect(isTheme('system')).toBe(false);
  });

  it('uses a saved valid preference before the system preference', () => {
    const storage = { getItem: () => THEMES.LIGHT };
    const matchMedia = () => ({ matches: true });

    expect(resolveTheme({ storage, matchMedia })).toBe(THEMES.LIGHT);
  });

  it.each([
    [null, null],
    ['system', null],
    ['unexpected', null],
    [undefined, null],
  ])('returns null for invalid stored preferences: %j', (value, expected) => {
    expect(readStoredTheme({ getItem: () => value })).toBe(expected);
  });

  it('returns null when stored preference access fails', () => {
    expect(readStoredTheme({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(readStoredTheme(null)).toBeNull();
  });

  it.each([
    [true, THEMES.DARK],
    [false, THEMES.LIGHT],
  ])('uses the system preference when no saved preference exists', (matches, theme) => {
    expect(resolveTheme({ storage: { getItem: () => null }, matchMedia: () => ({ matches }) })).toBe(theme);
  });

  it('falls back to light when matchMedia is unavailable or fails', () => {
    expect(resolveTheme({ storage: null, matchMedia: null })).toBe(THEMES.LIGHT);
    expect(resolveTheme({ storage: null, matchMedia: () => { throw new Error('blocked'); } })).toBe(THEMES.LIGHT);
  });

  it('applies a theme to the root data attribute and color scheme', () => {
    const root = { dataset: {}, style: {} };

    applyTheme(root, THEMES.DARK);

    expect(root.dataset.theme).toBe(THEMES.DARK);
    expect(root.style.colorScheme).toBe(THEMES.DARK);
  });

  it('ignores invalid themes and missing roots safely', () => {
    const root = { dataset: {}, style: {} };

    expect(() => applyTheme(root, 'system')).not.toThrow();
    expect(root.dataset.theme).toBeUndefined();
    expect(() => applyTheme(null, THEMES.DARK)).not.toThrow();
  });

  it('alternates between light and dark', () => {
    expect(getNextTheme(THEMES.LIGHT)).toBe(THEMES.DARK);
    expect(getNextTheme(THEMES.DARK)).toBe(THEMES.LIGHT);
    expect(getNextTheme('unexpected')).toBe(THEMES.LIGHT);
  });

  it('saves a valid explicit choice and applies it', () => {
    const saved = [];
    const root = { dataset: {}, style: {} };

    expect(saveThemeAndApply(THEMES.DARK, { storage: { setItem: (...args) => saved.push(args) }, root })).toBe(
      THEMES.DARK,
    );
    expect(saved).toEqual([[THEME_STORAGE_KEY, THEMES.DARK]]);
    expect(root.dataset.theme).toBe(THEMES.DARK);
  });

  it('applies a valid choice even when saving fails', () => {
    const root = { dataset: {}, style: {} };

    expect(
      saveThemeAndApply(THEMES.LIGHT, {
        storage: { setItem: () => { throw new Error('blocked'); } },
        root,
      }),
    ).toBe(THEMES.LIGHT);
    expect(root.style.colorScheme).toBe(THEMES.LIGHT);
  });

  it('does not throw when browser globals are unavailable', () => {
    expect(() => initializeTheme()).not.toThrow();
  });
});

describe('ThemeToggle source contract', () => {
  it('uses an accessible icon-only native button', async () => {
    const source = await readFile(themeToggleUrl, 'utf8');

    expect(source).toMatch(/<button[^>]*type="button"/);
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain(':aria-label="label"');
    expect(source).toContain(':title="label"');
    expect(source).toContain(':aria-pressed="isDark"');
    expect(source).toContain('min-width: 44px');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain('saveThemeAndApply');
  });
});
