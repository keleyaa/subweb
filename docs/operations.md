# 运维手册

## 状态与日志

生产 Compose 有一个受控的入口。短链启用时，`compose.yaml` 运行五个服务：`gateway`、`subconverter`、`myurls-app`、`myurls-short` 与 `redis`。Gateway 是唯一发布端口，绑定宿主机 loopback；外层 TLS 反向代理按原始 Host 把 APP、API 和 SHORT 域转发到它。

`SHORT_LINKS_ENABLED=false` 时，`scripts/subweb.sh` 自动选择 `compose.disabled-short-links.yaml`。该 profile 只运行 `gateway` 与 `subconverter`，不会读取或启动 Redis、MyUrls 或 Turnstile 私密配置。SHORT 域可省略，且不应由外层代理公开。

```sh
./scripts/subweb.sh status
./scripts/subweb.sh logs
./scripts/subweb.sh up
./scripts/subweb.sh down
./scripts/subweb.sh verify
```

Gateway、MyUrls 与 SubConverter 使用 `Asia/Shanghai` 时区。日志只应记录 ISO 8601 时间、方法、隐私安全的路由模板、状态码、耗时和错误分类。真实短码显示为 `/:shortKey`；不得记录 query、请求体、Authorization、原始 IP、User-Agent、订阅 URL、Token、Redis 密码或 IP 哈希秘密。成功的 `/readyz` 不写入 Gateway 访问日志。Docker `json-file` 日志限制为单文件 `10 MB`、最多 3 个文件。分享日志前仍应检查并删除 URL、Token、Redis URL 和真实短码。

## 受控订阅出站

统一 Go Gateway 同时执行请求策略和 HTTPS CONNECT egress。Gateway 在转发 `/sub` 前验证远程 URL、DNS 地址、大小、超时、并发和匿名频率；SubConverter 仅通过 Gateway 的内部 CONNECT listener 访问外部 HTTPS 目标。`subconverter-egress` 是内部网络，因此不得通过添加直接外网网络或全局代理绕过这条边界。

升级 SubConverter 后重建其运行卷，且绝不能删除 `redis-data`：

```sh
./scripts/subweb.sh down
docker volume rm subweb_subconverter-runtime
./scripts/subweb.sh up
```

Docker 只对空卷执行 copy-up；跳过重建会继续使用旧的 `/base` 模板。

## Redis 备份

短链启用时，使用 feature-aware CLI 备份 Redis DB 0 数据。备份目录必须已经存在、不是符号链接，且没有 group/other 权限：

```sh
mkdir -p .runtime/redis-backups
chmod 700 .runtime/redis-backups
./scripts/subweb.sh backup \
  --output "$PWD/.runtime/redis-backups/manual.rdb"
./scripts/operations/verify-redis-backup.sh \
  --backup "$PWD/.runtime/redis-backups/manual.rdb"
```

备份通过容器内环境认证，不会把 Redis 密码放入宿主机命令参数或输出。脚本确认 Redis healthy，执行同步 `SAVE`，将 RDB 原子移动到 `0600` 的目标文件，并输出路径与 SHA-256。`SHORT_LINKS_ENABLED=false` 时没有 Redis 数据面，`backup` 和 `restore` 都会拒绝执行。

在发布或 Redis 主版本升级前，先演练恢复：

```sh
npm run verify:operations
```

该验证在临时五服务 Compose 项目中创建短链、备份、清空并恢复 Redis，随后重启 Redis、Gateway 与 SubConverter，并确认短码仍可解析。它不会复用生产卷或输出密码、短码值或订阅 URL。

## 恢复

恢复会覆盖业务数据，必须在维护窗口显式停写：

```sh
./scripts/subweb.sh restore \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-stop-writes
```

CLI 只接受绝对、非符号链接的 regular RDB 文件。恢复先验证目标，创建并保留操作前备份，停止 Gateway、两个 MyUrls 服务与 Redis，通过一次性 Redis 容器安装目标 RDB 并生成一致的新 AOF，最后等待完整栈健康。失败时会尝试恢复操作前备份；回滚也失败时保持写入口关闭并输出备份路径。禁止将 `docker compose down -v` 用作恢复步骤，也不要跨 Redis 主版本复用被新版本写过的数据卷。

## 域名、证书与升级

`APP_DOMAIN`、`API_DOMAIN` 和（启用短链时的）`SHORT_DOMAIN` 都需要 DNS、外层反向代理和证书 SAN。外层代理只连接 `127.0.0.1:${SUBWEB_PORT}`，并保留 Host；不要公开 Redis、MyUrls、SubConverter 或 Gateway 的 CONNECT listener。

升级前记录 Git commit、`docker compose images` 解析出的镜像 digest、发布 workflow 的 `runtime_images` 回滚清单，以及已验证的 Redis 备份：

```sh
npm run verify:locks
./scripts/subweb.sh verify
./scripts/subweb.sh backup --output "$PWD/.runtime/redis-backups/pre-upgrade.rdb"
```

发布镜像部署使用 `scripts/docker-deploy.sh`，它只接受 `sha-*` 标签或完整 `@sha256` digest，并拉取 Gateway 与锁定的 Redis、SubConverter、MyUrls 镜像后执行 `--no-build --pull never`。回滚时优先切回已验证的 Gateway image digest 和同一 `runtime_images` 清单；Redis 数据只能通过已演练的 RDB 恢复。`MYURLS_IMAGE` 只可单独回退到兼容当前 Rust `/api/links` 契约的镜像。

## 常见故障

- 页面健康但转换失败：区分 Gateway、SubConverter 和订阅源；不要关闭请求策略或绕过 CONNECT egress。
- 短链创建失败但跳转正常：检查 `/short-api/links`、Turnstile 状态和 MyUrls 日志，不输出 token。
- Redis 重启后短码缺失：确认没有删除或更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：从主机带正确 Host 请求 Gateway loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
