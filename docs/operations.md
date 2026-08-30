# 运维手册

## 状态与日志

Docker Compose 运行 `gateway`、`request-policy`、`subconverter`、两个 MyUrls Rust v2.0.4 实例（`myurls-app`、`myurls-short`）和 `redis`，共 6 个服务；只有 Gateway 的 `8080` 端口绑定到宿主机 loopback。

```sh
docker compose ps
docker compose logs --tail=200 gateway request-policy myurls-app myurls-short subconverter redis
docker compose config --services
```

本机源码运行时使用：

```sh
./scripts/local/status.sh
tail -n 200 .runtime/local/logs/nginx.log
```

Docker 服务和 Gateway 镜像统一使用 `Asia/Shanghai` 时区。Gateway、MyUrls 与 Request Policy 的日志只记录 ISO 8601 时间、方法、隐私安全的路由模板、状态码、耗时和错误分类；真实短码统一显示为 `/:shortKey`。日志不记录 Query、请求体、Authorization、原始 IP、User-Agent、订阅 URL、Token、Redis 密码或 IP 哈希秘密。

Compose 默认以 `info` 级别运行 MyUrls，保留正常请求记录。日志量较大时，可在 `.env` 中设置 `MYURLS_LOG_LEVEL=warn`，然后重建两个 MyUrls 容器。访问日志由 MyUrls 写入 stdout，再由 Docker `json-file` 驱动统一轮转。需要审计特定版本时，应在 `.env` 中显式指定已验证的镜像，并始终限制 Docker 管理权限。

所有容器的 `json-file` 标准输出日志限制为单文件 `10 MB`、最多 3 个文件。SubConverter 的输出先经过项目内置过滤器：完整 URI、编码后的 `url` / `link` 请求来源和 Authorization 会变为 `[redacted]`。成功的 `/healthz` 不写入 Gateway 访问日志；当 `MYURLS_LOG_LEVEL=warn` 时，MyUrls 会抑制成功记录，但保留失败的健康检查。

日志分享前仍应检查并删除 query、订阅 URL、Token、Redis URL 和真实短码。生产环境不要启用 SubConverter verbose 或 `print_debug_info = true`；Compose 每次启动都会强制恢复安全日志配置。

## 受控订阅出站

Request Policy Service 同时承担 `/sub` 请求策略与 SubConverter 专用 HTTPS CONNECT egress proxy。它在单一边界内解析远程 HTTPS 主机、拒绝 loopback / 私网 / link-local / 保留地址，并按已验证 IP 建立连接；SubConverter 仅加入内部 `subconverter-egress` 网络，没有默认网络的直接出站路径。

SubConverter 依赖项目受控的 `deploy/subconverter/gai.conf`，在 DNS 同时返回 IPv4 和 IPv6、但 Docker 主机没有可用 IPv6 出站路由时优先使用 IPv4。该配置不改变公开端口、DNS 策略、egress proxy 或其他容器网络行为。

更新本仓库后，先验证 Compose，再重建策略服务与 SubConverter：

```sh
./scripts/validate-compose.sh
docker compose build request-policy
docker compose up -d --no-build --force-recreate --wait request-policy subconverter
docker compose logs --tail=100 request-policy subconverter
```

`gai.conf` 不能修复目标规则源自身不可达、DNS 故障或 egress proxy 配置错误。需要排查订阅转换时，先检查 Request Policy 的错误分类、SubConverter 健康与 Gateway 路由；不要通过关闭 Docker 网络或添加不受控全局代理绕过边界。

若升级前的 SubConverter 日志已经包含真实订阅 URL，先轮换订阅凭据，再只重建该服务以移除当前 Docker 容器日志。不要添加 `-v`，否则会一并删除 `/base` 运行卷：

```sh
docker compose rm -sf subconverter
docker compose up -d --no-build --force-recreate subconverter
docker compose logs --tail=100 subconverter
```

Compose-first 本地模式不下载上游源码，也不生成独立日志文件。停止本机栈后，确认凭据已轮换、无需保留诊断证据时再清空该单个文件；不要删除 `.runtime/local/redis` 或整个 `.runtime/local/` 目录。任何已上传到日志平台、备份系统或工单的旧副本都需要在对应系统中单独清除。

## Redis 备份

仓库提供显式、失败即停止的 Docker 备份和恢复脚本。备份目录必须已存在、不是符号链接，且没有 group/other 权限：

```sh
mkdir -p .runtime/redis-backups
chmod 700 .runtime/redis-backups
./scripts/operations/backup-redis.sh \
  --output "$PWD/.runtime/redis-backups/manual.rdb"
./scripts/operations/verify-redis-backup.sh \
  --backup "$PWD/.runtime/redis-backups/manual.rdb"
```

备份通过容器内环境认证，不把 Redis 密码放入宿主机命令参数或输出。校验使用锁文件中的 Redis digest，在无网络、只读容器中运行 `redis-check-rdb`。

脚本确认 Redis healthy，执行同步 `SAVE`，将 RDB 原子移动到权限为 `0600` 的目标文件，并输出路径与 SHA-256。仍应在隔离的临时全栈中验证随机测试短码，且不输出 key/value。

## 历史短链迁移

D1 已批准采用 `cap-90d`：迁移后的 TTL 取旧 key 剩余 TTL 与 90 天中的较小值。生产迁移必须在维护窗口执行，
显式停写并指定已通过校验的 RDB 备份；脚本只复制到 `myurl:link:{code}`，不删除旧 key，也不覆盖已有 v2 key：

```sh
./scripts/operations/inventory-myurls-v1.sh
./scripts/operations/migrate-myurls-v1.sh \
  --ttl-policy cap-90d \
  --apply \
  --confirm-stop-writes \
  --backup "$PWD/.runtime/redis-backups/pre-myurls-v2-migration.rdb"
```

迁移输出中的 `destination_conflicts`、`write_failures` 必须为 `0`；`missing_expiry` 和
`invalid_values_skipped` 必须由维护者确认。完成后抽样检查旧短码跳转和新 key 的 TTL，再启动写入口。


## 恢复

恢复会覆盖业务数据，必须安排维护窗口并显式确认停写：

```sh
./scripts/operations/restore-redis.sh \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-stop-writes
```

脚本先验证目标，创建并保留操作前备份，停止 gateway/MyUrls/Redis，通过一次性锁定 Redis 容器删除旧 AOF 目录、载入目标 RDB，再生成与该快照一致的新 AOF，最后等待正式全栈健康。删除和重建 AOF 仅发生在已经显式确认的恢复流程中，否则旧 AOF 会覆盖目标 RDB。失败时尝试恢复操作前备份；回滚也失败时保持写入口关闭并输出备份路径，不能继续向不确定数据集写入。

禁止把 `docker compose down -v` 作为恢复步骤。不要跨 Redis 主版本直接复用被新版本写过的数据卷。

## 域名与证书

维护者展示部署使用 `sub.ml1.one`、`api.ml1.one` 和 `s.ml1.one`。其他部署者更换域名时，应同时更新 3 条 DNS 记录、`.env`、外层代理和证书中的 SAN。

更换域名：更新 3 条 DNS 记录，重新运行 `configure.sh`，更新外层代理或 SAN 证书，执行 `validate-compose.sh`。源码构建执行 `docker compose build request-policy` 后再执行 `docker compose up -d --build --wait`；镜像部署由 `docker-deploy.sh` 拉取外部镜像、构建本地 `request-policy`，再执行 `--no-build --pull never` 启动。完成后验证网页、API、短链创建、旧短码和受控订阅转换。

## 公开发现性与搜索收录

`APP_DOMAIN` 是唯一应被收录的公开站点。维护者展示部署为 `https://sub.ml1.one/`。在可写的本机源码目录中，启动脚本会将 HTML canonical、Open Graph URL 和 `sitemap.xml` 中的展示域名替换为实际 `APP_DOMAIN`；Docker 镜像默认使用只读根文件系统，启动时不会改写构建产物。其他部署者应在构建镜像前替换 `index.html` 与 `public/sitemap.xml` 中的展示域名，或将其作为 SEO 元数据默认值保留，实际访问域名仍由 `APP_DOMAIN` 配置。

主页提供描述、Open Graph、`SoftwareApplication` JSON-LD、`robots.txt` 和单页 `sitemap.xml`。将自己部署后的 `https://APP_DOMAIN/sitemap.xml` 提交到 Google Search Console 与 Bing Webmaster 即可；不要向搜索平台提交 `API_DOMAIN`。

API、转换请求、短链创建、短码跳转和带 query 的页面均不应被索引。Gateway 为 API 与短链路由返回 `X-Robots-Tag: noindex, nofollow, noarchive`；`robots.txt` 只是爬虫提示，不能替代访问控制，也不会消除已泄漏的 URL。

Gateway 转换接口默认限制为每个来源地址每分钟 `10` 次，并全局最多同时运行 `2` 个转换；短链创建接口限制为每分钟 `20` 次；短链解析默认按 IP 每 `10` 秒 `600` 次。出现 `429` 时，先检查外层代理是否把所有用户汇聚成同一个来源地址；确认反代到 Gateway 的实际来源 IPv4 后，用精确的 `TRUSTED_PROXY_CIDR` 启用可信的 `X-Forwarded-For`，不要直接关闭内部限流或信任任意来源。

公开文档应只保留可验证的能力、部署方式、安全边界、版本和来源说明。不得把订阅 URL、短链、Token、用户配置、日志样本或请求 query 写入 Schema、sitemap、页面示例、截图或公开工单。

证书续期、HTTP 到 HTTPS 跳转和 HSTS 均由宝塔、1Panel、Nginx、OpenResty、Cloudflare 或其他外层服务负责；项目只需继续提供回环 HTTP Gateway。

## 升级与回滚

升级前：

```sh
git status --short
npm run verify:locks
./scripts/validate-compose.sh
```

记录 Git commit、实际解析的各服务镜像 digest（`docker compose images`）和已验证 Redis 备份。升级后检查健康、三个 Host、转换、短链创建、旧短码、日志脱敏和内部端口。失败时优先切回原 Subweb commit；`SUBWEB_IMAGE`、`REDIS_IMAGE` 和 `SUBCONVERTER_IMAGE` 可使用已验证 digest 覆盖。`MYURLS_IMAGE` 仅可单独回退到兼容当前 Rust `/api/links` 契约的镜像；回退到旧 Node `/api/v1/links` 时必须同时切回匹配的 Subweb commit。应用组件可重建，Redis 数据按已演练备份恢复。

SubConverter 镜像更新后必须重建运行时卷 `subconverter-runtime`（执行 `docker compose down`，再执行 `docker volume rm subweb_subconverter-runtime`，最后执行 `up -d --wait`）。Docker 只对空卷做 copy-up；跳过此步会静默沿用旧的 `/base` 模板。`redis-data` 是业务数据，禁止以任何方式删除。

比较两个锁文件时先运行预检。Redis 主版本变化必须提供已验证备份和显式确认：

```sh
./scripts/operations/preflight-upgrade.sh \
  --current "$PWD/deploy/versions.lock.json" \
  --target /absolute/path/to/target-versions.lock.json \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-redis-major
```

MyUrls 与 SubConverter 属于独立上游：先在各自边界验证，再更新本仓库锁文件的已验证基线。MyUrls 使用 semver + digest；未发布的本地 commit 不能当作远端可拉取镜像。需要冻结某个镜像时使用 `.env` 的 `MYURLS_IMAGE`/`SUBWEB_IMAGE` 覆盖。

## 常见故障

- 页面健康但转换失败：区分 gateway、SubConverter、远程配置和订阅源，按浏览器 Network 状态码定位。
- 短链创建失败但跳转正常：检查 `/short-api/links` 路由、Turnstile 状态和 MyUrls 日志，不输出 token。
- 重启后短码丢失：确认没有删除/更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：先从主机用正确 Host 请求 loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
