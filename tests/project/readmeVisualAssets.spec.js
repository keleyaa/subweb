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
const withoutCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, '');
const remoteResource =
  /(?:(?:^|[\s<])(?:xlink:)?href\s*=\s*["']|url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//iu;
const hasRemoteResource = (source) => remoteResource.test(withoutCssComments(decodeNumericXmlEntities(source)));
const hasDisallowedSvgContent = (source) =>
  /<(?:script|foreignObject|animate|animateTransform|set)\b/iu.test(source) || /@keyframes\b/iu.test(source);
const withoutXmlCommentsAndCdata = (source) =>
  source.replace(/<!--[\s\S]*?-->/gu, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/gu, '');

const parseXmlAttributes = (source) => {
  const attributes = [];
  let remainder = source.trim();

  while (remainder) {
    const match = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/u.exec(remainder);
    if (!match) return null;

    attributes.push({ name: match[1], value: match[2] ?? match[3] });
    remainder = remainder.slice(match[0].length);
  }

  return new Set(attributes.map(({ name }) => name)).size === attributes.length ? attributes : null;
};

const parseXmlTag = (tag) => {
  if (tag.startsWith('</')) {
    const name = tag.slice(2, -1).trim();
    return /^[A-Za-z][\w:.-]*$/u.test(name) ? { closing: true, name } : null;
  }

  const selfClosing = tag.endsWith('/>');
  const body = tag.slice(1, selfClosing ? -2 : -1).trim();
  const match = /^([A-Za-z][\w:.-]*)([\s\S]*)$/u.exec(body);
  if (!match) return null;

  const [, name, attributeSource] = match;
  const attributes = parseXmlAttributes(attributeSource);
  if (!attributes) return null;
  return { attributes, closing: false, name, selfClosing };
};

const parseSvgDocument = (source) => {
  const markup = withoutXmlCommentsAndCdata(source).replace(/^\s*<\?xml[\s\S]*?\?>\s*/u, '');
  const roots = [];
  const stack = [];
  let cursor = 0;

  for (const match of markup.matchAll(/<[^<>]*>/gu)) {
    const text = markup.slice(cursor, match.index);
    if (stack.length) stack.at(-1).text += text;
    else if (text.trim()) return null;

    const tag = parseXmlTag(match[0]);
    if (!tag) return null;

    if (tag.closing) {
      const open = stack.pop();
      if (!open || open.name !== tag.name) return null;
    } else {
      const node = { ...tag, children: [], text: '' };
      if (stack.length) stack.at(-1).children.push(node);
      else roots.push(node);
      if (!tag.selfClosing) stack.push(node);
    }

    cursor = match.index + match[0].length;
  }

  if (markup.slice(cursor).trim() || stack.length || roots.length !== 1) return null;

  const [rootNode] = roots;
  return rootNode.name === 'svg' && !rootNode.selfClosing ? rootNode : null;
};

const hasMeaningfulSvgText = (element) =>
  !element.selfClosing && element.children.length === 0 && decodeNumericXmlEntities(element.text).trim() !== '';

const hasCompleteSvgContract = (source, viewBox) => {
  const rootNode = parseSvgDocument(source);
  if (!rootNode) return false;

  const viewBoxes = rootNode.attributes.filter(({ name }) => name === 'viewBox');
  const titles = rootNode.children.filter(({ name }) => name === 'title');
  const descriptions = rootNode.children.filter(({ name }) => name === 'desc');
  return (
    viewBoxes.length === 1 &&
    viewBoxes[0].value === viewBox &&
    titles.length === 1 &&
    descriptions.length === 1 &&
    hasMeaningfulSvgText(titles[0]) &&
    hasMeaningfulSvgText(descriptions[0])
  );
};

describe('README visual asset contract', () => {
  it('requires a complete SVG root and closed nonempty accessibility text', () => {
    const valid =
      '<?xml version="1.0"?><svg viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</desc></svg>';
    const regularSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</desc><defs><linearGradient id="glow"><stop offset="0%" /></linearGradient></defs><rect width="1200" height="360" /><path d="M0 0 L1 1" /><text x="32" y="48">Focus</text></svg>';
    const fakeComment =
      '<svg viewBox="0 0 1200 360"><!-- <title>Fake title</title><desc>Fake description</desc> --></svg>';
    const fakeCdata =
      '<svg viewBox="0 0 1200 360"><![CDATA[<title>Fake title</title><desc>Fake description</desc>]]></svg>';
    const duplicateViewBox =
      '<svg viewBox="0 0 1200 360" viewBox="0 0 1200 520"><title>Subweb hero</title><desc>System overview</desc></svg>';
    const wrongViewBox =
      '<svg viewBox="0 0 1200 520"><title>Subweb hero</title><desc>System overview</desc></svg>';
    const multipleRoots =
      '<svg viewBox="0 0 1200 360"><title>First</title><desc>First root</desc></svg><svg viewBox="0 0 1200 360"><title>Second</title><desc>Second root</desc></svg>';
    const duplicateAccessibilityText =
      '<svg viewBox="0 0 1200 360"><title>First title</title><title>Second title</title><desc>First description</desc><desc>Second description</desc></svg>';
    const unclosedPath =
      '<svg viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</desc><path d="M0 0"></svg>';
    const unclosedDescription =
      '<svg viewBox="0 0 1200 360"><title>Subweb hero</title><desc>System overview</svg>';
    const whitespaceAccessibilityText =
      '<svg viewBox="0 0 1200 360"><title>&#32;&#10;</title><desc>&#32;&#10;</desc></svg>';

    expect(hasCompleteSvgContract(valid, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(regularSvg, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(valid, '0 0 1200 520')).toBe(false);
    expect(hasCompleteSvgContract('<!-- <svg viewBox="0 0 1200 360"> -->', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract('<svg viewBox="0 0 1200 360"><title /><desc></desc></svg>', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract('title: Subweb hero', '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(fakeComment, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(fakeCdata, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(duplicateViewBox, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(wrongViewBox, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(multipleRoots, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(duplicateAccessibilityText, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(unclosedPath, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(unclosedDescription, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(whitespaceAccessibilityText, '0 0 1200 360')).toBe(false);
  });

  it('detects remote resource references without rejecting namespaces or local fragments', () => {
    for (const source of [
      'href = "https://example.com/image.svg"',
      'xlink:href="//cdn.example.com/image.svg"',
      'url( "https://example.com/image.svg")',
      'url(//cdn.example.com/image.svg)',
      '@import "https://example.com/style.css"',
      '@import url(//cdn.example.com/style.css)',
      'url(/* comment */https://example.com/image.svg)',
      '@import/* comment */"https://example.com/style.css"',
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

  it('rejects dynamic SVG primitives and CSS animation', () => {
    for (const source of [
      '<script />',
      '<foreignObject />',
      '<animate />',
      '<animateTransform />',
      '<set />',
      '<style>@keyframes pulse {}</style>',
    ]) {
      expect(hasDisallowedSvgContent(source)).toBe(true);
    }
    expect(hasDisallowedSvgContent('<rect width="1" height="1" />')).toBe(false);
  });

  it.each([
    ['subweb-hero.svg', '0 0 1200 360'],
    ['subweb-architecture.svg', '0 0 1200 520'],
  ])(
    'keeps %s self-contained and accessible',
    (asset, viewBox) => {
      const source = read(path.join('docs/assets/readme', asset));

      expect(hasCompleteSvgContract(source, viewBox)).toBe(true);
      expect(hasDisallowedSvgContent(source)).toBe(false);
      expect(hasRemoteResource(source)).toBe(false);
    },
  );
});
