import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('README visual asset contract', () => {
  it.each(['subweb-hero.svg', 'subweb-architecture.svg'])(
    'keeps %s self-contained and accessible',
    (asset) => {
      const source = read(path.join('docs/assets/readme', asset));

      expect(source).toContain('viewBox="0 0 1200');
      expect(source).toContain('<title');
      expect(source).toContain('<desc');
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/iu);
      expect(source).not.toMatch(/(?:href|xlink:href)=["'][^"']*https?:\/\//iu);
      expect(source).not.toMatch(/url\(["']?https?:\/\//iu);
    },
  );
});
