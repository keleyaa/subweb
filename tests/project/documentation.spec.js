import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  requiredDocuments,
  runtimeContractFiles,
  verifyDocs,
} from "../../scripts/verify-docs.mjs";

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
    expect(requiredDocuments).toHaveLength(19);
  });

  it("records the deployment-contract integration baseline before changing it", () => {
    const baseline = read("docs/deployment-integration-baseline.md");

    for (const contract of [
      "四服务短链启用合同",
      "两服务短链关闭合同",
      "deploy/versions.lock.json",
      "Compose profile 不能作为隐藏必填变量的条件机制",
    ]) {
      expect(baseline).toContain(contract);
    }
  });

  it("documents the generated deployment contract and managed runtime images", () => {
    const readme = read("README.md");
    const docker = read("docs/deployment-docker.md");
    const configuration = read("docs/configuration.md");
    const maintenance = read("docs/maintenance.md");

    for (const document of [readme, docker, configuration, maintenance]) {
      expect(document).toContain("deploy/versions.lock.json");
    }
    expect(docker).toContain("compose.common-services.yaml");
    expect(configuration).toContain("runtime-image-contract.mjs");
    expect(configuration).toContain("不接受手工 `REDIS_IMAGE`、`SUBCONVERTER_IMAGE` 或 `MYURLS_IMAGE` 覆盖");
    expect(maintenance).toContain("runtime-image-contract.mjs");
  });

  it("keeps version examples aligned with the current immutable image contract", () => {
    const envExample = read(".env.example");
    const vps = read("docs/deployment-vps.md");

    expect(envExample).toContain("# SUBWEB_IMAGE=docker.io/keleyaa/subweb@sha256:<64-hex-digest>");
    expect(envExample).not.toMatch(/^#?\s*SUBWEB_IMAGE=.*:sha-/mu);
    for (const variable of ["REDIS_IMAGE", "SUBCONVERTER_IMAGE", "MYURLS_IMAGE"]) {
      expect(envExample).not.toMatch(new RegExp(`^#?\\s*${variable}=`, "mu"));
    }
    expect(envExample).toContain("configure.sh generates REDIS_IMAGE, SUBCONVERTER_IMAGE, and MYURLS_IMAGE");
    expect(vps).toContain("/srv/releases/subweb-vX.Y.Z");
    expect(vps).not.toContain("/srv/releases/subweb-v1.0.4");
  });

  it.each([
    ["v1.2.3 tag", "docker.io/keleyaa/subweb:v1.2.3", true],
    ["latest tag", "ghcr.io/keleyaa/subweb:latest", true],
    ["sha tag", "docker.io/keleyaa/subweb:sha-deadbee", true],
    [
      "tag and digest ambiguity",
      `docker.io/keleyaa/subweb:v1.2.3@sha256:${"a".repeat(64)}`,
      true,
    ],
    [
      "Docker Hub digest",
      `docker.io/keleyaa/subweb@sha256:${"a".repeat(64)}`,
      false,
    ],
    [
      "GHCR digest",
      `ghcr.io/keleyaa/subweb@sha256:${"b".repeat(64)}`,
      false,
    ],
    [
      "registry-port digest",
      `registry.example:5000/repository/subweb@sha256:${"c".repeat(64)}`,
      false,
    ],
    [
      "documented placeholder",
      "docker.io/keleyaa/subweb@sha256:<64-hex-digest>",
      false,
    ],
  ])("validates the %s SUBWEB_IMAGE example", (_label, image, rejectsImage) => {
    const envExamplePath = path.join(root, ".env.example");
    const originalEnvExample = fs.readFileSync(envExamplePath, "utf8");

    try {
      fs.writeFileSync(
        envExamplePath,
        originalEnvExample.replace(
          "# SUBWEB_IMAGE=docker.io/keleyaa/subweb@sha256:<64-hex-digest>",
          `# SUBWEB_IMAGE=${image}`,
        ),
      );

      expect(verifyDocs({ root }).includes("env example uses a mutable Gateway image tag")).toBe(
        rejectsImage,
      );
    } finally {
      fs.writeFileSync(envExamplePath, originalEnvExample);
    }
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

  it("distinguishes external proxy hosts for both short-link deployment profiles", () => {
    const deployment = read("docs/deployment.md");
    const docker = read("docs/deployment-docker.md");

    for (const document of [deployment, docker]) {
      expect(document).toContain(
        "短链启用时外层反向代理转发 `APP_DOMAIN`、`API_DOMAIN` 和 `SHORT_DOMAIN`",
      );
      expect(document).toContain(
        "短链关闭时不设置 `SHORT_DOMAIN` 或短链路由，外层反向代理只转发 `APP_DOMAIN` 和 `API_DOMAIN`",
      );
    }
  });

  it("documents the Gateway image boundary separately from locked dependencies", () => {
    const deployment = read("docs/deployment.md");

    expect(deployment).toContain("Gateway 发布镜像由 release workflow 独立构建");
    expect(deployment).toContain("`--version vX.Y.Z` 仅通过 GHCR 解析为不可变 manifest digest");
    expect(deployment).toContain("直接 `--image` 只接受与 registry 无关的 `repository@sha256:<digest>` 引用");
    expect(deployment).toContain("不能传入 Git tag 或 `latest`");
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
      "docs/deployment-vps.md",
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
    expect(local).toContain("http://127.0.0.1:5173/");
    expect(local).toContain("compose.dev.yaml");
    expect(local).toContain("myurls");
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

  it("documents Docker installation and immutable image-selection contracts", () => {
    const readme = read("README.md");
    const docker = read("docs/deployment-docker.md");
    const configuration = read("docs/configuration.md");
    const maintenance = read("docs/maintenance.md");
    const versionResolutionToken = "`--version vX.Y.Z` 仅通过 GHCR";
    const directDigestToken = "`--image` 是直接传入的、与 registry 无关的不可变 digest 镜像输入";
    const equivalentRegistriesToken = "Docker Hub 与 GHCR 的 release digest";

    expect(readme).toMatch(/^\.\/scripts\/subweb\.sh install$/m);
    expect(docker).toContain("不带参数的 `./scripts/subweb.sh install`");
    expect(docker).toContain("只在交互式终端打开安装向导");
    expect(docker).toContain("APP 域名");
    expect(docker).toContain("API 域名");
    expect(configuration).toContain(
      "| `SHORT_LINKS_ENABLED` | `true` | `false` |",
    );
    expect(docker).toContain("仅启用短链时询问 SHORT 域名和 Turnstile Site Key");
    expect(docker).toContain("`TRUSTED_PROXY_CIDR`");
    expect(docker).toContain("Gateway 发布版本 `vX.Y.Z`");

    const releaseResolution = docker.indexOf("不可变 GHCR manifest digest");
    const configurationWrite = docker.indexOf("生成权限为 `0600` 的 `.env`");
    const imagePull = docker.indexOf("拉取镜像");
    expect(releaseResolution).toBeGreaterThan(-1);
    expect(configurationWrite).toBeGreaterThan(releaseResolution);
    expect(imagePull).toBeGreaterThan(configurationWrite);
    expect(docker).toContain("不含 Turnstile Secret Key 的确认摘要");
    expect(docker).toContain("仅启用短链时，确认后才通过既有隐藏输入流程获取 Turnstile Secret Key");
    expect(docker).toContain("只接受 `yes` 才会继续");
    expect(docker).toContain("不会使用 `latest`");
    expect(docker).toContain("版本 tag 不会直接写入运行时配置");
    expect(docker).toContain("`--image ghcr.io/keleyaa/subweb@sha256:<digest>`");
    expect(docker).toContain("`--version` 与 `--image` 互斥");
    expect(docker).toContain("不要将 `latest` 或发布版本 tag 传给 `--image`");
    expect(docker).toContain("`--turnstile-secret-key-stdin`");
    expect(docker).toContain("管道传入");
    expect(configuration).toMatch(/Secret Key.*不能提交到 Git.*放入日志/u);

    expect(docker).toContain("在首次安装向导中选择 `false` 时");
    expect(docker).toContain("不会询问 SHORT 域名、Turnstile Site Key 或 Secret Key");
    expect(docker).toContain("不会启动 Redis 或 MyUrls");
    expect(docker).toContain("只运行 `gateway` 和 `subconverter`");
    expect(docker).toContain("现有显式配置方式保留给高级或手动操作");
    expect(docker).toContain("./scripts/configure.sh");
    expect(docker).toContain("runtime-image contract 派生，不能手工覆盖");
    expect(docker).not.toContain("./scripts/docker-deploy.sh install");
    expect(docker).not.toContain("SHORT_LINKS_ENABLED=false ./scripts/configure.sh");

    for (const document of [readme, docker, configuration]) {
      expect(document).toContain("--version vX.Y.Z");
      expect(document).toContain("GHCR");
      expect(document).toContain("不可变");
      expect(document).toContain("digest");
      expect(document).toContain("--image");
      expect(document).toContain("@sha256:<digest>");
      expect(document).toContain("`--version` 与 `--image` 互斥");
      expect(document).toContain(versionResolutionToken);
      expect(document).toContain(directDigestToken);
      expect(document).toContain(equivalentRegistriesToken);
      expect(document.indexOf(versionResolutionToken)).toBeLessThan(
        document.indexOf(directDigestToken),
      );
    }
    expect(readme).toContain("不会将版本 tag 直接写入运行时配置");
    expect(readme).toContain("`--image` 不接收 `latest` 或发布版本 tag");
    expect(maintenance).toContain("packages: write");
    expect(maintenance).toContain("不可变多平台 manifest digest");
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
    expect(read("docs/deployment.md")).toContain("四个服务");
    expect(read("docs/deployment.md")).toContain("SHORT_LINKS_ENABLED=false");
    expect(read("docs/architecture.md")).toContain("Go Gateway");
    expect(read("docs/architecture.md")).not.toContain("独立 Request Policy");
    expect(read("docs/deployment-docker.md")).toContain(
      "compose.disabled-short-links.yaml",
    );
    expect(read("docs/operations.md")).toContain("verify-unified-stack.sh");
  });

  it("audits every runtime workflow and production safety contract", () => {
    expect(runtimeContractFiles).toContain(".github/workflows/local-dev.yml");
    const production = read("docs/deployment-docker.md");
    const operations = read("docs/operations.md");
    for (const contract of [
      "`.env` 是权限 `0600` 的普通文件",
      "down` 只停止服务，不使用 `--volumes`",
      "RDB format version 15",
    ]) {
      expect(`${production}\n${operations}`).toContain(contract);
    }
  });

  it("rejects stale runtime versions and retired current-service claims", () => {
    const currentDocs = [
      ...requiredDocuments,
      ".env.example",
      ".github/workflows/docker-build-release.yml",
    ].map(read).join("\n");

    expect(currentDocs).not.toMatch(/(?:Redis\s*v?\s*8(?:\.\d+)?|redis\s*:\s*8|8\.10\.1|两个 MyUrls 服务|two MyUrls services|myurls-app|myurls-short|双上游 Compose)/iu);
    for (const asset of ["docs/assets/readme/subweb-hero.svg", "docs/assets/readme/subweb-architecture.svg"]) {
      expect(read(asset)).not.toMatch(/(?:Redis\s*v?\s*8|two MyUrls services|MyUrls APP|MyUrls SHORT|separate MyUrls)/iu);
    }
  });

  it("keeps the current product story and local visual proof explicit", () => {
    const readme = read("README.md");

    for (const text of [
      "面向自托管维护者的在线订阅转换与短链服务",
      "固定黑色命令界面",
      "assets/readme/command-interface.png",
      "assets/readme/security-architecture.svg",
      "ghcr.io/keleyaa/subweb",
      "npm run verify:ci",
      "`--image` 不接收 `latest` 或发布版本 tag",
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
      expect(document).toContain("v2.0.8");
    }
    expect(configuration).toContain(
      "不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像",
    );
    expect(integration).toContain("v2.0.8");
    expect(integration).toContain("challenge_required");
    expect(integration).toContain("不证明成功 token 的在线兑换");
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

  it("makes short-link enablement explicit in automated Docker installation", () => {
    const readme = read("README.md");
    const continuation = String.fromCharCode(92);

    expect(readme).toContain([
      "  --api-domain api.example.com " + continuation,
      "  --short-links-enabled true " + continuation,
      "  --short-domain short.example.com " + continuation,
    ].join("\n"));
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
    expect(read("docs/architecture.md")).toContain("四个服务");
    expect(read("docs/architecture.md")).toContain("两服务");
    expect(read("docs/operations.md")).toContain("外部 TLS");
  });
});
