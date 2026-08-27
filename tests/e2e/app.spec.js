const { expect, test } = require('@playwright/test');
const { applyBrowserPreferences } = require('./helpers/browserPreferences');

test.beforeEach(async ({ page }) => {
  await page.route('**/sub?*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'proxy-providers:\n  demo:\n' });
  });
});

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

test('converts, copies, and creates a short link through the same-origin v2 adapter', async ({ context, page }) => {
  const browserErrors = recordBrowserErrors(page);
  let shortRequestContentType = '';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await page.route('**/conf/config.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.config = ${JSON.stringify({
        apiUrl: 'https://api.ml1.one',
        menuItem: [],
        remoteConfigOptions: [],
      })};`,
    });
  });
  await page.route('**/short-api/v1/links', async (route) => {
    shortRequestContentType = route.request().headers()['content-type'] ?? '';
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      body: JSON.stringify({
        code: 'e2e-result',
        shortUrl: 'https://short.example.test/e2e-result',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    });
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Subconverter Web');
  await expect(page.getByRole('link', { name: 'Subconverter Web，返回首页' })).toBeVisible();
  await expect(page.getByRole('group', { name: '转换结果' })).toHaveCount(0);

  await page.getByLabel('订阅链接').fill('https://subscription.example.test/token');
  await page.getByRole('button', { name: '转换并复制' }).click();

  const expectedUrl =
    'https://api.ml1.one/sub?target=clash&url=https%3A%2F%2Fsubscription.example.test%2Ftoken';
  await expect(page.getByLabel('转换链接')).toHaveValue(expectedUrl);
  await expect(page.getByRole('button', { name: '复制订阅' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl);

  await page.getByRole('button', { name: '生成并复制短链' }).click();
  await expect(page.getByLabel('短链')).toHaveValue('https://short.example.test/e2e-result');
  await expect(page.getByRole('button', { name: '复制短链' })).toBeVisible();
  expect(shortRequestContentType).toMatch(/^application\/json(?:;|$)/i);
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

test('loads Turnstile only after challenge_required and retries the same conversion automatically', async ({ page }) => {
  let attempts = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: "window.turnstile={render:(_host,options)=>{setTimeout(()=>options.callback('e2e-token'),0);return 1},remove:()=>{}};",
    });
  });
  await page.route('**/short-api/v1/links', async (route) => {
    attempts += 1;
    const request = route.request().postDataJSON();
    if (attempts === 1) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'challenge_required', requestId: 'req-e2e' },
          challenge: { provider: 'turnstile', siteKey: 'site-e2e' },
        }),
      });
      return;
    }
    expect(request.challengeToken).toBe('e2e-token');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'challenge-result',
        shortUrl: 'https://short.example.test/challenge-result',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('script[data-turnstile]')).toHaveCount(0);
  await page.getByLabel('订阅链接').fill('https://subscription.example.test/challenge');
  await page.getByRole('button', { name: '转换并复制' }).click();
  await page.getByRole('button', { name: '生成并复制短链' }).click();
  await expect(page.getByLabel('短链')).toHaveValue('https://short.example.test/challenge-result');
  expect(attempts).toBe(2);
});

test('keeps the complete workflow within a 390px mobile viewport', async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Subconverter Web，返回首页' })).toBeVisible();
  await expect(page.getByRole('button', { name: '转换并复制' })).toBeVisible();
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(browserErrors).toEqual([]);
});

test('keeps generated links selectable when clipboard access is rejected', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    Document.prototype.execCommand = () => false;
  });
  await page.goto('/');
  await page.getByLabel('订阅链接').fill('https://subscription.example.test/manual-copy');
  await page.getByRole('button', { name: '转换并复制' }).click();

  await expect(page.getByLabel('转换链接')).toHaveValue(/manual-copy/);
  await expect(page.getByText('链接已生成，请手动复制')).toBeVisible();
  await expect(page.getByText(/复制成功/)).toHaveCount(0);
});

test('hides stale results as soon as a conversion input changes', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await page.goto('/');
  await page.getByLabel('订阅链接').fill('https://subscription.example.test/original');
  await page.getByRole('button', { name: '转换并复制' }).click();
  await expect(page.getByLabel('转换链接')).toBeVisible();

  await page.getByLabel('客户端').selectOption('singbox');
  await expect(page.getByLabel('转换链接')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成并复制短链' })).toHaveCount(0);
});

test('keeps optical alignment, target sizes, and keyboard disclosures accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sub-table--modern')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const brand = document.querySelector('.app-brand-link').getBoundingClientRect();
    const surface = document.querySelector('.sub-table--modern').getBoundingClientRect();
    const targets = [...document.querySelectorAll('button, textarea, select')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return {
      centerDelta: Math.abs(brand.x + brand.width / 2 - (surface.x + surface.width / 2)),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      targets,
    };
  });
  expect(geometry.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
  expect(geometry.targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

  const serviceToggle = page.getByRole('button', { name: '服务设置', exact: true });
  await serviceToggle.focus();
  await page.keyboard.press('Enter');
  await expect(serviceToggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(serviceToggle).toHaveAttribute('aria-expanded', 'false');
});

test('honors reduced motion, reduced transparency, and increased contrast', async ({ page }) => {
  await page.goto('/');
  const restore = await applyBrowserPreferences(page, {
    reducedMotion: 'reduce',
    reducedTransparency: true,
    moreContrast: true,
  });
  const styles = await page.locator('.sub-table--modern').evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      backdropFilter: computed.backdropFilter,
      borderWidth: computed.borderTopWidth,
    };
  });
  expect(styles.backdropFilter).toBe('none');
  expect(styles.borderWidth).toBe('1px');
  await restore();
});
