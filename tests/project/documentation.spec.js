import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requiredDocuments, verifyDocs } from "../../scripts/verify-docs.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const renderedMarkdown = (source) =>
  source
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/gu, "")
    .replace(/`[^`\n]*`/gu, "");

const decodeNumericHtmlEntities = (value) =>
  value.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));?/giu,
    (reference, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(
        hexadecimal ?? decimal,
        hexadecimal ? 16 : 10,
      );
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return reference;
      }
      return String.fromCodePoint(codePoint);
    },
  );

const namedHtmlEntities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};
const nonVisibleHtmlEntityNames = new Set([
  "emsp",
  "ensp",
  "hairsp",
  "mediumspace",
  "negativemediumspace",
  "negativethickspace",
  "negativethinspace",
  "negativeverythinmathspace",
  "newline",
  "nbsp",
  "tab",
  "thinsp",
  "verythickmathspace",
  "verythinspace",
  "zerowidthspace",
]);
const decodeHtmlEntities = (value) =>
  decodeNumericHtmlEntities(value).replace(
    /&([a-z][a-z0-9]*);/giu,
    (reference, name) => {
      const normalizedName = name.toLowerCase();
      if (nonVisibleHtmlEntityNames.has(normalizedName)) return " ";
      return namedHtmlEntities[normalizedName] ?? reference;
    },
  );
const normalizeHtmlAltText = (value) =>
  decodeHtmlEntities(value)
    .replace(/&[a-z][a-z0-9]*;/giu, "")
    .replace(/[\p{White_Space}\p{Cf}]+/gu, "");
const hasVisibleHtmlText = (value) =>
  /[\p{L}\p{N}]/u.test(normalizeHtmlAltText(value));

const imageTags = (source) =>
  renderedMarkdown(source).match(/<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/giu) ??
  [];
const imageAttributes = (tag) => {
  const attributes = [];
  let remainder = tag.slice(4, tag.endsWith("/>") ? -2 : -1).trim();

  while (remainder) {
    const match = /^([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/u.exec(
      remainder,
    );
    if (!match) return null;

    attributes.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3],
    });
    remainder = remainder.slice(match[0].length);
  }

  return attributes;
};

const hasEmbeddedReadmeImage = (source, asset) => {
  const expectedSource = `./assets/readme/${asset}`;
  return imageTags(source).some((tag) => {
    const attributes = imageAttributes(tag);
    if (!attributes) return false;

    const sources = attributes.filter(({ name }) => name === "src");
    const alternatives = attributes.filter(({ name }) => name === "alt");
    return (
      sources.length === 1 &&
      alternatives.length === 1 &&
      sources[0].value === expectedSource &&
      hasVisibleHtmlText(alternatives[0].value)
    );
  });
};

describe("documentation contract", () => {
  it("keeps the documentation graph complete and linkable", () => {
    expect(verifyDocs({ root })).toEqual([]);
    expect(requiredDocuments).toHaveLength(17);
  });

  it("documents exactly the approved deployment families and source lineage", () => {
    const readme = read("README.md");
    for (const name of ["本机源码", "Docker"]) expect(readme).toContain(name);
    for (const source of [
      "stilleshan/subweb",
      "keleyaa/MyUrls",
      "CareyWang/MyUrls",
      "Aethersailor/SubConverter-Extended",
    ])
      expect(readme).toContain(source);
    expect(readme).not.toMatch(/docker\s+(?:pull|run)[^\n]*:latest/iu);
  });

  it("does not document an unmaintained legacy image as a rollback artifact", () => {
    const thirdPartySources = read("docs/third-party-sources.md");

    expect(thirdPartySources).toContain("不提供已维护的镜像 digest 或 rollback manifest");
    expect(thirdPartySources).not.toContain("v1.13.0 digest 只保留在回滚说明中");
  });

  it("documents the Gateway image boundary separately from locked dependencies", () => {
    const deployment = read("docs/deployment.md");

    expect(deployment).toContain("Gateway 发布镜像由 release workflow 独立构建");
    expect(deployment).toContain("通过 `--image` 使用 Git tag 或 digest");
    expect(deployment).not.toContain("生产镜像、外部依赖版本和不可变 digest 由");
  });

  it("does not present retired runtime paths as supported documentation", () => {
    const currentDocs = [
      "README.md",
      "docs/architecture.md",
      "docs/architecture-prd.md",
      "docs/configuration.md",
      "docs/deployment.md",
      "docs/deployment-docker.md",
      "docs/deployment-local.md",
      "docs/deployment-nginx.md",
      "docs/maintenance.md",
      "docs/operations.md",
      "docs/security.md",
      "docs/validation/docker-integration.md",
      "docs/validation/local-dev.md",
      "assets/readme/security-architecture.svg",
      "docs/assets/readme/subweb-architecture.svg",
      "docs/assets/readme/subweb-hero.svg",
    ]
      .map(read)
      .join("\\n");

    for (const retired of [
      "Dockerfile.simple",
      "compose.hardened.yaml",
      "verify:simple",
      "合并容器",
      "六服务生产拓扑",
      "独立 Request Policy",
    ]) {
      expect(currentDocs).not.toContain(retired);
    }
  });

  it("keeps runnable commands and ignored runtime data explicit", () => {
    const readme = read("README.md");
    const local = read("docs/deployment-local.md");
    const docker = read("docs/deployment-docker.md");
    const maintenance = read("docs/maintenance.md");
    for (const document of [readme, local, docker]) {
      expect(document).toContain(
        "git clone https://github.com/keleyaa/subweb.git",
      );
      expect(document).toContain("cd subweb");
    }
    for (const command of [
      "npm run dev",
      "npm run dev:status",
      "npm run dev:stop",
      "npm run verify:local",
    ])
      expect(local).toContain(command);
    for (const command of [
      "subweb.sh install",
      "configure.sh",
      "subweb.sh verify",
      "subweb.sh up",
      "compose.yaml",
      "compose.disabled-short-links.yaml",
    ]) {
      expect(docker).toContain(command);
    }
    for (const command of [
      "subweb.sh status",
      "subweb.sh logs",
      "subweb.sh down",
      "subweb.sh backup",
      "subweb.sh restore",
    ]) {
      expect(docker).toContain(command);
    }
    expect(docker).not.toContain("docker-deploy.sh install");
    expect(docker).toContain("不要执行 `cat .env`");
    expect(docker).toContain("自动生成");
    expect(local).toContain("http://127.0.0.1:5173/");
    expect(local).toContain("compose.dev.yaml");
    expect(local).toContain("myurls-app");
    expect(local).toContain("myurls-short");
    expect(local).not.toContain("合并容器");
    expect(local).not.toContain("hardened Compose 的 Request Policy");
    expect(local).toContain("不要在其他项目目录执行");
    for (const ignored of [".env", ".runtime/", "dist/", "test-results/"])
      expect(maintenance).toContain(ignored);
  });

  it("applies the security header snippet in the external TLS proxy example", () => {
    const documentation = read("docs/deployment-nginx.md");
    expect(documentation).toContain("nginx/snippets/security-headers.conf");
    expect(documentation).toContain(
      "include /etc/nginx/snippets/security-headers.conf",
    );
  });

  it("documents Docker Hub and GHCR as equivalent release sources", () => {
    const readme = read("README.md");
    const docker = read("docs/deployment-docker.md");
    const maintenance = read("docs/maintenance.md");

    for (const document of [readme, docker, maintenance]) {
      expect(document).toContain("docker.io/keleyaa/subweb");
      expect(document).toContain("ghcr.io/keleyaa/subweb");
    }
    expect(docker).toContain("--image ghcr.io/keleyaa/subweb:sha-");
    expect(maintenance).toContain("packages: write");
  });

  it("documents the production logging privacy and retention contract", () => {
    const security = read("docs/security.md");
    const operations = read("docs/operations.md");
    const architecture = read("docs/architecture.md");

    for (const document of [security, operations, architecture]) {
      expect(document).toContain("Asia/Shanghai");
      expect(document).toContain("短码");
    }
    for (const text of [
      "10m",
      "最多 `3` 个文件",
      "verify-unified-stack.sh",
      "verify-redis-operations.sh",
    ]) {
      expect(operations).toContain(text);
    }
    expect(security).toContain("清除有效 capability");
    expect(security).toContain("Authorization");
    expect(security).toContain("持有即可访问");
    expect(security).toContain("SSRF");
    expect(security).toContain("IP_HASH_SECRET");
    expect(security).toContain("MYURLS");
    expect(read("docs/deployment.md")).toContain("五个服务");
    expect(read("docs/deployment.md")).toContain("SHORT_LINKS_ENABLED=false");
    expect(read("docs/architecture.md")).toContain("Go Gateway");
    expect(read("docs/architecture.md")).not.toContain("独立 Request Policy");
    expect(read("docs/deployment-docker.md")).toContain(
      "compose.disabled-short-links.yaml",
    );
    expect(read("docs/operations.md")).toContain("verify-unified-stack.sh");
  });

  it("keeps the current product story and local visual proof explicit", () => {
    const readme = read("README.md");

    for (const text of [
      "面向自托管维护者的在线订阅转换与短链服务",
      "固定黑色命令界面",
      "assets/readme/command-interface.png",
      "assets/readme/security-architecture.svg",
      "docker.io/keleyaa/subweb",
      "ghcr.io/keleyaa/subweb",
      "npm run verify:ci",
      "拒绝可变的 `latest`",
      "docs/validation/docker-integration.md",
      "docs/validation/interface.md",
      "deploy/subconverter/README.md",
    ]) {
      expect(readme).toContain(text);
    }
  });

  it("requires local visual proof to be rendered HTML images with descriptive alt text", () => {
    const asset = "command-interface.png";
    const image = `<img alt="Subweb command interface" src="./assets/readme/${asset}">`;

    expect(hasEmbeddedReadmeImage(image, asset)).toBe(true);
    expect(hasEmbeddedReadmeImage(`\`\`\`html\n${image}\n\`\`\``, asset)).toBe(
      false,
    );
    expect(hasEmbeddedReadmeImage(`<!-- ${image} -->`, asset)).toBe(false);
    expect(hasEmbeddedReadmeImage(`assets/readme/${asset}`, asset)).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        `<img alt="" src="./assets/readme/${asset}">`,
        asset,
      ),
    ).toBe(false);
    expect(
      hasEmbeddedReadmeImage(
        '<img alt="Wrong path" src="./assets/readme/command-interfaceXpng">',
        asset,
      ),
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
      "&#32;&#10;",
      "&nbsp;",
      "&ensp;",
      "&emsp;",
      "&thinsp;",
      "&hairsp;",
      "&MediumSpace;",
      "&VeryThinSpace;",
      "&VeryThickMathSpace;",
      "&ZeroWidthSpace;",
      "&NegativeVeryThinMathSpace;",
      "&NegativeThinSpace;",
      "&NegativeMediumSpace;",
      "&NegativeThickSpace;",
      "&Tab;",
      "&NewLine;",
      "&#32;",
      "&#32",
      "&#10;",
      "&#x20;",
      "&#x20",
      "&#x200B;",
      "&#x200B",
    ]) {
      expect(
        hasEmbeddedReadmeImage(
          `<img alt="${alt}" src="./assets/readme/${asset}">`,
          asset,
        ),
      ).toBe(false);
    }
    for (const alt of ["&NoBreak;", "&copy;"]) {
      expect(
        hasEmbeddedReadmeImage(
          `<img alt="${alt}" src="./assets/readme/${asset}">`,
          asset,
        ),
      ).toBe(false);
    }
    expect(
      hasEmbeddedReadmeImage(
        `<img alt="Subconverter Web &copy;" src="./assets/readme/${asset}">`,
        asset,
      ),
    ).toBe(true);
    expect(
      hasEmbeddedReadmeImage(
        `<img alt="订阅服务架构" src="./assets/readme/${asset}">`,
        asset,
      ),
    ).toBe(true);
  });

  it("embeds the current interface and security architecture as descriptive local HTML images", () => {
    const readme = read("README.md");

    for (const asset of [
      "command-interface.png",
      "security-architecture.svg",
    ]) {
      expect(hasEmbeddedReadmeImage(readme, asset)).toBe(true);
    }
  });

  it("documents the Rust MyUrls release and safe rollback boundary", () => {
    const readme = read("README.md");
    const architecture = read("docs/architecture.md");
    const configuration = read("docs/configuration.md");
    const integration = read("docs/validation/docker-integration.md");
    const maintenance = read("docs/maintenance.md");

    for (const document of [readme, architecture]) {
      expect(document).toContain("MyUrls Rust");
      expect(document).toContain("v2.0.6");
    }
    expect(configuration).toContain(
      "不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像",
    );
    expect(integration).toContain("v2.0.6");
    expect(integration).toContain("challenge/retry");
    expect(maintenance).not.toContain("/Users/li/Desktop/GitHub/MyUrls");
  });

  it("keeps generated deployment commands and lock boundaries current", () => {
    const readme = read("README.md");
    const workflow = read(".github/workflows/docker-build-release.yml");
    const localDeployment = read("docs/deployment-local.md");
    const dockerDeployment = read("docs/deployment-docker.md");
    const configuration = read("docs/configuration.md");
    const integration = read("docs/validation/docker-integration.md");
    const maintenance = read("docs/maintenance.md");
    const architecturePrd = read("docs/architecture-prd.md");

    for (const document of [readme, workflow, dockerDeployment]) {
      expect(document).toContain("--turnstile-secret-key-stdin");
      expect(document).not.toMatch(/--turnstile-secret-key\s+[^-\s]/u);
    }
    expect(localDeployment).not.toContain("npm run dev\nnpm run verify:local");
    expect(localDeployment).toContain("--env-file .runtime/local/compose.env");
    expect(dockerDeployment).toContain("Turnstile Site Key 与 Secret Key 必须由部署者提供");
    expect(configuration).not.toContain("仅接受与锁定合同兼容的不可变覆盖");
    expect(integration).toContain("仅替换 SubConverter");
    for (const document of [maintenance, architecturePrd]) {
      expect(document).toContain("Go race、Go vet、构建和 `git diff --check` 是需要另行执行");
      expect(document).not.toContain("发布 workflow 从同一版本锁构建 Gateway");
    }
  });

  it("keeps the immutable release contract in deployment documentation", () => {
    const policyDocuments = [
      "README.md",
      "docs/deployment-docker.md",
      "docs/architecture.md",
      "docs/maintenance.md",
      "docs/operations.md",
      "docs/security.md",
      "docs/third-party-sources.md",
      "deploy/subconverter/README.md",
    ];
    for (const file of policyDocuments) {
      const source = read(file);
      expect(source, file).toContain("锁定");
      expect(source, file).not.toMatch(/docker\s+(?:pull|run)[^\n]*:latest/iu);
    }
    expect(read("README.md")).toContain("SHORT_LINKS_ENABLED");
    expect(read("docs/architecture.md")).toContain("五个服务");
    expect(read("docs/architecture.md")).toContain("两服务");
    expect(read("docs/operations.md")).toContain("外部 TLS");
  });
});
