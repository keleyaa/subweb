const { expect, test } = require('@playwright/test');

function recordBrowserErrors(page) {
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  return errors;
}

test('converts, copies, and creates a short link with browser-owned multipart headers', async ({ context, page }) => {
  const browserErrors = recordBrowserErrors(page);
  let shortRequestContentType = '';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await page.route('https://ml1.one/short', async (route) => {
    shortRequestContentType = route.request().headers()['content-type'] ?? '';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Code: 1, ShortUrl: 'https://ml1.one/e2e-result' }),
    });
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Subconverter Web');
  await expect(page.getByRole('link', { name: 'Subconverter Web，返回首页' })).toBeVisible();

  await page.getByLabel('订阅链接').fill('https://subscription.example.test/token');
  await page.getByRole('button', { name: '转换订阅' }).click();

  const expectedUrl =
    'https://api.ml1.one/sub?target=clash&url=https%3A%2F%2Fsubscription.example.test%2Ftoken';
  await expect(page.getByLabel('转换链接')).toHaveValue(expectedUrl);
  await expect(page.getByRole('button', { name: '复制订阅' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl);

  await page.getByRole('button', { name: '生成短链' }).click();
  await expect(page.getByLabel('短链')).toHaveValue('https://ml1.one/e2e-result');
  await expect(page.getByRole('button', { name: '复制短链' })).toBeVisible();
  expect(shortRequestContentType).toMatch(/^multipart\/form-data; boundary=/i);
  expect(browserErrors).toEqual([]);
});

test('persists the explicit theme choice across reloads', async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);
  await page.goto('/');

  const root = page.locator('html');
  const initialTheme = await root.getAttribute('data-theme');
  const toggleName = initialTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';

  await page.getByRole('button', { name: toggleName }).click();
  await expect(root).toHaveAttribute('data-theme', expectedTheme);
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', expectedTheme);
  expect(browserErrors).toEqual([]);
});

test('keeps the complete workflow within a 390px mobile viewport', async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Subconverter Web，返回首页' })).toBeVisible();
  await expect(page.getByRole('button', { name: '转换订阅' })).toBeVisible();
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(browserErrors).toEqual([]);
});
