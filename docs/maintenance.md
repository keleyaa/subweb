# 维护指南

本文件描述当前独立维护仓库的日常变更、验证、发布和清理边界。上游仓库的旧脚本或文档不作为当前项目的操作依据。

## 远端约定

- `origin`：当前维护仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb)，日常推送只使用该远端。
- `upstream`：Fork 上游 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，仅用于查阅或手动同步上游改动；不要向它推送。
- `main`：可发布分支，应跟踪 `origin/main`。

README 的“Fork 与来源说明”是公开来源声明的唯一维护位置。更新上游关系或新增外部代码、素材、设计仓库参考时，必须先更新该说明及相应许可证/NOTICE，再提交。

## 变更与提交边界

提交前先确认范围，只加入项目源代码、测试、必要配置和公开文档：

```bash
git status --short
git add <明确的文件路径>
git diff --cached --name-only
```

另外运行 `git diff --check`，不要使用会把全部未跟踪文件一并纳入的宽泛命令。提交前逐项查看 `git diff --cached`，确认不包含订阅地址、令牌、密码、`.env`、构建产物或临时报告。

以下内容不属于远端仓库交付物：

- `node_modules/`、`dist/`、覆盖率、Playwright 报告和测试截图。
- `.env` 及环境专用配置；仓库只保留不含秘密的 `.env.example`。
- 原型目录、AI 过程目录、编辑器设置和本地工作树。
- 本机 Docker 镜像、容器、日志和缓存。

## 本地质量流程

要求 Node.js 24 和 npm 11。首次检出或锁文件变化后使用 `npm ci`，不要用忽略锁文件的安装方式：

```bash
npm ci
npm audit --audit-level=moderate
npm run verify
npx playwright install chromium
npm run test:e2e
docker compose config --quiet
./scripts/verify-container.sh subweb:verify
git diff --check
```

`npm run verify` 依次执行单元测试、ESLint 和生产构建。浏览器测试、依赖审计、Compose 校验和容器运行时验证是额外发布门禁，不包含在该脚本内。构建完成后可以删除 `dist/`；它由 Vite 重新生成。

依赖升级时同时提交 `package.json` 和 `package-lock.json`，再次运行完整质量流程，并审查主版本迁移说明。不要手工修改锁文件，也不要为了消除审计提示而使用未经审查的强制升级。

停止本地预览或测试服务后，使用 `lsof -nP -iTCP -sTCP:LISTEN` 核对项目端口；再检查工作树，确保没有 `dist/`、测试报告或临时配置残留。

## 文档一致性

行为、默认值、部署方式或发布流程变化时，同一提交内同步维护：

- `README.md`：项目边界、功能、来源和入口命令。
- `docs/configuration.md`：`window.config`、默认值和校验规则。
- `docs/deployment.md`：Compose、Docker Run、验证、升级和回滚。
- `docs/remote-config-sources.md`：远程配置来源、许可证和最近核验日期。
- `docs/interface-design.md`：页面结构、交互状态和无障碍约束。

提交前检查文档中的相对链接和命令是否仍能在干净检出上执行。默认服务变更时，还要同步 `public/conf/config.js`、运行时测试、`.env.example` 和容器启动脚本。

## 发布流程

推送 `main` 会触发 `.github/workflows/docker-build-release.yml`。质量任务必须先完成依赖审计、单元测试、Lint、构建、Chromium E2E、Compose 校验、容器冒烟测试和 Trivy 扫描；成功后发布任务才会推送多架构镜像。

仓库 Actions secrets 需要配置：

- `DOCKER_USERNAME`：有权推送 `keleyaa/subweb` 的 Docker Hub 用户名。
- `DOCKER_PASSWORD`：对应的访问令牌，避免使用账户登录密码。

发布生成 `latest`、日期加源码短 SHA、`sha-<short-sha>` 三类标签，并记录不可变 digest。GitHub Actions 回滚清单保留 90 天；生产环境优先按 digest 部署，不把 `latest` 当作回滚依据。

## 推送与一致性检查

```bash
git fetch --prune origin
git status --short --branch
git log origin/main..HEAD --oneline
git push origin main
git status --short --branch
git log HEAD..origin/main --oneline
git log origin/main..HEAD --oneline
```

最后两条日志都没有输出时，当前本地 `main` 与 `origin/main` 指向同一提交。若远端在推送前发生变化，先获取并审查差异；不要未经确认使用强制推送。

推送后还应查看对应 GitHub Actions 运行，确认质量和发布两个任务均成功，并核对 Docker Hub digest 与回滚清单一致。本地工作树干净只证明文件已提交，不证明远端构建或镜像发布成功。
