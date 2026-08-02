import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const isLegalXmlCodePoint = (codePoint) =>
  Number.isSafeInteger(codePoint) &&
  (codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff));
const decodeNumericXmlEntities = (source) =>
  source.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (reference, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
    return isLegalXmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : reference;
  });
const namedXmlEntities = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
const decodeXmlEntities = (source) =>
  decodeNumericXmlEntities(source).replace(/&(amp|apos|gt|lt|quot);/gu, (reference, name) =>
    namedXmlEntities[name] ?? reference,
  );
const isLegalXmlEntity = (reference) => {
  if (Object.hasOwn(namedXmlEntities, reference.slice(1, -1))) return true;

  const match = /^&#(?:x([0-9A-Fa-f]+)|([0-9]+));$/u.exec(reference);
  if (!match) return false;

  const [, hexadecimal, decimal] = match;
  return isLegalXmlCodePoint(Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10));
};
const hasOnlyLegalXmlEntities = (source) => {
  let cursor = 0;

  while (cursor < source.length) {
    const ampersand = source.indexOf('&', cursor);
    if (ampersand === -1) return true;

    const match = /^&(?:amp|apos|gt|lt|quot|#(?:[0-9]+|x[0-9A-Fa-f]+));/u.exec(source.slice(ampersand));
    if (!match || !isLegalXmlEntity(match[0])) return false;
    cursor = ampersand + match[0].length;
  }

  return true;
};
const withoutCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, '');
const decodeCssEscapes = (source) =>
  source.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|([\s\S]))/giu, (reference, hexadecimal, escaped) => {
    if (!hexadecimal) return escaped;

    const codePoint = Number.parseInt(hexadecimal, 16);
    return Number.isSafeInteger(codePoint) &&
      codePoint > 0 &&
      codePoint <= 0x10ffff &&
      (codePoint < 0xd800 || codePoint > 0xdfff)
      ? String.fromCodePoint(codePoint)
      : '\ufffd';
  });
const remoteResource =
  /(?:(?:^|[\s<])(?:xlink:)?href\s*=\s*["']|url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//iu;
const hasRemoteResource = (source) =>
  remoteResource.test(decodeCssEscapes(withoutCssComments(decodeNumericXmlEntities(source))));
const hasDisallowedSvgContent = (source) =>
  /<(?:script|foreignObject|animateMotion|animateTransform|animate|set)\b/iu.test(source) ||
  /@(?:-[a-z]+-)?keyframes\b/iu.test(decodeCssEscapes(source));

const parseXmlAttributes = (source) => {
  const attributes = [];
  let remainder = source.trim();

  while (remainder) {
    const match = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/u.exec(remainder);
    if (!match) return null;

    const value = match[2] ?? match[3];
    if (!hasOnlyLegalXmlEntities(value)) return null;
    attributes.push({ name: match[1], value });
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
  const declaration = /^\s*<\?xml[\s\S]*?\?>\s*/u.exec(source);
  if (declaration && !hasOnlyLegalXmlEntities(declaration[0])) return null;

  const markup = source.replace(/^\s*<\?xml[\s\S]*?\?>\s*/u, '');
  const roots = [];
  const stack = [];
  let cursor = 0;

  const appendText = (text) => {
    if (text.includes('<') || !hasOnlyLegalXmlEntities(text)) return false;
    if (stack.length) {
      stack.at(-1).text += decodeXmlEntities(text);
      return true;
    }
    return !text.trim();
  };

  for (const match of markup.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[^<>]*>/gu)) {
    const text = markup.slice(cursor, match.index);
    if (!appendText(text)) return null;

    if (match[0].startsWith('<!--')) {
      cursor = match.index + match[0].length;
      continue;
    }

    if (match[1] !== undefined) {
      if (!stack.length) return null;
      stack.at(-1).text += match[1];
      cursor = match.index + match[0].length;
      continue;
    }

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

  if (!appendText(markup.slice(cursor)) || stack.length || roots.length !== 1) return null;

  const [rootNode] = roots;
  return rootNode.name === 'svg' && !rootNode.selfClosing ? rootNode : null;
};

const hasMeaningfulSvgText = (element) =>
  !element.selfClosing && element.children.length === 0 && element.text.trim() !== '';

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
    const cdataAccessibilityText =
      '<svg viewBox="0 0 1200 360"><title><![CDATA[Subweb hero]]></title><desc><![CDATA[System overview]]></desc></svg>';
    const cdataTextWithLessThan =
      '<svg viewBox="0 0 1200 360"><title><![CDATA[Subweb < hero]]></title><desc><![CDATA[System < overview]]></desc></svg>';
    const legalNamedEntity =
      '<svg viewBox="0 0 1200 360"><title>Subweb &amp; hero</title><desc>System overview</desc></svg>';
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
    const bogusEntity =
      '<svg viewBox="0 0 1200 360"><title>&bogus;</title><desc>System overview</desc></svg>';
    const unterminatedNumericEntity =
      '<svg viewBox="0 0 1200 360"><title>&#32</title><desc>System overview</desc></svg>';
    const rawLessThanText =
      '<svg viewBox="0 0 1200 360"><title>Subweb < hero</title><desc>System overview</desc></svg>';

    expect(hasCompleteSvgContract(valid, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(cdataAccessibilityText, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(cdataTextWithLessThan, '0 0 1200 360')).toBe(true);
    expect(hasCompleteSvgContract(legalNamedEntity, '0 0 1200 360')).toBe(true);
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
    expect(hasCompleteSvgContract(bogusEntity, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(unterminatedNumericEntity, '0 0 1200 360')).toBe(false);
    expect(hasCompleteSvgContract(rawLessThanText, '0 0 1200 360')).toBe(false);
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
      'url("http\\3a \\2f \\2f 127.0.0.1:18080/remote-image")',
      '@import "http\\3a \\2f \\2f 127.0.0.1:18080/remote.css"',
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
      'url(#gradient)',
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
      '<animateMotion />',
      '<set />',
      '<style>@keyframes pulse {}</style>',
      '<style>@key\\000066rames pulse {}</style>',
      '<style>@-webkit-keyframes pulse {}</style>',
    ]) {
      expect(hasDisallowedSvgContent(source)).toBe(true);
    }
    expect(hasDisallowedSvgContent('<rect width="1" height="1" />')).toBe(false);
    expect(hasDisallowedSvgContent('<text>keyframes</text>')).toBe(false);
  });

  it('keeps the visible Subconverter Web name in the hero accessibility title', () => {
    const source = read('docs/assets/readme/subweb-hero.svg');

    expect(source).toMatch(/<title\b[^>]*>\s*Subconverter Web\b/iu);
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
