import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const remoteResource = /(?:(?:xlink:)?href\s*=\s*["']|url\(\s*["']?)(?:https?:)?\/\//iu;

describe('README visual asset contract', () => {
  it('rejects remote resource references without rejecting SVG namespaces or fragments', () => {
    for (const source of [
      'href = "https://example.com/image.svg"',
      'xlink:href="//cdn.example.com/image.svg"',
      'url( "https://example.com/image.svg")',
      'url(//cdn.example.com/image.svg)',
    ]) {
      expect(source).toMatch(remoteResource);
    }

    for (const source of ['xmlns="http://www.w3.org/2000/svg"', 'href="#gradient"']) {
      expect(source).not.toMatch(remoteResource);
    }
  });

  it.each(['subweb-hero.svg', 'subweb-architecture.svg'])(
    'keeps %s self-contained and accessible',
    (asset) => {
      const source = read(path.join('docs/assets/readme', asset));

      expect(source).toContain('viewBox="0 0 1200');
      expect(source).toContain('<title');
      expect(source).toContain('<desc');
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/iu);
      expect(source).not.toMatch(remoteResource);
    },
  );
});
