# 交互式部署向导实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让人工部署者通过无参数 `./scripts/subweb.sh install` 的交互式向导输入明确的 `vX.Y.Z` Gateway 版本，同时将解析出的不可变 GHCR manifest digest 持久化并继续使用既有安全部署链路。

**架构：** 新建一个无副作用的 shell 库，将严格的发布版本映射为 GHCR 不可变引用。`docker-deploy.sh` 用该库支持自动化 `--version` 参数，且仍将最终 digest 传给既有 `configure.sh`；新向导复用同一库来在确认前展示 digest，并只调用部署器。`subweb.sh` 保持命令分发职责，仅在无额外参数的交互式 `install` 调用中进入向导。

**技术栈：** POSIX `sh`、Docker Buildx `imagetools inspect`、Docker Compose v2、Node.js 24、Vitest 5。

---

## 文件结构

- 创建：`scripts/lib/release-image.sh` - 校验 `vX.Y.Z` 并将 GHCR release tag 解析为不可变 manifest digest；不写文件、不拉取或启动容器。
- 创建：`scripts/install-wizard.sh` - 收集非秘密终端输入、解析版本、显示确认摘要，随后调用 `docker-deploy.sh`。
- 修改：`scripts/docker-deploy.sh:12-127` - 增加互斥的 `--version` 输入，并在读取秘密或写入 `.env` 前解析为既有 `--image` 语义。
- 修改：`scripts/subweb.sh:19-25` - 仅在无参数、交互终端的 `install` 调用中分发至向导；保留现有参数化安装路径。
- 创建：`tests/deploy/releaseImage.spec.js` - 测试版本解析器的格式检查、Buildx 调用、不可变引用和失败零副作用合同。
- 修改：`tests/deploy/dockerImageDeploy.spec.js:83-330` - 在已有临时部署 fixture 中测试 `--version`、与 `--image` 的互斥和解析失败时 `.env`/Compose 不变。
- 创建：`tests/deploy/interactiveInstall.spec.js` - 测试向导的启用/禁用 profile 参数、确认取消、解析失败和 non-TTY dispatcher 拒绝。
- 修改：`README.md:30-51` - 将人工快速开始改为无参数向导，并说明版本输入会被固定为 digest。
- 修改：`docs/deployment-docker.md:7-79` - 记录交互式、`--version` 自动化和现有 `--image` 自动化入口；明确没有 `latest` 默认值。
- 修改：`docs/configuration.md:66-68` - 说明 `SUBWEB_IMAGE` 的持久化值始终为 digest，而版本号仅是部署输入。
- 修改：`tests/deploy/dockerImageDeploy.spec.js:166-177` 的现有文档合同 - 断言公开文档不再要求人工复制 digest，仍禁止可变 tag 与手工外部 runtime 镜像覆盖。

## 任务 1：实现并锁定纯版本解析器

**文件：**
- 创建：`tests/deploy/releaseImage.spec.js`
- 创建：`scripts/lib/release-image.sh`

- [ ] **步骤 1：编写解析器的失败回归测试。**

在 `tests/deploy/releaseImage.spec.js` 建立临时目录和 fake `docker`，以 `spawnSync('sh', ['-c', ...])` source shell 库并调用 `resolve_release_image`。测试应该覆盖合法版本、非语义版本、无 Buildx、空 digest、格式错误 digest 与 Buildx 非零退出。每个失败 case 都断言 fake Docker 日志没有 `compose`、`pull` 或 `up` 调用。

```js
const runResolver = (root, version, env = {}) => spawnSync(
  'sh',
  ['-c', '. "$1"; resolve_release_image "$2"', 'sh', releaseImagePath, version],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env },
  },
);

it('resolves a semantic release version to an immutable GHCR reference', async () => {
  const root = await makeFixture({ digest: `sha256:${'a'.repeat(64)}` });
  const result = runResolver(root, 'v1.2.3');

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(`ghcr.io/keleyaa/subweb@sha256:${'a'.repeat(64)}`);
  expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
    'buildx imagetools inspect ghcr.io/keleyaa/subweb:v1.2.3 --format {{.Manifest.Digest}}',
  );
});

it.each(['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'latest'])('rejects invalid version %s before Docker', async (version) => {
  const root = await makeFixture({ digest: `sha256:${'a'.repeat(64)}` });
  const result = runResolver(root, version);

  expect(result.status).not.toBe(0);
  await expect(readFile(join(root, 'docker.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
```

- [ ] **步骤 2：运行解析器测试，确认它因库文件不存在而失败。**

运行：

```sh
npm exec vitest run tests/deploy/releaseImage.spec.js
```

预期：FAIL，提示 `scripts/lib/release-image.sh` 不存在或 `resolve_release_image` 未定义。

- [ ] **步骤 3：创建最小的无副作用版本解析器。**

创建 `scripts/lib/release-image.sh`，只定义常量和函数；不得执行函数、不得写文件。实现必须将 Buildx 错误和无效 digest 写至标准错误，并只将成功的 immutable image reference 写至标准输出。

```sh
#!/bin/sh

readonly RELEASE_IMAGE_REPOSITORY='ghcr.io/keleyaa/subweb'

validate_release_version() {
  printf '%s\n' "${1-}" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
}

resolve_release_image() {
  version=${1-}
  validate_release_version "$version" || {
    printf 'Docker deployment error: --version must match vX.Y.Z.\n' >&2
    return 1
  }

  command -v docker >/dev/null 2>&1 || {
    printf 'Docker deployment error: Docker is not installed or not available in PATH.\n' >&2
    return 1
  }
  docker buildx version >/dev/null 2>&1 || {
    printf 'Docker deployment error: Docker Buildx is required to resolve --version.\n' >&2
    return 1
  }

  digest=$(docker buildx imagetools inspect "$RELEASE_IMAGE_REPOSITORY:$version" \
    --format '{{.Manifest.Digest}}') || {
    printf 'Docker deployment error: unable to resolve release version %s in GHCR.\n' "$version" >&2
    return 1
  }
  printf '%s\n' "$digest" | LC_ALL=C grep -Eq '^sha256:[0-9a-f]{64}$' || {
    printf 'Docker deployment error: release version %s did not resolve to a manifest digest.\n' "$version" >&2
    return 1
  }
  printf '%s@%s\n' "$RELEASE_IMAGE_REPOSITORY" "$digest"
}
```

- [ ] **步骤 4：运行解析器测试，确认所有合法与失败分支通过。**

运行：

```sh
npm exec vitest run tests/deploy/releaseImage.spec.js
```

预期：PASS；成功分支只输出 `ghcr.io/keleyaa/subweb@sha256:<64-hex>`，所有失败分支非零退出且没有 Compose 操作。

- [ ] **步骤 5：提交解析器增量。**

```sh
git add scripts/lib/release-image.sh tests/deploy/releaseImage.spec.js
git commit -m "feat: resolve release versions to digests"
```

## 任务 2：让参数化部署接受 `--version`

**文件：**
- 修改：`tests/deploy/dockerImageDeploy.spec.js:83-330`
- 修改：`scripts/docker-deploy.sh:12-150`

- [ ] **步骤 1：扩展临时部署 fixture 的 fake Docker。**

在 `makeFixture` 的 Docker shell stub 增加 `buildx version` 和可配置 `buildx imagetools inspect` case；将 `scripts/lib/release-image.sh` 复制到 fixture 的 `scripts/lib/`。为 `runDeploy` 提供 `DOCKER_RELEASE_DIGEST` 环境变量，让测试可精确控制解析结果。

```sh
case "$*" in
  'buildx version') exit "${DOCKER_BUILDX_STATUS:-0}" ;;
  'buildx imagetools inspect ghcr.io/keleyaa/subweb:'*)
    [ "${DOCKER_RESOLVE_STATUS:-0}" -eq 0 ] || exit "$DOCKER_RESOLVE_STATUS"
    printf '%s\n' "${DOCKER_RELEASE_DIGEST-}"
    ;;
esac
```

- [ ] **步骤 2：添加失败的 `--version` 部署合同测试。**

```js
it('resolves --version once and persists its digest image', async () => {
  const root = await makeFixture();
  const digest = `sha256:${'c'.repeat(64)}`;
  const result = runDeploy(root, ['--version', 'v1.2.3'], { DOCKER_RELEASE_DIGEST: digest });

  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(join(root, '.env'), 'utf8')).toContain(
    `SUBWEB_IMAGE=ghcr.io/keleyaa/subweb@${digest}\n`,
  );
  expect(await readFile(join(root, 'docker.log'), 'utf8')).toContain(
    'buildx imagetools inspect ghcr.io/keleyaa/subweb:v1.2.3 --format {{.Manifest.Digest}}',
  );
});

it('rejects --version combined with --image without writing .env or composing', async () => {
  const root = await makeFixture();
  const result = runDeploy(root, [
    '--version', 'v1.2.3', '--image', 'docker.io/keleyaa/subweb:sha-2bf1a9f',
  ]);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('--version and --image may not be used together');
  await expect(readFile(join(root, '.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
```

另加解析失败 case，断言 `.env` 不存在且 Docker 日志不包含 `compose`、`pull` 或 `up`。

- [ ] **步骤 3：运行部署测试，确认 `--version` 当前不受支持。**

运行：

```sh
npm exec vitest run tests/deploy/dockerImageDeploy.spec.js
```

预期：FAIL，`docker-deploy.sh` 报告 `Unknown argument: --version` 或尚未写入 digest `SUBWEB_IMAGE`。

- [ ] **步骤 4：在部署器中归一化版本输入。**

在 `scripts/docker-deploy.sh` source `scripts/lib/release-image.sh`。新增 `version` 和 `version_seen` 变量、`--version` parser 分支，并在参数解析完成后强制恰好一个 `--image` 或 `--version`。在读取 Turnstile stdin、调用 `configure.sh` 或运行 Compose 前，将版本解析为 `image`。

```sh
version=
version_seen=0

# 在参数 switch 中：
--version)
  [ "$version_seen" -eq 0 ] || fail '--version may be provided only once.'
  [ "$#" -ge 2 ] || fail '--version requires a value.'
  version=$2
  version_seen=1
  shift 2
  ;;

if [ "$image_seen" -eq 1 ] && [ "$version_seen" -eq 1 ]; then
  fail '--version and --image may not be used together.'
fi
[ $((image_seen + version_seen)) -eq 1 ] || \
  fail 'provide exactly one of --image or --version.'

if [ "$version_seen" -eq 1 ]; then
  image=$(resolve_release_image "$version") || exit 1
fi
```

保留现有 `--image` immutable 格式校验，并让解析后的 reference 通过同一校验。处理顺序必须保证解析失败不会读取 Turnstile Secret Key、调用 `configure.sh` 或运行 Compose。

- [ ] **步骤 5：运行部署测试，确认 `--image` 与 `--version` 均兼容。**

运行：

```sh
npm exec vitest run tests/deploy/dockerImageDeploy.spec.js tests/deploy/releaseImage.spec.js
```

预期：PASS；现有 `--image` 用例未改变，`--version` 只在一次解析后写入 digest。

- [ ] **步骤 6：提交参数化部署增量。**

```sh
git add scripts/docker-deploy.sh tests/deploy/dockerImageDeploy.spec.js
git commit -m "feat: accept release versions during deployment"
```

## 任务 3：添加无参数交互式安装向导

**文件：**
- 创建：`scripts/install-wizard.sh`
- 修改：`scripts/subweb.sh:19-25`
- 创建：`tests/deploy/interactiveInstall.spec.js`

- [ ] **步骤 1：编写向导与 dispatcher 的失败回归测试。**

在 `tests/deploy/interactiveInstall.spec.js` 创建临时 fixture，复制 `subweb.sh`、待创建向导、解析器库；以 stub `docker-deploy.sh` 将接收参数写入 `deploy-args.log`，以 fake Docker 记录 `buildx` 调用。直接运行向导时使用 piped stdin 测试输入流程；`subweb.sh install` 的 `spawnSync` 路径本身是 non-TTY，用它断言 fail closed。

```js
it('rejects parameterless install when stdin is not a terminal', async () => {
  const root = await makeFixture();
  const result = runSubweb(root, ['install']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('interactive terminal');
  await expect(readFile(join(root, 'deploy-args.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('passes confirmed enabled-profile inputs and resolved digest to the deployment entrypoint', async () => {
  const root = await makeFixture();
  const result = runWizard(root, [
    'app.example.com', 'api.example.com', 'true', 'short.example.com',
    'site-key', '172.16.0.0/20', 'v1.2.3', 'yes',
  ].join('\n') + '\n');

  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(join(root, 'deploy-args.log'), 'utf8')).toContain(
    '--image ghcr.io/keleyaa/subweb@sha256:' + 'd'.repeat(64),
  );
  expect(await readFile(join(root, 'deploy-args.log'), 'utf8')).toContain('--short-links-enabled true');
  expect(await readFile(join(root, 'deploy-args.log'), 'utf8')).not.toContain('TURNSTILE_SECRET_KEY');
});
```

额外覆盖：短链关闭时不传 SHORT/Turnstile 参数、确认输入非 `yes` 时不调用部署器、解析失败时不调用部署器且不创建 `.env`。

- [ ] **步骤 2：运行向导测试，确认缺少 dispatcher 与向导实现。**

运行：

```sh
npm exec vitest run tests/deploy/interactiveInstall.spec.js
```

预期：FAIL，找不到 `scripts/install-wizard.sh`，且当前 `subweb.sh install` 直接调用部署器而非给出 non-TTY 提示。

- [ ] **步骤 3：实现只编排的向导脚本。**

`install-wizard.sh` source `scripts/lib/release-image.sh`，通过 `printf`/`IFS= read -r` 收集输入，保留用户输入中的字面字符。它不得使用 `eval`、`source` 配置文件或直接写 `.env`。

```sh
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/lib/release-image.sh"

prompt_required() {
  label=$1
  value=
  while [ -z "$value" ]; do
    printf '%s: ' "$label" >&2
    IFS= read -r value || exit 1
  done
  printf '%s\n' "$value"
}

prompt_optional() {
  printf '%s: ' "$1" >&2
  IFS= read -r value || exit 1
  printf '%s\n' "$value"
}

prompt_boolean() {
  while :; do
    printf 'Enable short links (true/false): ' >&2
    IFS= read -r value || exit 1
    case "$value" in true|false) printf '%s\n' "$value"; return 0 ;; esac
    printf 'Enter true or false.\n' >&2
  done
}

app_domain=$(prompt_required 'APP domain')
api_domain=$(prompt_required 'API domain')
short_links_enabled=$(prompt_boolean)
set -- --app-domain "$app_domain" --api-domain "$api_domain" \
  --short-links-enabled "$short_links_enabled"

short_domain=
if [ "$short_links_enabled" = true ]; then
  short_domain=$(prompt_required 'SHORT domain')
  turnstile_site_key=$(prompt_required 'Turnstile Site Key')
  set -- "$@" --short-domain "$short_domain" --turnstile-site-key "$turnstile_site_key"
fi
trusted_proxy_cidr=$(prompt_optional 'Trusted proxy CIDR (leave empty when none)')
[ -z "$trusted_proxy_cidr" ] || set -- "$@" --trusted-proxy-cidr "$trusted_proxy_cidr"

version=$(prompt_required 'Gateway release version (vX.Y.Z)')
resolved_image=$(resolve_release_image "$version") || exit 1
printf '\nAPP: %s\nAPI: %s\n' "$app_domain" "$api_domain" >&2
[ "$short_links_enabled" = false ] || printf 'SHORT: %s\n' "$short_domain" >&2
printf 'Profile: short links %s\nTrusted proxy CIDR: %s\nGateway: %s -> %s\n' \
  "$short_links_enabled" "${trusted_proxy_cidr:-none}" "$version" "$resolved_image" >&2
printf 'Continue with this deployment (yes/no): ' >&2
IFS= read -r confirmation || exit 1
[ "$confirmation" = yes ] || {
  printf 'Deployment cancelled.\n' >&2
  exit 1
}

exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@" --image "$resolved_image"
```

构造 `$@` 时仅附加已选择 profile 所需的参数。短链启用传递 `--short-links-enabled true`、SHORT 域名、Site Key 和可选 CIDR；关闭传递 `--short-links-enabled false`，绝不附加短链或 Turnstile 参数。

- [ ] **步骤 4：在 dispatcher 中添加严格的 TTY gate。**

```sh
if [ "$command_name" = install ]; then
  if [ "$#" -eq 0 ]; then
    [ -t 0 ] && [ -t 2 ] || \
      fail 'install without arguments requires an interactive terminal; provide deployment arguments for automation.'
    exec "$SCRIPT_DIRECTORY/install-wizard.sh"
  fi
  exec "$SCRIPT_DIRECTORY/docker-deploy.sh" "$@"
fi
```

这保持任何带参数的现有安装命令逐字转发到部署器，并禁止 CI 因空参数而挂起。

- [ ] **步骤 5：运行向导、参数化部署与 feature-flag 回归。**

运行：

```sh
npm exec vitest run \
  tests/deploy/interactiveInstall.spec.js \
  tests/deploy/dockerImageDeploy.spec.js \
  tests/deploy/featureFlagDeploy.spec.js \
  tests/deploy/releaseImage.spec.js
```

预期：PASS；向导只在 direct wizard fixture 中执行；non-TTY dispatcher 拒绝无参数安装；全部既有 lifecycle profile 断言保持通过。

- [ ] **步骤 6：提交向导增量。**

```sh
git add scripts/install-wizard.sh scripts/subweb.sh tests/deploy/interactiveInstall.spec.js
git commit -m "feat: add interactive deployment wizard"
```

## 任务 4：同步生产文档与文档合同

**文件：**
- 修改：`README.md:30-51`
- 修改：`docs/deployment-docker.md:7-79`
- 修改：`docs/configuration.md:66-68`
- 修改：`tests/deploy/dockerImageDeploy.spec.js:166-177`

- [ ] **步骤 1：先添加文档合同回归。**

```js
it('documents the interactive installer and digest-pinning version input', async () => {
  const documentation = await readFile(new URL('docs/deployment-docker.md', repositoryRoot), 'utf8');
  const readme = await readFile(new URL('README.md', repositoryRoot), 'utf8');

  expect(readme).toContain('./scripts/subweb.sh install\n');
  expect(documentation).toContain('`vX.Y.Z`');
  expect(documentation).toContain('解析为不可变 manifest digest');
  expect(documentation).toContain('--version v1.2.3');
  expect(documentation).not.toContain('自动使用最新发布版');
});
```

- [ ] **步骤 2：运行文档合同，确认当前文档仍要求人工复制 digest。**

运行：

```sh
npm exec vitest run tests/deploy/dockerImageDeploy.spec.js
```

预期：FAIL，README 和 Docker 部署文档还没有交互向导与 `--version` 合同。

- [ ] **步骤 3：更新面向部署者的文档。**

将 README 快速开始替换为单条无参数 `install`，说明向导要求明确 `vX.Y.Z`、解析后展示 digest 并保存 immutable reference。Docker 部署文档增加自动化 `--version v1.2.3` 示例，保留 digest `--image` 作为已有自动化和 release-evidence 的精确入口。配置文档明确 `SUBWEB_IMAGE` 永远保存 digest，绝不保存产品 tag 或 `latest`。

```sh
# 人工首次部署
./scripts/subweb.sh install

# 自动化：短版本号在安装时解析并固定
printf '%s\n' "$TURNSTILE_SECRET_KEY" | ./scripts/subweb.sh install \
  --version v1.2.3 \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key "$TURNSTILE_SITE_KEY" \
  --turnstile-secret-key-stdin
```

- [ ] **步骤 4：运行文档与相关回归。**

运行：

```sh
npm exec vitest run tests/deploy/dockerImageDeploy.spec.js
npm run verify:docs
git diff --check
```

预期：全部通过；公开文档不要求手工复制 digest，也不建议 `latest` 或手工外部 runtime 镜像覆盖。

- [ ] **步骤 5：提交文档增量。**

```sh
git add README.md docs/deployment-docker.md docs/configuration.md tests/deploy/dockerImageDeploy.spec.js
git commit -m "docs: simplify interactive deployment instructions"
```

## 任务 5：执行完整部署与发布门禁

**文件：**
- 修改：无；只验证前四个任务的合并结果。

- [ ] **步骤 1：运行受影响部署测试集。**

运行：

```sh
npm exec vitest run \
  tests/deploy/releaseImage.spec.js \
  tests/deploy/interactiveInstall.spec.js \
  tests/deploy/dockerImageDeploy.spec.js \
  tests/deploy/featureFlagDeploy.spec.js \
  tests/deploy/composeStack.spec.js \
  tests/deploy/configureScript.spec.js
```

预期：PASS；所有版本解析、向导、profile 与文档合同均通过。

- [ ] **步骤 2：运行仓库级 CI 门禁。**

运行：

```sh
npm run verify:ci
```

预期：测试、Docker 集成、lint 和前端构建全部通过。

- [ ] **步骤 3：运行完整 release 门禁并保存可审计结果。**

运行：

```sh
npm run verify:release > /tmp/subweb-release-verify.log 2>&1
```

预期：命令退出为 `0`，日志含有明确的 `release verification=passed` 终止标记。只在观察到该标记后，才将发布验证视为通过。

- [ ] **步骤 4：检查最终差异、索引与工作树。**

运行：

```sh
git diff --check
git status --short
git log --oneline --max-count=5
```

预期：没有格式错误、未预期文件或遗漏的小提交。

- [ ] **步骤 5：执行独立代码审查并处理确认的问题。**

审查范围限定为版本解析、终端输入、secret 传递、Compose profile 选择、文档正确性和回归测试。任何确认的高优先级问题必须先修复并重跑受影响测试与完整 release 门禁，再合并或发布。
