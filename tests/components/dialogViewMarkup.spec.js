import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/components/dialog/DialogView.vue', import.meta.url);

describe('DialogView document structure', () => {
  it('renders a self-contained accessible dialog without inherited SweetAlert markup', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).not.toMatch(/<html\b/i);
    expect(source).not.toMatch(/<body\b/i);
    expect(source).toContain('<div class="dialog-layer" @click.self="closeDialog">');
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).not.toContain('swal2');
    expect(source).not.toContain('<component');
  });

  it('uses a fixed modal layer instead of document-flow dialog content', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.dialog-layer\s*\{[^}]*position:\s*fixed\s*;/);
    expect(source).toMatch(/\.dialog-layer\s*\{[^}]*inset:\s*0\s*;/);
    expect(source).toMatch(/\.dialog-layer\s*\{[^}]*z-index:\s*10000\s*;/);
    expect(source).toMatch(/\.dialog-layer\s*\{[^}]*background:\s*var\(--overlay\)\s*;/);
    expect(source).toMatch(
      /\.dialog-panel\s*\{[^}]*border:\s*1px solid var\(--surface-glass-edge\)\s*;[^}]*background:\s*var\(--surface-overlay\)\s*;[^}]*backdrop-filter:\s*blur\(20px\) saturate\(120%\)\s*;/s,
    );
    expect(source).toContain('var(--focus-ring)');
    expect(source).toContain('@media (prefers-reduced-transparency: reduce)');
  });
});
