import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredDocuments, verifyDocs } from '../../scripts/verify-docs.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const renderedMarkdown = (source) =>
  source
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/gu, '')
    .replace(/`[^`\n]*`/gu, '');

const decodeNumericHtmlEntities = (value) =>
  value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (reference, hexadecimal, decimal) => {
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

const namedHtmlEntities = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' };
const decodeHtmlEntities = (value) =>
  decodeNumericHtmlEntities(value).replace(/&(amp|apos|gt|lt|nbsp|quot);/giu, (reference, name) =>
    namedHtmlEntities[name.toLowerCase()] ?? reference,
  );

const imageTags = (source) => renderedMarkdown(source).match(/<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/giu) ?? [];
const imageAttributes = (tag) => {
  const attributes = [];
  let remainder = tag.slice(4, tag.endsWith('/>') ? -2 : -1).trim();

  while (remainder) {
    const match = /^([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/u.exec(remainder);
    if (!match) return null;

    attributes.push({ name: match[1].toLowerCase(), value: match[2] ?? match[3] });
    remainder = remainder.slice(match[0].length);
  }

  return attributes;
};

const hasEmbeddedReadmeImage = (source, asset) => {
  const expectedSource = `./docs/assets/readme/${asset}`;
  return imageTags(source).some((tag) => {
    const attributes = imageAttributes(tag);
    if (!attributes) return false;

    const sources = attributes.filter(({ name }) => name === 'src');
    const alternatives = attributes.filter(({ name }) => name === 'alt');
    return (
      sources.length === 1 &&
      alternatives.length === 1 &&
      sources[0].value === expectedSource &&
      decodeHtmlEntities(alternatives[0].value).trim() !== ''
    );
  });
};

describe('documentation contract', () => {
  it('keeps the documentation graph complete and linkable', () => {
    expect(verifyDocs({ root })).toEqual([]);
    expect(requiredDocuments).toHaveLength(12);
  });

  it('documents exactly the approved deployment families and source lineage', () => {
    const readme = read('README.md');
    for (const name of ['本机源码', 'Docker']) expect(readme).toContain(name);
    for (const source of [
      'stilleshan/subweb',
      'keleyaa/MyUrls',
      'CareyWang/MyUrls',
      'Aethersailor/SubConverter-Extended',
    ]) expect(readme).toContain(source);
    expect(readme).not.toMatch(/docker\s+(?:pull|run)[^\n]*:latest/iu);
  });

  it('keeps runnable commands and ignored runtime data explicit', () => {
    const readme = read('README.md');
    const local = read('docs/deployment-local.md');
    const docker = read('docs/deployment-docker.md');
    const maintenance = read('docs/maintenance.md');
    for (const document of [readme, local, docker]) {
      expect(document).toContain('git clone https://github.com/keleyaa/subweb.git');
      expect(document).toContain('cd subweb');
    }
    for (const command of ['bootstrap.sh', 'start.sh', 'status.sh', 'stop.sh']) expect(local).toContain(command);
    for (const command of [
      'docker-deploy.sh',
      'configure.sh',
      'validate-compose.sh',
      'docker compose up -d --build --wait',
      'docker compose up -d --no-build --pull always --wait',
    ]) {
      expect(docker).toContain(command);
    }
    for (const command of ['docker compose ps', 'docker compose logs', 'docker compose stop', 'docker compose start', 'docker compose down']) {
      expect(docker).toContain(command);
    }
    expect(docker).toContain('不要直接执行 `cat .env`');
    expect(docker).toContain('无需手动填写');
    expect(local).toContain('http://127.0.0.1:18080/');
    expect(local).toContain('不要在其他项目目录执行');
    for (const ignored of ['.env', '.runtime/', 'dist/', 'test-results/']) expect(maintenance).toContain(ignored);
  });

  it('documents Docker Hub and GHCR as equivalent release sources', () => {
    const readme = read('README.md');
    const docker = read('docs/deployment-docker.md');
    const maintenance = read('docs/maintenance.md');

    for (const document of [readme, docker, maintenance]) {
      expect(document).toContain('docker.io/keleyaa/subweb');
      expect(document).toContain('ghcr.io/keleyaa/subweb');
    }
    expect(docker).toContain('--image ghcr.io/keleyaa/subweb:sha-');
    expect(maintenance).toContain('packages: write');
  });

  it('keeps the bilingual product story and local visual proof explicit', () => {
    const readme = read('README.md');

    for (const text of [
      'Self-hosted subscription delivery',
      '自托管订阅转换发行栈',
      'docs/assets/readme/subweb-hero.svg',
      'docs/assets/readme/subweb-architecture.svg',
      'docs/assets/subconverter-web.png',
      'docker.io/keleyaa/subweb',
      'ghcr.io/keleyaa/subweb',
    ]) {
      expect(readme).toContain(text);
    }
  });

  it('requires local visual proof to be rendered HTML images with descriptive alt text', () => {
    const asset = 'subweb-hero.svg';
    const image = `<img alt="Subweb hero architecture" src="./docs/assets/readme/${asset}">`;

    expect(hasEmbeddedReadmeImage(image, asset)).toBe(true);
    expect(hasEmbeddedReadmeImage(`\`\`\`html\n${image}\n\`\`\``, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`<!-- ${image} -->`, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`docs/assets/readme/${asset}`, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`<img alt="" src="./docs/assets/readme/${asset}">`, asset)).toBe(false);
    expect(
      hasEmbeddedReadmeImage('<img alt="Wrong path" src="./docs/assets/readme/subweb-heroXsvg">', asset),
    ).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        '<img alt="Subweb hero architecture" src="./docs/assets/readme/subweb-hero.svg" src="./docs/assets/readme/wrong.svg">',
        asset,
      ),
    ).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        '<img alt="" alt="Subweb hero architecture" src="./docs/assets/readme/subweb-hero.svg">',
        asset,
      ),
    ).toBe(false);
    expect(hasEmbeddedReadmeImage('<img alt="&#32;&#10;" src="./docs/assets/readme/subweb-hero.svg">', asset)).toBe(false);
    expect(hasEmbeddedReadmeImage('<img alt="&nbsp;" src="./docs/assets/readme/subweb-hero.svg">', asset)).toBe(false);
  });

  it('embeds the hero and architecture proof as descriptive local HTML images', () => {
    const readme = read('README.md');

    for (const asset of ['subweb-hero.svg', 'subweb-architecture.svg']) {
      expect(hasEmbeddedReadmeImage(readme, asset)).toBe(true);
    }
  });
});
