# Docker Hub 与 GHCR 双发布实现计划

> **面向 AI 代理的工作者：** 在当前会话内按 TDD 顺序执行；步骤使用复选框跟踪进度。

**目标：** 让每次主分支镜像发行同时、可审计地发布到 Docker Hub 与 GHCR。

**架构：** 保留单次 `docker/build-push-action` 构建，登录两个注册表并为同一个输出增加两组标签。回滚清单保存两个注册表引用，文档提供默认源与备用源的等价部署命令。

**技术栈：** GitHub Actions、Docker Buildx、GHCR、Vitest、Markdown 文档门禁。

---

### 任务 1：锁定双发布工作流契约

**文件：**
- 修改：`tests/project/releaseGate.spec.js`
- 修改：`tests/project/documentation.spec.js`

- [x] 添加测试，要求 `release` 具有 `packages: write`、登录 `ghcr.io`、为两个注册表生成三类相同标签，并在回滚清单保存两个引用。
- [x] 添加文档测试，要求 README 与 Docker 部署文档明确列出 `docker.io/keleyaa/subweb` 和 `ghcr.io/keleyaa/subweb`。
- [x] 运行 `npx vitest run tests/project/releaseGate.spec.js tests/project/documentation.spec.js --maxWorkers=1`，确认因缺少 GHCR 发布契约而失败。

### 任务 2：实现单次构建双注册表推送

**文件：**
- 修改：`.github/workflows/docker-build-release.yml`

- [x] 给 `release` 添加 `packages: write`。
- [x] 使用 `docker/login-action`、`${{ github.actor }}` 和 `${{ secrets.GITHUB_TOKEN }}` 登录 `ghcr.io`。
- [x] 把 Docker Hub 与 GHCR 的 `latest`、日期提交标签和 `sha-*` 标签同时传入同一个 Buildx 步骤。
- [x] 让回滚 JSON 和 Actions 摘要记录两个注册表引用。
- [x] 重跑任务 1 的定向测试并确认通过。

### 任务 3：同步部署与维护文档

**文件：**
- 修改：`README.md`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/maintenance.md`

- [x] 说明 Docker Hub 是默认源、GHCR 是等价备用源，两者标签和 digest 一致。
- [x] 给出使用 GHCR 不可变 `sha-*` 标签的完整 `docker-deploy.sh --image` 命令。
- [x] 说明首次发布后仓库维护者需要把 GHCR Package 设为 Public，而部署者无需登录即可拉取公开镜像。
- [x] 运行 `npm run verify:docs` 和定向测试。

### 任务 4：完整验证

**文件：**
- 验证：全部本次修改

- [x] 运行 `npm run verify`。
- [x] 运行 `npm run verify:docs`、`npm run verify:evidence` 和 `git diff --check`。
- [x] 使用 Ruby YAML 解析器加载工作流文件，并检查 `git diff --stat` 与 `git status --short`。
- [x] 不在本地冒充远端发布成功；实际 GHCR 推送必须等工作流提交并推送后，从 Actions 日志与远端 manifest 验证。
