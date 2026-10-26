# 维护与发布

## 维护边界

项目运行时由 Go Gateway 与 SubConverter 两个服务组成；短链存储内嵌在 Gateway 的 SQLite 数据库中。默认生产部署使用 [`compose.yaml`](../compose.yaml)，短链关闭时使用明确的 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml)；两者都是两服务 profile。外部 TLS 反向代理示例只描述项目外的入口，不属于 Compose 运行时。

发布、回滚和升级必须使用 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 中记录的外部依赖源 commit、OCI tag、manifest digest 和平台 digest。`scripts/runtime-image-contract.mjs` 是锁定外部镜像值和完整 release rollback runtime image 列表的唯一生成入口，Compose、部署和 release workflow 共同调用它。Gateway 发布工作流在推送 `vX.Y.Z` Git tag 时自动触发，也支持手动输入已有 tag 补跑，并同时推送 Docker Hub 与 GHCR；`docker.io/keleyaa/subweb` 和 `ghcr.io/keleyaa/subweb` 是等价来源，生产部署使用该发布证据中的不可变多平台 manifest digest。Git tag 是产品版本的唯一来源；`package.json` 仅描述 Node 工具链，不参与决定发布版本。不要使用 `latest`、产品版本标签或其他可变 tag 作为部署依据，也不要手工拼接外部镜像 digest。

发布工作流中的镜像扫描固定 trivy `v0.76.0`，与本地 `npm run verify:release` 使用的版本一致；不要依赖 `aquasecurity/trivy-action` 的默认版本。固定版本的目的不是改变扫描结论：锁定 digest 在该版本前后报告同样的结果，固定只是让结论可复现、与本地验证使用同一漏洞库和检测逻辑，避免一次无关的扫描器升级决定发布范围。

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

`verify:ci` 是 CI 与本地发布共用的 Docker 门禁，启用真实 Docker integration。`verify:release` 还执行 npm audit、浏览器验证、版本锁、production-readiness、Compose、文档、Gateway 镜像安全、锁定 runtime image 安全检查和 evidence gate；Go race、Go vet、构建和 `git diff --check` 是需要另行执行或由 CI job 覆盖的独立检查，不是该脚本自身的全部步骤。只有看到 release verifier 的明确 `release verification=passed` marker 才能判定成功；截断的长日志不算通过。

GitHub package publish job 需要 `packages: write` 权限。发布工作流必须先通过 `npm run verify:ci`，再使用版本锁生成的镜像和 rollback manifest；不要把个人访问令牌写入工作流。

## 备份与升级顺序

1. 运行 `npm run verify:integration` 完成两服务往返 smoke、短链持久化与过期验证。
2. 记录 `git status --short`、当前镜像 digest 和 `./scripts/subweb.sh status`。
3. 使用 `./scripts/subweb.sh backup --output /absolute/path/backup.db` 保存短链数据。
4. 通过 `./scripts/subweb.sh upgrade` 按当前 `.env` 的 release 镜像引用拉取 Gateway，并按版本锁拉取 SubConverter 镜像，然后等待健康检查。升级入口会先校验 Compose/版本锁合同，并在启动后比对镜像自带与运行卷中的 `pref.example.toml`；Docker 只在命名卷为空时才从镜像播种 `/base`，因此 SubConverter 版本变化后必须删除 `subconverter-runtime` 卷再启动，否则容器会继续使用旧版本的偏好模板，脚本会以非零退出并打印该步骤。

```sh
docker compose -f compose.yaml down
docker volume rm subweb_subconverter-runtime
./scripts/subweb.sh up
```

任何一次 SubConverter 镜像变更后都可以单独执行 `npm run verify:subconverter-runtime` 复核运行卷与镜像是否一致。
5. 运行 `npm run verify:integration`，确认业务 smoke 和重启路径。
6. 失败时停止继续发布，保留当前 RDB 和日志，并按版本锁生成的 rollback manifest 回滚完整 runtime image 集合。

短链启用与关闭都只升级 Gateway 与 SubConverter。短链数据在 `links-data` 卷内，升级不会重建该卷；回滚 Gateway 镜像时使用兼容的数据库 schema（当前为 1），不要把数据库文件挂载给旧版本。

## 仓库卫生

以下路径是本地或生成数据，不应提交：`.env`、`.runtime/`、`dist/`、`test-results/`、`playwright-report/`、临时 RDB 和 Docker build 输出。提交前检查 staged diff、文件权限和敏感字段；不要执行 `cat .env`。文档变化必须通过 `npm run verify:docs`、Compose/version-lock/readiness gates 与 `git diff --check`。

## 依赖来源

第三方来源和锁定证据见 [第三方来源](third-party-sources.md)。SubConverter 的运行时权限、相对路径和本地 default config 要求见 [SubConverter 容器契约](../deploy/subconverter/README.md)。短链实现与数据库 schema 属于 Gateway 自身，升级 Gateway 时保持 `links-data` 卷不变。

## 镜像发布

主分支的 Docker release workflow 以一次 Buildx 构建同时发布 `docker.io/keleyaa/subweb` 与 `ghcr.io/keleyaa/subweb`。两个来源必须使用相同的提交标识、产品版本标签和多平台 manifest digest；`latest` 只作为平台兼容别名，不作为生产部署输入。生产 CLI 使用该发布对应的不可变多平台 manifest digest。首次创建 GHCR Package 后，维护者需要在 GitHub Package 设置中确认可见性和匿名拉取能力，这属于远端设置，不能仅靠本地测试证明。
