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

test('converts, copies, and creates a short link through the same-origin Rust adapter', async ({ context, page }) => {
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
  await page.route('**/short-api/links', async (route) => {
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

test('uses a fixed black command surface without a visible theme switcher', async ({ page }) => {
  const browserErrors = recordBrowserErrors(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: /切换到.*模式/ })).toHaveCount(0);
  const colors = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(colors).toBe('rgb(17, 18, 18)');
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
  await page.route('**/short-api/links', async (route) => {
    attempts += 1;
    const request = route.request().postDataJSON();
    if (attempts === 1) {
      await route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://myurls.invalid/problems/challenge-required',
          title: 'Challenge required',
          status: 403,
          code: 'challenge_required',
          requestId: 'req-e2e',
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

test('keeps status rows mutually exclusive, smoothly staged, tactile, and keyboard accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sub-table--modern')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const targets = [...document.querySelectorAll('button, textarea, select')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      targets,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
  expect(geometry.targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

  const backendToggle = page.getByRole('button', { name: /订阅后端.*默认后端/ });
  const advancedToggle = page.getByRole('button', { name: /高级参数.*未设置/ });
  const backendPanel = page.locator('#subscription-backend-panel');
  const advancedPanel = page.locator('#advanced-config-panel');

  await backendToggle.focus();
  await page.keyboard.press('Enter');
  await expect(backendToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(backendPanel).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const backendToggleElement = document.querySelector('#subscription-backend-toggle');
    const backendPanelElement = document.querySelector('#subscription-backend-panel');
    const advancedToggleElement = document.querySelector('#more-config-toggle');
    return Boolean(
      backendToggleElement?.compareDocumentPosition(backendPanelElement) & Node.DOCUMENT_POSITION_FOLLOWING
      && backendPanelElement?.compareDocumentPosition(advancedToggleElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  })).toBe(true);

  await advancedToggle.focus();
  await page.keyboard.press('Space');
  await expect(backendToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(backendPanel).toBeHidden();
  await expect(advancedPanel).toBeVisible();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => {
    const advancedToggleElement = document.querySelector('#more-config-toggle');
    const advancedPanelElement = document.querySelector('#advanced-config-panel');
    return Boolean(advancedToggleElement?.compareDocumentPosition(advancedPanelElement) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  const transition = await advancedPanel.evaluate((element) => getComputedStyle(element).transitionProperty);
  expect(transition).toContain('max-height');
});

test('applies and resets advanced parameter drafts through the status row', async ({ page }) => {
  await page.goto('/');

  const advancedToggle = page.getByRole('button', { name: /高级参数.*未设置/ });
  await advancedToggle.click();
  await page.getByLabel('Include').fill('Hong Kong');
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '保存高级参数' }).click();
  await expect(page.getByRole('button', { name: /高级参数.*已设置/ })).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: /高级参数.*已设置/ }).click();
  await page.getByRole('button', { name: '重置高级参数' }).click();
  await expect(page.getByRole('button', { name: /高级参数.*未设置/ })).toHaveAttribute('aria-expanded', 'false');
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
  expect(Number.parseFloat(styles.borderWidth)).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: '转换并复制' })).toHaveCSS('justify-content', 'center');
  await restore();
});
