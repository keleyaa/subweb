import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/components/dialog/DialogView.vue', import.meta.url);

describe('DialogView document structure', () => {
  it('renders dynamic dialog content inside an application element', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(source).toMatch(/<div\s+class="dialog-custom swal2-container/);
  });

  it('uses a fixed modal layer instead of document-flow dialog content', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.dialog-custom\s*\{[^}]*position:\s*fixed\s*;/);
    expect(source).toMatch(/\.dialog-custom\s*\{[^}]*inset:\s*0\s*;/);
    expect(source).toMatch(/\.dialog-custom\s*\{[^}]*z-index:\s*10000\s*;/);
    expect(source).toMatch(/\.swal2-popup\s*\{[^}]*background:\s*#fff\s*;/);
  });
});
