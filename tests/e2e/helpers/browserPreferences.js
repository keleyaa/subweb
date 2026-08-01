async function applyBrowserPreferences(
  page,
  { reducedMotion = 'no-preference', reducedTransparency = false, moreContrast = false } = {}
) {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(
    ({ transparency, contrast }) => {
      document.documentElement.dataset.reducedTransparency = String(transparency);
      document.documentElement.dataset.moreContrast = String(contrast);
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = nativeMatchMedia(query);
        const forced =
          (query === '(prefers-reduced-transparency: reduce)' && transparency) ||
          (query === '(prefers-contrast: more)' && contrast);
        if (!forced) return result;
        return new Proxy(result, {
          get(target, property) {
            if (property === 'matches') return true;
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
    },
    { transparency: reducedTransparency, contrast: moreContrast }
  );
  await page.evaluate(
    ({ transparency, contrast }) => {
      document.documentElement.dataset.reducedTransparency = String(transparency);
      document.documentElement.dataset.moreContrast = String(contrast);
    },
    { transparency: reducedTransparency, contrast: moreContrast }
  );

  return async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  };
}

module.exports = { applyBrowserPreferences };
