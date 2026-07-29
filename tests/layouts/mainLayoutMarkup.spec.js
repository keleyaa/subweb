import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/layouts/main/MainLayout.vue', import.meta.url);

describe('MainLayout document structure', () => {
  it('keeps document tags in the root HTML document', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(source).toContain('class="main-layout light-style layout-navbar-fixed layout-wide"');
    expect(source).toContain('<nav-bar />');
    expect(source).toContain('<router-view />');
    expect(source).toContain('<footer-bar />');
  });
});
