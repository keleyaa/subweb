# 维护与发布

## 仓库边界

常规部署从以下命令开始：`git clone https://github.com/keleyaa/subweb.git`，然后执行 `cd subweb`。

- `origin` 只能指向当前维护仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb)。
- `upstream` 仅用于读取 Fork 起点 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，不得推送。
- MyUrls 必须在独立仓库维护，不把其源码、`.git` 或构建产物复制进 Subweb。
- SubConverter-Extended 使用官方上游锁定产物，不在本仓库做隐式补丁。

来源变化必须同步更新 [第三方来源](third-party-sources.md)、锁文件、README 和相关测试；MyUrls 的 semver + digest 发行策略也必须同步更新其工作流和部署说明。

## 必须提交与禁止提交

文档和测试是项目可运行、可维护的一部分，属于必须提交的文件；`docs/` 与 `tests/` 不能因为「不参与运行时」而整体排除。应提交源码、配置模板、锁文件、部署脚本、工作流、测试和当前文档。

以下是本地或生成数据，不提交：

- `.env`
- `.runtime/`
- `node_modules/`
- `dist/`
- `test-results/`
- `playwright-report/`
- 证书、私钥、Redis 数据/备份、平台凭据
- 下载的 MyUrls/SubConverter 源码和临时容器输出

提交前用 `git check-ignore -v` 检查边界；不要为了工作树看起来干净而删除不属于当前任务的用户文件。

## 质量门禁

```sh
npm ci
npm audit --audit-level=moderate
npm run verify
npm run verify:ci
npm run test:e2e
npm run verify:locks
npm run verify:compose
npm run verify:docs
npm run verify:evidence
npm run verify:operations
npm run verify:integration
git diff --check
```

`npm run verify:ci` 是 GitHub quality job 与本地发布验证共用的 Docker 门禁：它会在普通质量检查之外启用真实 Nginx 和完整 Docker integration 的 Vitest 用例，因此需要可用的 Docker daemon。GitHub quality job 还显式执行 production-readiness 检查。`npm run verify:release` 会聚合安装、审计、质量、浏览器、锁、Compose、文档、容器、镜像安全、Redis 运维、单一 HTTP 集成和证据门禁，并检查最终 Gateway、Request Policy、Redis、SubConverter 和 MyUrls 的高危与严重漏洞。扫描默认不接受例外；当前仅对 Redis 和 SubConverter 分别使用 `.trivyignore.redis`、`.trivyignore.subconverter` 中记录的 OpenSSL 例外。升级对应镜像时，必须重新审查并删除或更新对应文件。

本地开发验证使用 `npm run verify:local`；完整 v2 栈使用 `npm run verify:integration` 和 `npm run verify:operations`。`npm run verify:release` 在没有 `.env` 的干净工作树中为策略镜像构建注入仅限当前进程的临时验证配置，不写入磁盘、不覆盖已有 `.env`。真实部署仍必须通过 `./scripts/configure.sh` 生成权限为 `0600` 的 `.env`。完整门禁会重装依赖并运行较长时间，仅应在准备发布的干净工作树中执行。

## 容器镜像发行

主分支的 `docker build release` 工作流以单次 Buildx 构建同时发布 `docker.io/keleyaa/subweb` 与 `ghcr.io/keleyaa/subweb`。`release` 作业只增加 GHCR 所需的 `packages: write`；Docker Hub 使用仓库 Secrets，GHCR 使用 Actions 自动提供的 `GITHUB_TOKEN`，不要为此创建长期 PAT。

两个注册表必须得到相同的日期加提交短 SHA、`sha-*` 标签和 manifest digest；`latest` 只作为发布平台兼容别名，不作为生产部署输入。回滚清单同时记录两个 digest 引用。首次创建 GHCR Package 后，维护者需要在 GitHub Package 设置中把可见性设为 Public，并确认未登录环境能够拉取；这是一次性的远端仓库设置，不能仅靠本地测试证明。

每次推送后检查 Actions 中 Docker Hub 和 GHCR 的 manifest 推送日志，再分别执行：

```sh
docker buildx imagetools inspect docker.io/keleyaa/subweb:sha-<提交短 SHA>
docker buildx imagetools inspect ghcr.io/keleyaa/subweb:sha-<提交短 SHA>
```

两个命令显示的顶层 manifest digest 必须一致。若 GHCR 推送返回权限错误，先检查工作流 `packages: write`、仓库 Actions 权限和 Package 与仓库的关联，不要把个人访问令牌写进工作流。

## 锁定更新

外部服务升级先核验正式 tag、commit、manifest digest、amd64/arm64 digest 和许可证，再更新 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 的已验证基线。运行锁校验、对应服务测试和单一 HTTP Docker 集成验证。MyUrls Rust v2.0.5 使用 semver + manifest digest；只允许在相同 `/api/links` 契约内覆盖 `MYURLS_IMAGE`。Compose 只能校验 OCI 引用格式，替代镜像的 API、错误体、健康端点和 UID 兼容性必须由维护者单独验证。升级后注意 SubConverter 运行时卷需删除重建（见 [SubConverter README](../deploy/subconverter/README.md)），且不能把本地未发布 commit 写成远端可拉取镜像。v2.0.5 的 Redis 断线恢复、请求总超时和静态资源缓存行为升级后应通过 Docker 集成测试确认。

## 提交与推送

```sh
git status --short --branch
git diff --check
git diff --name-status origin/main...HEAD
git remote -v
git branch -vv
```

逐项确认追踪集合只包含 Subweb 必需文件，提交信息说明真实边界。推送必须获得用户明确授权，并在推送前执行：

```sh
git fetch --prune origin
git log --oneline origin/main..HEAD
git push origin "HEAD:$(git branch --show-current)"
```

推送后比较本地 HEAD 与远端分支 SHA，并检查 GitHub Actions 与发布镜像 digest。工作树干净不等于远端一致，远端 CI 成功也不能替代本地秘密/数据边界检查。禁止未经确认强制推送。
