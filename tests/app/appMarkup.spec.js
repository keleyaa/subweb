import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const indexUrl = new URL('../../index.html', import.meta.url);
const appUrl = new URL('../../src/App.vue', import.meta.url);

describe('application mount markup', () => {
  it('assigns the app mount id only to the HTML document mount point', async () => {
    const [indexHtml, appSource] = await Promise.all([readFile(indexUrl, 'utf8'), readFile(appUrl, 'utf8')]);

    expect(indexHtml.match(/\bid=["']app["']/g)).toHaveLength(1);
    expect(indexHtml).toMatch(/<div\s+id=["']app["']\s*><\/div>/);
    expect(appSource).not.toMatch(/\bid=["']app["']/);
  });

  it('keeps the routed view and conditional dialog at the application root', async () => {
    const appSource = await readFile(appUrl, 'utf8');

    expect(appSource).toContain('<router-view />');
    expect(appSource).toContain('<dialog-view v-if="$store.state.app.dialog.active"></dialog-view>');
  });
});
