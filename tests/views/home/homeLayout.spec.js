import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../../src/views/home/HomeView.vue', import.meta.url);

describe('modern home layout', () => {
  it('reserves space below the fixed navigation across responsive breakpoints', async () => {
    const source = await readFile(sourceUrl, 'utf8');

    expect(source).toMatch(/\.home-view--modern \.landing-hero\s*\{[^}]*padding-top:\s*4rem\s*;/);
    expect(source).toMatch(
      /@media \(min-width: 992px\)\s*\{\s*\.home-view--modern \.landing-hero\s*\{[^}]*padding-top:\s*5rem\s*;/
    );
  });
});
