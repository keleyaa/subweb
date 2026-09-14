# 仓库正规化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Subweb 的仓库级生产部署、Git tag 发布、CI/CD、文档和验证合同收敛成一套可重复、可审计的 Phase A 实现。

**架构：** 保留现有 Docker Compose、Go Gateway、SubConverter、MyUrls 和 Redis 四服务边界。`scripts/subweb.sh` 是生产操作入口，`deploy/versions.lock.json` 锁定外部运行时，Git tag `vX.Y.Z` 是产品发布身份，CI 在发布前验证同一提交的代码、容器和文档。

**技术栈：** POSIX shell、Docker Compose v2、GitHub Actions、Node.js 24、npm lockfile、Vitest、Playwright、Go tests、Trivy、actionlint、ShellCheck。

---

## 文件清单

### 生产命令与运行时边界

- 修改：`scripts/subweb.sh`，统一生产配置前置检查、操作语义和错误消息。
- 修改：`scripts/docker-deploy.sh`，保持安装流程与 Git tag/不可变 Gateway 镜像合同一致。
- 修改：`scripts/operations/backup-redis.sh`、`scripts/operations/restore-redis.sh`，确保备份和恢复结果可审计且不暴露秘密。
- 修改：`scripts/operations/lib.sh`，复用锁定 Redis 镜像和文件权限检查。
- 测试：创建 `tests/deploy/productionCommand.spec.js`，覆盖 `.env`、`down` 数据保留、备份/恢复参数和失败消息。

### 版本与 CI/CD

- 修改：`.github/workflows/docker-build-release.yml`，严格验证 `vX.Y.Z` tag，保持 quality 与 release 的提交身份一致，并保存不可变发布证据。
- 修改：`.github/workflows/local-dev.yml`，保留本地 Compose 契约 job，并加入 PR/main 的仓库质量门禁 job。
- 创建：`scripts/verify-workflows.sh`，对所有 `.github/workflows/*.yml` 执行 actionlint，并返回明确的成功 marker。
- 修改：`package.json`，加入 `verify:workflows` 和分层质量命令，不改变 `version` 作为 npm 工具元数据的含义。
- 修改：`tests/project/releaseGate.spec.js`，锁定版本正则、SHA 比较顺序、发布前置门禁和失败路径。
- 创建：`tests/project/workflowContract.spec.js`，验证工作流触发器、权限、固定 Action 引用和质量 job 步骤。

### 文档、锁和验证

- 修改：`scripts/verify-docs.mjs`，覆盖用户文档和 README 架构资产中的旧服务名、服务数量、Redis 版本和可变 tag。
- 修改：`tests/project/documentation.spec.js`，覆盖全部用户可见文档与架构资产。
- 修改：`docs/deployment.md`、`docs/deployment-docker.md`、`docs/maintenance.md`、`docs/operations.md`、`README.md`，记录唯一命令入口、tag 版本来源、失败处理和 CI 管理员配置。
- 修改：`.env.example`，保持当前四服务描述和 Git tag 发布规则。
- 修改：`tests/deploy/versionLocks.spec.js`，覆盖 Redis 7.4.11 Alpine 锁和非法 runtime 引用。
- 修改：`tests/deploy/composeProfiles.spec.js`、`tests/deploy/composeStack.spec.js`，覆盖四服务/两服务 profile 和数据卷安全语义。

### 不在本计划中的文件

- 不创建或修改 systemd unit、VPS `/opt/subweb` 布局、定时任务、日志轮转或主机级 TLS 配置；这些属于 Phase B。
- 不修改 Redis 数据格式、不添加 Redis 8→7 迁移程序、不在启动失败时自动删除 volume。

---

### 任务 1：锁定生产命令的配置和数据安全边界

**文件：**
- 修改：`scripts/subweb.sh:27-127`
- 修改：`scripts/docker-deploy.sh:114-179`
- 测试：`tests/deploy/productionCommand.spec.js`
- 测试：`tests/deploy/dockerImageDeploy.spec.js`

- [ ] **步骤 1：编写失败测试，验证生产命令必须使用真实 `.env`**

在 `productionCommand.spec.js` 中创建临时 fixture，复制 `scripts/subweb.sh`、`scripts/validate-compose.sh` 和 `scripts/lib/config.sh`，用假的 `docker` 可执行文件记录调用。对没有 `.env` 的 fixture 执行：

```js
const result = spawnSync('sh', [script, 'up'], {
  cwd: fixture,
  encoding: 'utf8',
  env: { ...process.env, PATH: `${fixture}/bin:${process.env.PATH}` },
});
expect(result.status).not.toBe(0);
expect(result.stderr).toContain('production .env is required');
expect(await readFile(join(fixture, 'docker.log'), 'utf8')).toBe('');
```

再写一个具有非 `0600` 权限的 `.env` fixture，断言命令拒绝启动并报告 `.env must be mode 0600`。

- [ ] **步骤 2：运行失败测试确认当前实现暴露缺口**

运行：

```sh
npx vitest run tests/deploy/productionCommand.spec.js
```

预期：新增的缺失 `.env` 和权限测试失败，现有测试保持通过。

- [ ] **步骤 3：实现生产配置前置检查**

在 `scripts/subweb.sh` 的 `install` 分支之后、Docker Compose 操作之前加入单一检查函数，并让除 `install` 外的命令调用它：

```sh
require_production_env() {
  [ -f "$ENV_FILE" ] || fail 'production .env is required; run scripts/configure.sh first.'
  [ ! -L "$ENV_FILE" ] || fail 'production .env must not be a symlink.'
  permissions=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
  [ "$permissions" = 600 ] || fail 'production .env must be mode 0600.'
}
```

保持 `compose down` 不带 `--volumes`，并让 `backup`、`restore` 继续通过绝对路径、普通文件和显式停止写入确认进行保护。`docker-deploy.sh install` 仍负责生成 `.env`，不会调用该检查函数。

- [ ] **步骤 4：运行定向测试确认通过**

运行：

```sh
npx vitest run tests/deploy/productionCommand.spec.js tests/deploy/dockerImageDeploy.spec.js
```

预期：所有测试通过；没有 `.env` 时 Docker fake 不得收到启动调用。

- [ ] **步骤 5：提交任务 1**

```sh
git add scripts/subweb.sh scripts/docker-deploy.sh scripts/operations tests/deploy/productionCommand.spec.js tests/deploy/dockerImageDeploy.spec.js
git commit -m "fix: enforce production deployment configuration"
```

### 任务 2：固定 Redis/Compose 的显式失败处理

**文件：**
- 修改：`scripts/subweb.sh:68-71`
- 修改：`scripts/operations/lib.sh:35-53`
- 修改：`scripts/operations/backup-redis.sh`
- 修改：`scripts/operations/restore-redis.sh`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/operations.md`
- 测试：`tests/operations/redisOperations.spec.js`
- 测试：`tests/deploy/composeProfiles.spec.js`

- [ ] **步骤 1：编写失败测试，锁定普通停止不删除数据**

在现有 Compose/脚本合同测试中读取生产停止路径，断言停止命令是 `docker compose ... down` 且不包含 `--volumes`。在 Redis 运维测试中加入不兼容 RDB 的错误文本断言：

```js
expect(source).toContain('compose down');
expect(source).not.toContain('compose down --volumes');
expect(errorOutput).toContain('Redis RDB format is incompatible with the locked Redis image');
```

- [ ] **步骤 2：运行定向测试确认失败**

运行：

```sh
npx vitest run tests/operations/redisOperations.spec.js tests/deploy/composeProfiles.spec.js
```

预期：数据保留测试在当前缺少明确错误合同时失败。

- [ ] **步骤 3：实现非破坏性运维消息和锁定镜像复用**

让 `scripts/operations/lib.sh` 的 `redis_image_reference` 继续唯一生成：

```sh
image.reference@image.digest
```

在备份/恢复校验失败时输出不含密码的固定消息，明确区分以下三种情况：

- Redis 容器没有运行；
- 备份文件不是普通文件或权限不安全；
- Redis 7 无法读取 Redis 8 RDB format 15。

不要在 `up`、`upgrade`、`restore` 或失败清理路径调用 `docker compose down --volumes`。文档明确写出：删除容器不会删除 volume；重置数据必须由操作者先备份，再手工确认具体 volume 名称后执行。

- [ ] **步骤 4：运行定向测试确认通过**

运行：

```sh
npx vitest run tests/operations/redisOperations.spec.js tests/deploy/composeProfiles.spec.js
```

预期：所有测试通过，脚本源码中只有显式的备份/恢复数据路径，没有启动失败自动清理 volume 的逻辑。

- [ ] **步骤 5：提交任务 2**

```sh
git add scripts/subweb.sh scripts/operations/lib.sh scripts/operations/backup-redis.sh scripts/operations/restore-redis.sh docs/deployment-docker.md docs/operations.md tests/operations/redisOperations.spec.js tests/deploy/composeProfiles.spec.js
git commit -m "fix: make Redis failure handling explicit"
```

### 任务 3：将 Git tag 固定为产品发布身份

**文件：**
- 修改：`.github/workflows/docker-build-release.yml:34-56,198-225`
- 修改：`docs/maintenance.md`
- 修改：`README.md`
- 测试：`tests/project/releaseGate.spec.js`

- [ ] **步骤 1：编写失败测试，拒绝非 `vX.Y.Z` 发布版本**

在 `releaseGate.spec.js` 中加入以下合同：

```js
expect(workflow).toContain('[[ "$VERSION" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]');
expect(workflow).toContain('[[ "$source_sha" == "$EXPECTED_SOURCE_SHA" ]]');
expect(workflow.indexOf('[[ "$source_sha" == "$EXPECTED_SOURCE_SHA" ]]')).toBeLessThan(
  workflow.indexOf('name: Set up QEMU'),
);
expect(workflow).not.toContain('npm pkg get version');
```

- [ ] **步骤 2：运行失败测试确认当前 tag 正则过宽**

运行：

```sh
npx vitest run tests/project/releaseGate.spec.js
```

预期：严格 `vX.Y.Z` 正则断言失败，SHA 断言保持通过。

- [ ] **步骤 3：实现严格 tag 校验和文档说明**

在 quality job 的 tag checkout 和 release job 的 `Set release tags` 中使用同一规则：

```bash
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo 'version must match vX.Y.Z' >&2
  exit 1
}
```

保留现有 quality/release SHA 比较，确保比较发生在 QEMU、登录 registry 和构建 candidate 之前。文档说明 `package.json` 只是 Node 工具链元数据，不作为产品发布版本来源。

- [ ] **步骤 4：运行工作流合同和语法测试**

运行：

```sh
npx vitest run tests/project/releaseGate.spec.js
actionlint .github/workflows/docker-build-release.yml
```

预期：测试和 actionlint 均通过。

- [ ] **步骤 5：提交任务 3**

```sh
git add .github/workflows/docker-build-release.yml docs/maintenance.md README.md tests/project/releaseGate.spec.js
git commit -m "ci: make Git tags the release authority"
```

### 任务 4：建立 PR/main 质量工作流合同

**文件：**
- 修改：`.github/workflows/local-dev.yml`
- 创建：`scripts/verify-workflows.sh`
- 修改：`package.json`
- 创建：`tests/project/workflowContract.spec.js`
- 测试：`tests/project/localWorkflow.spec.js`

- [ ] **步骤 1：编写失败的工作流合同测试**

在 `workflowContract.spec.js` 中读取两个 workflow，断言 PR 和 main 触发器、只读权限、固定 checkout/setup-node 引用，以及质量命令：

```js
expect(workflow).toContain('pull_request:');
expect(workflow).toContain('branches: [main]');
expect(workflow).toContain('permissions:\n  contents: read');
expect(workflow).toContain('run: npm run verify:ci');
expect(workflow).toContain('run: npm run verify:locks');
expect(workflow).toContain('run: npm run verify:docs');
expect(workflow).toContain('run: npm run verify:compose');
expect(workflow).not.toMatch(/uses: [^\n]+@v[0-9]/u);
```

- [ ] **步骤 2：运行失败测试确认质量 job 尚未完整存在**

运行：

```sh
npx vitest run tests/project/workflowContract.spec.js
```

预期：至少一个质量命令断言失败。

- [ ] **步骤 3：实现 workflow 验证命令**

创建 `scripts/verify-workflows.sh`，行为固定为：

```sh
#!/bin/sh
set -eu
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/*.yml
elif command -v docker >/dev/null 2>&1; then
  for workflow in .github/workflows/*.yml; do
    docker run --rm -v "$PWD:/repo:ro" rhysd/actionlint:1.7.7 "/repo/$workflow"
  done
else
  printf '%s\n' 'workflow verification requires actionlint or Docker.' >&2
  exit 2
fi
printf '%s\n' 'workflow contracts=passed'
```

在 `package.json` 加入：

```json
"verify:workflows": "./scripts/verify-workflows.sh"
```

在 `.github/workflows/local-dev.yml` 中保留 `compose-first` job，并增加 `quality` job：checkout、Node 24、`npm ci`、`npm run verify:ci`、`npm run verify:locks`、`npm run verify:production-readiness`、`npm run verify:compose`、`npm run verify:docs`、`npm run verify:evidence`、`npm run verify:workflows` 和 `shellcheck $(git ls-files '*.sh')`。每个 job 使用 `if: always()` 清理临时 Compose 资源，所有 Action 使用 commit SHA。

- [ ] **步骤 4：运行工作流合同测试和 actionlint**

运行：

```sh
npx vitest run tests/project/workflowContract.spec.js tests/project/localWorkflow.spec.js
npm run verify:workflows
```

预期：两个测试文件通过，输出 `workflow contracts=passed`。

- [ ] **步骤 5：提交任务 4**

```sh
git add .github/workflows/local-dev.yml scripts/verify-workflows.sh package.json tests/project/workflowContract.spec.js tests/project/localWorkflow.spec.js
git commit -m "ci: add pull request quality gates"
```

### 任务 5：统一文档、版本锁和测试层级合同

**文件：**
- 修改：`scripts/verify-docs.mjs`
- 修改：`tests/project/documentation.spec.js`
- 修改：`tests/deploy/versionLocks.spec.js`
- 修改：`tests/deploy/composeProfiles.spec.js`
- 修改：`docs/deployment.md`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/maintenance.md`
- 修改：`docs/operations.md`
- 修改：`README.md`
- 修改：`.env.example`

- [ ] **步骤 1：编写失败的当前系统合同测试**

在 `documentation.spec.js` 中将用户可见文件集中为数组，至少覆盖 README、部署、维护、运维、`.env.example`、两个 README SVG 和 release workflow。加入以下断言：

```js
for (const source of currentDocuments) {
  expect(source).not.toMatch(/Redis\s*v?\s*8|redis\s*:\s*8|two MyUrls services|MyUrls APP|MyUrls SHORT|five containers/iu);
}
```

在 `versionLocks.spec.js` 中断言 Redis repository、source tag、image reference、manifest digest 和两个平台 digest 均存在且格式正确。

- [ ] **步骤 2：运行文档和锁测试确认失败**

运行：

```sh
npx vitest run tests/project/documentation.spec.js tests/deploy/versionLocks.spec.js tests/deploy/composeProfiles.spec.js
```

预期：测试会指出任何仍存在的旧描述或未覆盖的锁合同。

- [ ] **步骤 3：实现集中门禁和分层命令**

让 `scripts/verify-docs.mjs` 使用明确的 `runtimeContractFiles` 列表，拒绝旧 Redis、旧 MyUrls 服务名、错误服务数量和 mutable tag；不要扫描测试文件中的故意负例。文档统一使用：

- Git tag `vX.Y.Z` 作为产品版本；
- `deploy/versions.lock.json` 作为外部 runtime 锁；
- 启用短链时四服务；
- `down` 不删除数据；
- Redis 8 RDB 不能由 Redis 7 自动迁移；
- `npm run verify:ci`、`npm run verify:integration`、`npm run verify:operations` 和 `npm run verify:release` 的职责边界。

- [ ] **步骤 4：运行文档、锁和分层测试**

运行：

```sh
npx vitest run tests/project/documentation.spec.js tests/deploy/versionLocks.spec.js tests/deploy/composeProfiles.spec.js
npm run verify:docs
npm run verify:locks
npm run verify:compose
```

预期：测试和四个命令全部通过，并输出 `documentation contracts=passed`、`Version locks are valid.` 和 Compose 合同成功 marker。

- [ ] **步骤 5：提交任务 5**

```sh
git add scripts/verify-docs.mjs tests/project/documentation.spec.js tests/deploy/versionLocks.spec.js tests/deploy/composeProfiles.spec.js docs README.md .env.example
git commit -m "docs: enforce current deployment contracts"
```

### 任务 6：完整验证、审查和 Phase B 交接

**文件：**
- 修改：`docs/maintenance.md`，记录最终发布前检查和 GitHub 管理员配置。
- 修改：`docs/superpowers/specs/2026-09-14-repository-formalization-design.md`，仅在验收后更新状态和实际命令。
- 测试：全部现有测试和新增测试。

- [ ] **步骤 1：执行完整仓库质量验证**

运行：

```sh
npm ci
npm test
npm run lint
npm run build
npm run verify:ci
npm run verify:workflows
npm run verify:locks
npm run verify:production-readiness
npm run verify:compose
npm run verify:docs
npm run verify:evidence
git diff --check
```

预期：所有命令返回 `0`；Docker 相关命令的输出包含明确成功 marker。

- [ ] **步骤 2：执行真实 release gate**

运行：

```sh
npm run verify:release
```

预期：日志末尾包含：

```text
image security verification=passed
deployment evidence=passed
release verification=passed
```

- [ ] **步骤 3：检查安全和仓库卫生**

运行：

```sh
git status --short
git diff --cached --check
if git grep -n -E 'ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|-----BEGIN [A-Z ]+ PRIVATE KEY-----|REDIS_PASSWORD=[^$<{[:space:]]{16,}' -- ':!tests/**' ':!.env.example'; then
  printf '%s\n' 'sensitive-looking values found in tracked source.' >&2
  exit 1
fi
```

预期：没有被提交的秘密、`.env`、临时 RDB、构建输出或 Docker 资源；`.runtime/` 继续被忽略。

- [ ] **步骤 4：执行双视角代码审查**

审查生产命令的非破坏性语义、CI 的提交身份、Action 权限、文档覆盖和测试假阴性。任何 Critical 或 High 问题在提交 Phase A 前修复并重新运行受影响的 gate。

- [ ] **步骤 5：提交验收记录**

```sh
git add docs/maintenance.md docs/superpowers/specs/2026-09-14-repository-formalization-design.md
git commit -m "docs: record repository formalization verification"
```

- [ ] **步骤 6：创建 Phase B 设计入口**

在 Phase A 所有验收标准通过后，单独创建 `docs/superpowers/specs/2026-09-14-vps-runtime-design.md`，只覆盖单台 Linux VPS 的 systemd、`/opt/subweb`、备份 timer、日志轮转、外部 TLS 代理和灾难恢复；不得在 Phase A 中提前实现这些主机层功能。

---

## 执行顺序和提交边界

任务 1 → 任务 2 → 任务 3 → 任务 4 → 任务 5 → 任务 6 顺序执行。每个任务完成后必须保持测试通过并创建独立提交；任务 4 依赖任务 3 的 release identity 合同，任务 5 依赖任务 1 和任务 2 的错误/数据语义，任务 6 依赖全部前置任务。

Phase A 不修改生产数据，不删除已有 Redis volume，不运行 Redis 主版本迁移，也不引入第二套部署入口。