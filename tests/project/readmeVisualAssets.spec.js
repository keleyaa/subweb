import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const decodeNumericXmlEntities = (source) =>
  source.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (reference, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
    if (
      !Number.isSafeInteger(codePoint) ||
      codePoint === 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return reference;
    }
    return String.fromCodePoint(codePoint);
  });
const remoteResource =
  /(?:(?:^|[\s<])(?:xlink:)?href\s*=\s*["']|url\(\s*["']?|@import\s+["'])(?:https?:)?\/\//iu;
const hasRemoteResource = (source) => remoteResource.test(decodeNumericXmlEntities(source));
const withoutXmlComments = (source) => source.replace(/<!--[\s\S]*?-->/gu, '');

const hasSvgRootWithViewBox = (source, viewBox) =>
  new RegExp(`^\\s*<svg\\b(?=[^>]*\\sviewBox\\s*=\\s*["']${viewBox}["'])[^>]*>`, 'u').test(
    withoutXmlComments(source),
  );

const hasNonemptySvgTextElement = (source, name) =>
  new RegExp(`<${name}\\b[^>]*>\\s*[^\\s<](?:[^<]*[^\\s<])?\\s*</${name}\\s*>`, 'u').test(
    withoutXmlComments(source),
  );

describe('README visual asset contract', () => {
  it('requires actual SVG structure and closed nonempty accessibility text', () => {
    const valid = '<svg viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</desc></svg>';

    expect(hasSvgRootWithViewBox(valid, '0 0 1200 360')).toBe(true);
    expect(hasSvgRootWithViewBox(valid, '0 0 1200 520')).toBe(false);
    expect(hasSvgRootWithViewBox('<!-- <svg viewBox="0 0 1200 360"> -->', '0 0 1200 360')).toBe(false);
    expect(hasNonemptySvgTextElement(valid, 'title')).toBe(true);
    expect(hasNonemptySvgTextElement(valid, 'desc')).toBe(true);
    expect(hasNonemptySvgTextElement('<!-- <title>Hidden</title> -->', 'title')).toBe(false);
    expect(hasNonemptySvgTextElement('<title />', 'title')).toBe(false);
    expect(hasNonemptySvgTextElement('<desc></desc>', 'desc')).toBe(false);
    expect(hasNonemptySvgTextElement('title: Subweb hero', 'title')).toBe(false);
  });

  it('detects remote resource references without rejecting namespaces or local fragments', () => {
    for (const source of [
      'href = "https://example.com/image.svg"',
      'xlink:href="//cdn.example.com/image.svg"',
      'url( "https://example.com/image.svg")',
      'url(//cdn.example.com/image.svg)',
      '@import "https://example.com/style.css"',
      '@import url(//cdn.example.com/style.css)',
      'href="&#104;ttps://example.com/image.svg"',
    ]) {
      expect(hasRemoteResource(source)).toBe(true);
    }

    for (const source of [
      'xmlns="http://www.w3.org/2000/svg"',
      'href="#gradient"',
      'data-href="https://example.com/image.svg"',
      'aria-href="https://example.com/image.svg"',
      '@import "./local.css"',
    ]) {
      expect(hasRemoteResource(source)).toBe(false);
    }
  });

  it.each([
    ['subweb-hero.svg', '0 0 1200 360'],
    ['subweb-architecture.svg', '0 0 1200 520'],
  ])(
    'keeps %s self-contained and accessible',
    (asset, viewBox) => {
      const source = read(path.join('docs/assets/readme', asset));

      expect(hasSvgRootWithViewBox(source, viewBox)).toBe(true);
      expect(hasNonemptySvgTextElement(source, 'title')).toBe(true);
      expect(hasNonemptySvgTextElement(source, 'desc')).toBe(true);
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/iu);
      expect(hasRemoteResource(source)).toBe(false);
    },
  );
});
