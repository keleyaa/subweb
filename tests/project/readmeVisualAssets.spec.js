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
const withoutXmlCommentsAndCdata = (source) =>
  source.replace(/<!--[\s\S]*?-->/gu, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/gu, '');
const svgDocument = (source) =>
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/u.exec(
    withoutXmlCommentsAndCdata(source),
  );

const hasExactViewBox = (attributes, viewBox) =>
  new RegExp(`(?:^|\\s)viewBox\\s*=\\s*["']${viewBox}["'](?=\\s|$)`, 'u').test(attributes);

const hasNonemptySvgTextElement = (content, name) =>
  new RegExp(`<${name}\\b[^>]*>\\s*[^\\s<](?:[^<]*[^\\s<])?\\s*</${name}\\s*>`, 'u').test(content);

const hasCompleteSvgContract = (source, viewBox) => {
  const match = svgDocument(source);
  if (!match) return false;

  const [, attributes, content] = match;
  return (
    hasExactViewBox(attributes, viewBox) &&
    hasNonemptySvgTextElement(content, 'title') &&
    hasNonemptySvgTextElement(content, 'desc')
  );
};

describe('README visual asset contract', () => {
  it('requires a complete SVG root and closed nonempty accessibility text', () => {
    const valid =
      '<?xml version="1.0"?><svg viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</desc></svg>';
    const fakeComment =
      '<svg viewBox="0 0 1200 360"><!-- <title>Fake title</title><desc>Fake description</desc> --></svg>';
    const fakeCdata =
      '<svg viewBox="0 0 1200 360"><![CDATA[<title>Fake title</title><desc>Fake description</desc>]]></svg>';

    expect(hasCompleteSvgContract(valid, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(valid, '0 0 1200 520')).toBe(false);
    expect(hasCompleteSvgContract('<!-- <svg viewBox="0 0 1200 360"> -->', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract('<svg viewBox="0 0 1200 360"><title /><desc></desc></svg>', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract('title: Subweb hero', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(fakeComment, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(fakeCdata, '0 0 1200 360')).toBe(false);
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

      expect(hasCompleteSvgContract(source, viewBox)).toBe(true);
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/iu);
      expect(hasRemoteResource(source)).toBe(false);
    },
  );
});
