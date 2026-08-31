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
  value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (reference, hexadecimal, decimal) => {
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

const namedHtmlEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};
const nonVisibleHtmlEntityNames = new Set([
  'emsp',
  'ensp',
  'hairsp',
  'mediumspace',
  'negativemediumspace',
  'negativethickspace',
  'negativethinspace',
  'negativeverythinmathspace',
  'newline',
  'nbsp',
  'tab',
  'thinsp',
  'verythickmathspace',
  'verythinspace',
  'zerowidthspace',
]);
const decodeHtmlEntities = (value) =>
  decodeNumericHtmlEntities(value).replace(/&([a-z][a-z0-9]*);/giu, (reference, name) => {
    const normalizedName = name.toLowerCase();
    if (nonVisibleHtmlEntityNames.has(normalizedName)) return ' ';
    return namedHtmlEntities[normalizedName] ?? reference;
  });
const normalizeHtmlAltText = (value) =>
  decodeHtmlEntities(value)
    .replace(/&[a-z][a-z0-9]*;/giu, '')
    .replace(/[\p{White_Space}\p{Cf}]+/gu, '');
const hasVisibleHtmlText = (value) => /[\p{L}\p{N}]/u.test(normalizeHtmlAltText(value));

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
  const expectedSource = `./assets/readme/${asset}`;
  return imageTags(source).some((tag) => {
    const attributes = imageAttributes(tag);
    if (!attributes) return false;

    const sources = attributes.filter(({ name }) => name === 'src');
    const alternatives = attributes.filter(({ name }) => name === 'alt');
    return (
      sources.length === 1 &&
      alternatives.length === 1 &&
      sources[0].value === expectedSource &&
      hasVisibleHtmlText(alternatives[0].value)
    );
  });
};

describe('documentation contract', () => {
  it('keeps the documentation graph complete and linkable', () => {
    expect(verifyDocs({ root })).toEqual([]);
    expect(requiredDocuments).toHaveLength(15);
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
    for (const command of ['npm run dev', 'npm run dev:status', 'npm run dev:stop', 'npm run verify:local']) expect(local).toContain(command);
    for (const command of [
      'docker-deploy.sh',
      'configure.sh',
      'validate-compose.sh',
      'docker compose up -d --build --wait',
      'docker compose build request-policy',
      'docker compose up -d --no-build --pull never --wait',
    ]) {
      expect(docker).toContain(command);
    }
    for (const command of ['docker compose ps', 'docker compose logs', 'docker compose stop', 'docker compose start', 'docker compose down']) {
      expect(docker).toContain(command);
    }
    expect(docker).toContain('不要直接执行 `cat .env`');
    expect(docker).toContain('无需手动填写');
    expect(local).toContain('http://127.0.0.1:5173/');
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

  it('documents the production logging privacy and retention contract', () => {
    const security = read('docs/security.md');
    const operations = read('docs/operations.md');
    const architecture = read('docs/architecture.md');

    for (const document of [security, operations, architecture]) {
      expect(document).toContain('Asia/Shanghai');
      expect(document).toContain('短码');
    }
    for (const text of ['路由模板', '成功的 `/healthz`', '10 MB', '3 个']) {
      expect(operations).toContain(text);
    }
    expect(security).toContain('print_debug_info = false');
    expect(security).toContain('verbose');
    expect(security).toContain('持有即可访问');
    expect(security).toContain('SSRF');
    expect(security).toContain('开放重定向');
    expect(security).toContain('MYURLS_IMAGE');
  });

  it('keeps the current product story and local visual proof explicit', () => {
    const readme = read('README.md');

    for (const text of [
      '面向自托管维护者的在线订阅转换与短链服务',
      '固定黑色命令界面',
      'assets/readme/command-interface.png',
      'assets/readme/security-architecture.svg',
      'docker.io/keleyaa/subweb',
      'ghcr.io/keleyaa/subweb',
      'npm run verify:ci',
      '拒绝可变的 `latest`',
      'docs/validation/docker-integration.md',
      'docs/validation/interface.md',
      'deploy/subconverter/README.md',
    ]) {
      expect(readme).toContain(text);
    }
  });

  it('requires local visual proof to be rendered HTML images with descriptive alt text', () => {
    const asset = 'command-interface.png';
    const image = `<img alt="Subweb command interface" src="./assets/readme/${asset}">`;

    expect(hasEmbeddedReadmeImage(image, asset)).toBe(true);
    expect(hasEmbeddedReadmeImage(`\`\`\`html\n${image}\n\`\`\``, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`<!-- ${image} -->`, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`assets/readme/${asset}`, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`<img alt="" src="./assets/readme/${asset}">`, asset)).toBe(false);
    expect(
      hasEmbeddedReadmeImage('<img alt="Wrong path" src="./assets/readme/command-interfaceXpng">', asset),
    ).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        '<img alt="Subweb command interface" src="./assets/readme/command-interface.png" src="./assets/readme/wrong.png">',
        asset,
      ),
    ).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        '<img alt="" alt="Subweb command interface" src="./assets/readme/command-interface.png">',
        asset,
      ),
    ).toBe(false);
    for (const alt of [
      '&#32;&#10;',
      '&nbsp;',
      '&ensp;',
      '&emsp;',
      '&thinsp;',
      '&hairsp;',
      '&MediumSpace;',
      '&VeryThinSpace;',
      '&VeryThickMathSpace;',
      '&ZeroWidthSpace;',
      '&NegativeVeryThinMathSpace;',
      '&NegativeThinSpace;',
      '&NegativeMediumSpace;',
      '&NegativeThickSpace;',
      '&Tab;',
      '&NewLine;',
      '&#32;',
      '&#32',
      '&#10;',
      '&#x20;',
      '&#x20',
      '&#x200B;',
      '&#x200B',
    ]) {
      expect(hasEmbeddedReadmeImage(`<img alt="${alt}" src="./assets/readme/${asset}">`, asset)).toBe(false);
    }
    for (const alt of ['&NoBreak;', '&copy;']) {
      expect(hasEmbeddedReadmeImage(`<img alt="${alt}" src="./assets/readme/${asset}">`, asset)).toBe(false);
    }
    expect(hasEmbeddedReadmeImage(`<img alt="Subconverter Web &copy;" src="./assets/readme/${asset}">`, asset)).toBe(true);
    expect(hasEmbeddedReadmeImage(`<img alt="订阅服务架构" src="./assets/readme/${asset}">`, asset)).toBe(true);
  });

  it('embeds the current interface and security architecture as descriptive local HTML images', () => {
    const readme = read('README.md');

    for (const asset of ['command-interface.png', 'security-architecture.svg']) {
      expect(hasEmbeddedReadmeImage(readme, asset)).toBe(true);
    }
  });

  it('documents the Rust MyUrls release and safe rollback boundary', () => {
    const readme = read('README.md');
    const architecture = read('docs/architecture.md');
    const configuration = read('docs/configuration.md');
    const integration = read('docs/validation/docker-integration.md');
    const maintenance = read('docs/maintenance.md');

    for (const document of [readme, architecture]) {
      expect(document).toContain('MyUrls Rust');
      expect(document).toContain('v2.0.6');
    }
    expect(configuration).toContain('不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像');
    expect(integration).toContain('v2.0.6 生产镜像');
    expect(integration).toContain('challenge/retry');
    expect(maintenance).not.toContain('/Users/li/Desktop/GitHub/MyUrls');
  });

  it('keeps the follow-the-latest image policy out of stale pinning language', () => {
    // 自 follow-the-latest 策略（commit 59da405）生效后，这些文档不得再出现
    // 固定镜像/唯一 latest/旧版本卷名等过时表述；docs/validation 下的历史
    // 验证记录允许保留时点注记，不列入本断言。
    const policyDocuments = [
      'README.md',
      'docs/deployment-docker.md',
      'docs/architecture.md',
      'docs/maintenance.md',
      'docs/operations.md',
      'docs/security.md',
      'docs/third-party-sources.md',
      'deploy/subconverter/README.md',
    ];
    for (const file of policyDocuments) {
      const source = read(file);
      expect(source, file).not.toContain('使用锁定镜像');
      expect(source, file).not.toContain('固定镜像摘要');
      expect(source, file).not.toContain('固定 digest');
      expect(source, file).not.toContain('唯一允许');
      expect(source, file).not.toContain('禁止使用 `latest`');
      expect(source, file).not.toContain('subconverter-runtime-v1-2-0');
      expect(source, file).not.toContain('卷名绑定锁文件版本');
    }
  });
});
