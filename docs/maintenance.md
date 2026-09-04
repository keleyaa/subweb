# 维护与发布

## 维护边界

项目运行时由 Go Gateway、SubConverter、两个 MyUrls Rust v2.0.6 实例和 Redis 组成。生产部署只接受 [`compose.yaml`](../compose.yaml) 的五服务 profile；短链关闭时使用明确的 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml) 两服务 profile。外部 TLS 反向代理示例只描述项目外的入口，不属于 Compose 运行时。

发布、回滚和升级必须使用 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 中记录的外部依赖源 commit、OCI tag、manifest digest 和平台 digest。Gateway 发布同时推送 Docker Hub 与 GHCR；`docker.io/keleyaa/subweb` 和 `ghcr.io/keleyaa/subweb` 是等价来源，部署时使用当前 release 提供的不可变 `sha-*` 引用。不要使用可变 tag 作为部署依据，也不要手工拼接外部镜像 digest。

## 发布前门禁

```sh
npm ci
npm run verify:ci
npm run verify:release
npm run verify:production-readiness
npm run verify:locks
npm run verify:docs
git diff --check
```

`verify:ci` 是 CI 与本地发布共用的 Docker 门禁，启用真实 Docker integration 和 Redis integration。`verify:release` 还执行 npm audit、浏览器验证、版本锁、production-readiness、Compose、文档、Gateway 镜像安全、锁定 runtime image 安全检查和 evidence gate；Go race、Go vet、构建和 `git diff --check` 是需要另行执行或由 CI job 覆盖的独立检查，不是该脚本自身的全部步骤。只有看到 release verifier 的明确 `release verification=passed` marker 才能判定成功；截断的长日志不算通过。

GitHub package publish job 需要 `packages: write` 权限。发布工作流必须先通过 `npm run verify:ci`，再使用版本锁生成的镜像和 rollback manifest；不要把个人访问令牌写入工作流。

## 备份与升级顺序

1. 运行 `npm run verify:operations` 完成 RDB backup/restore 和独立重启恢复演练。
2. 记录 `git status --short`、当前镜像 digest 和 `./scripts/subweb.sh status`。
3. 使用 `./scripts/subweb.sh backup --output /absolute/path/backup.rdb` 保存短链数据。
4. 通过 `./scripts/subweb.sh upgrade` 按当前 `.env` 的 release 镜像引用拉取 Gateway，并按版本锁拉取 SubConverter、MyUrls 和 Redis 镜像，然后等待健康检查。升级入口会先校验 Compose/版本锁合同。
5. 运行 `npm run verify:integration`，确认业务 smoke 和重启路径。
6. 失败时停止继续发布，保留当前 RDB 和日志，并按版本锁生成的 rollback manifest 回滚完整 runtime image 集合。

短链关闭时只升级 Gateway 与 SubConverter，不读取或创建 Redis/MyUrls 配置。不要通过只替换 `MYURLS_IMAGE` 把 Rust v2 回滚到接口不兼容的旧 Node `/api/v1/links` 合同；跨合同回滚必须同时恢复 Gateway 路由和前端行为。

## 仓库卫生

以下路径是本地或生成数据，不应提交：`.env`、`.runtime/`、`dist/`、`test-results/`、`playwright-report/`、临时 RDB 和 Docker build 输出。提交前检查 staged diff、文件权限和敏感字段；不要执行 `cat .env`。文档变化必须通过 `npm run verify:docs`、Compose/version-lock/readiness gates 与 `git diff --check`。

## 依赖来源

第三方来源和锁定证据见 [第三方来源](third-party-sources.md)。SubConverter 的运行时权限、相对路径和本地 default config 要求见 [SubConverter 容器契约](../deploy/subconverter/README.md)。MyUrls Rust 的当前版本是 v2.0.6，升级必须同步源 commit、镜像 manifest 和 `/api/links` 兼容性验证。

## 镜像发布

主分支的 Docker release workflow 以一次 Buildx 构建同时发布 `docker.io/keleyaa/subweb` 与 `ghcr.io/keleyaa/subweb`。两个来源必须使用相同的提交标识、`sha-*` 标签和多平台 manifest digest；`latest` 只作为平台兼容别名，不作为生产部署输入。首次创建 GHCR Package 后，维护者需要在 GitHub Package 设置中确认可见性和匿名拉取能力，这属于远端设置，不能仅靠本地测试证明。
