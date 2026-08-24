# 运维手册

## 状态与日志

Docker：

```sh
docker compose ps
docker compose logs --tail=200 gateway myurls subconverter redis
docker compose config --services
```

Docker 只会存在一个 `gateway` 服务。本机源码使用：

```sh
./scripts/local/status.sh
tail -n 200 .runtime/local/logs/nginx.log
```

Docker 服务和 Gateway 镜像统一使用 `Asia/Shanghai`。Gateway 与 MyUrls 访问日志只记录 ISO 8601
时间、方法、隐私安全的路由模板和状态码；真实短码统一显示为 `/:shortKey`，不记录
Query、请求体、Authorization、IP 或 User-Agent。Compose 默认跟随 MyUrls 的稳定 `latest`；访问日志由
MyUrls 写入 stdout，并由 Docker `json-file` 驱动统一轮转。需要审计特定版本时，应在 `.env` 中显式指定
已验证镜像，并始终限制 Docker 管理权限。

所有容器的 `json-file` 标准输出日志限制为单文件 10 MB、最多 3 个文件。SubConverter 的输出先经过
项目内置过滤器：完整 URI、编码后的 `url`/`link` 请求来源和 Authorization 会变为 `[redacted]`；成功的 `/healthz`
不写 Gateway 访问日志；MyUrls 新版同样抑制成功记录，但失败健康检查保留。
健康检查本身必须保留，因为 Compose 启动依赖和 `--wait` 使用其状态。

日志分享前仍应检查并删除 query、订阅 URL、Token、Redis URL 和真实短码。生产环境不要
启用 SubConverter verbose 或 `print_debug_info = true`；Compose 每次启动都会强制恢复安全日志配置。

## SubConverter 出站网络

Compose 将项目受控的 `deploy/subconverter/gai.conf` 只读挂载到 SubConverter。该文件让 glibc/libcurl
在 DNS 同时返回 IPv4 和 IPv6、但 Docker 主机没有可用 IPv6 出站路由时优先选择 IPv4，避免远程规则集因
IPv6 黑洞出现可恢复重试或拉取失败。它不改变公开端口、DNS、代理、订阅处理规则或其他容器的网络行为。

更新本仓库后，先验证 Compose，再仅重建 SubConverter 即可使配置生效：

```sh
./scripts/validate-compose.sh
docker compose up -d --no-build --force-recreate --wait subconverter
docker compose exec -T subconverter cat /etc/gai.conf
docker compose logs --tail=100 subconverter
```

如果主机已经具备稳定 IPv6 出站，该偏好仍可安全保留；它不是禁用 IPv6，也不能修复目标规则源自身不可达、
DNS 故障或代理配置错误。需要撤销时，移除该 bind mount 后重建 `subconverter`，不要通过关闭 Docker 网络
或添加不受控的全局代理处理。

若升级前的 SubConverter 日志已经包含真实订阅 URL，先轮换订阅凭据，再只重建该服务以移除当前 Docker
容器日志。不要添加 `-v`，否则会一并删除 `/base` 运行卷：

```sh
docker compose rm -sf subconverter
docker compose up -d --no-build --force-recreate subconverter
docker compose logs --tail=100 subconverter
```

本机源码模式的历史文件是 `.runtime/local/logs/subconverter.log`。停止本机栈后，确认凭据已轮换、无需保留
诊断证据时再清空该单个文件；不要删除 `.runtime/local/redis` 或整个 `.runtime/local/` 目录。任何已上传到
日志平台、备份系统或工单的旧副本都需要在对应系统中单独清除。

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

脚本确认 Redis healthy，执行同步 `SAVE`，把 RDB 原子移动到权限 `0600` 的目标，并输出路径与 SHA-256。仍应在隔离的临时全栈中验证随机测试短码，且不输出 key/value。


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

维护者展示部署使用 `sub.ml1.one`、`api.ml1.one` 和 `s.ml1.one`。其他部署者更换域名时，应同时更新三个 DNS 记录、`.env`、外层代理和证书中的 SAN。

更换域名：更新两个 DNS 记录，重新运行 `configure.sh`，更新外层代理或 SAN 证书，执行 `validate-compose.sh`。源码构建执行 `docker compose up -d --build --wait`；镜像部署执行 `docker compose up -d --no-build --pull always --wait`，再验证网页、API、短链创建与旧短码。

## 公开发现性与搜索收录

`APP_DOMAIN` 是唯一应被收录的公开站点。维护者展示部署为 `https://sub.ml1.one/`。在可写的本机源码目录中，启动脚本会将 HTML canonical、Open Graph URL 和 `sitemap.xml` 中的展示域名替换为实际 `APP_DOMAIN`；Docker 镜像默认使用只读根文件系统，启动时不会改写构建产物。其他部署者应在构建镜像前替换 `index.html` 与 `public/sitemap.xml` 中的展示域名，或将其作为 SEO 元数据默认值保留，实际访问域名仍由 `APP_DOMAIN` 配置。

主页提供描述、Open Graph、`SoftwareApplication` JSON-LD、`robots.txt` 和单页 `sitemap.xml`。将自己部署后的 `https://APP_DOMAIN/sitemap.xml` 提交到 Google Search Console 与 Bing Webmaster 即可；不要向搜索平台提交 `API_DOMAIN`。

API、转换请求、短链创建、短码跳转和带 query 的页面均不应被索引。网关为 API 与短链路由返回 `X-Robots-Tag: noindex, nofollow, noarchive`，而 `robots.txt` 只是爬虫提示，不能替代访问控制，也不会消除已泄漏的 URL。

网关转换接口默认限制为每个来源地址每分钟 60 次，短链创建接口限制为每分钟 20 次；MyUrls 内部再限制为每秒 5 次、突发 10 次。出现 429 时应先检查外层代理是否把所有用户汇聚成同一个来源地址，再按实际流量调整外层策略，不要直接关闭内部限流。

公开文档应只保留可验证的能力、部署方式、安全边界、版本和来源说明。不得把订阅 URL、短链、Token、用户配置、日志样本或请求 query 写入 Schema、sitemap、页面示例、截图或公开工单。

证书续期、HTTP 到 HTTPS 跳转和 HSTS 均由宝塔、1Panel、Nginx、OpenResty、Cloudflare 或其他外层服务负责；项目只需继续提供回环 HTTP Gateway。

## 升级与回滚

升级前：

```sh
git status --short
npm run verify:locks
./scripts/validate-compose.sh
```

记录 Git commit、实际解析的各服务镜像 digest（`docker compose images`）和已验证 Redis 备份。升级后检查健康、三个 Host、转换、短链创建、旧短码、日志脱敏和内部端口。失败时切回原 commit，必要时在 `.env` 以 `SUBWEB_IMAGE`/`MYURLS_IMAGE`/`REDIS_IMAGE`/`SUBCONVERTER_IMAGE` 的 digest 覆盖镜像回滚；应用组件可重建，Redis 数据按已演练备份恢复。

SubConverter 镜像更新后必须重建运行时卷 `subconverter-runtime`（`docker compose down` 后 `docker volume rm subweb_subconverter-runtime` 再 `up -d --wait`）——Docker 只对空卷做 copy-up，跳过此步会静默沿用旧 `/base` 模板。`redis-data` 是业务数据，禁止以任何方式删除。

比较两个锁文件时先运行预检。Redis 主版本变化必须提供已验证备份和显式确认：

```sh
./scripts/operations/preflight-upgrade.sh \
  --current "$PWD/deploy/versions.lock.json" \
  --target /absolute/path/to/target-versions.lock.json \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-redis-major
```

MyUrls 与 SubConverter 属于独立上游：先在各自边界验证，再更新本仓库锁文件的已验证基线。所有运行时镜像默认跟随各自 `latest`；未发布的本地 commit 不能当作远端可拉取镜像。需要冻结某个镜像时使用 `.env` 的 `MYURLS_IMAGE`/`SUBWEB_IMAGE` 覆盖。

## 常见故障

- 页面健康但转换失败：区分 gateway、SubConverter、远程配置和订阅源，按浏览器 Network 状态码定位。
- 短链创建失败但跳转正常：检查 `/short-api/short` 路由、Token 两端一致性和 MyUrls 日志，不输出 Token。
- 重启后短码丢失：确认没有删除/更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：先从主机用正确 Host 请求 loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
