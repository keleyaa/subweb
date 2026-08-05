# 运维手册

## 状态与日志

Docker：

```sh
docker compose ps
docker compose logs --tail=200 gateway-http gateway-tls myurls subconverter redis
docker compose config --services
```

根据当前 profile，只会存在 `gateway-http` 或 `gateway-tls`。本机源码使用：

```sh
./scripts/local/status.sh
tail -n 200 .runtime/local/logs/nginx.log
```

Docker 服务和 Gateway 镜像统一使用 `Asia/Shanghai`。Gateway 与 MyUrls 访问日志只记录 ISO 8601
时间、方法、隐私安全的路由模板和状态码；真实短码统一显示为 `/:shortKey`，不记录
Query、请求体、Authorization、IP 或 User-Agent。Compose 默认跟随 MyUrls 的稳定 `latest`；仅在该
镜像发布成功后才具备这套日志策略。发布前或需要审计特定版本时，应在 `.env` 中显式指定已验证镜像，
并始终限制 Docker 管理权限，避免复制 `/app/logs` 内容。

所有容器的 `json-file` 标准输出日志限制为单文件 10 MB、最多 3 个文件。成功的 `/healthz`
不写 Gateway 访问日志；MyUrls 新版同样抑制成功记录，但失败健康检查保留。
健康检查本身必须保留，因为 Compose 启动依赖和 `--wait` 使用其状态。

日志分享前仍应检查并删除 query、订阅 URL、Token、Redis URL 和真实短码。生产环境不要
启用 SubConverter verbose 或 `print_debug_info = true`。

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

更换域名：更新两个 DNS 记录，重新运行 `configure.sh`，更新外层代理或 SAN 证书，执行 `validate-compose.sh`。源码构建执行 `docker compose up -d --build --wait`；镜像部署执行 `docker compose up -d --no-build --pull always --wait`，再验证网页、API、短链创建与旧短码。

`direct-tls` 证书续期后先验证文件权限与完整链，执行 `docker compose exec gateway-tls nginx -t`，再重启 gateway。`behind-proxy` 的证书续期由宝塔、1Panel、Nginx、OpenResty、Cloudflare 或其他外层服务负责。

## 升级与回滚

升级前：

```sh
git status --short
npm run verify:locks
./scripts/validate-compose.sh
```

记录 Git commit、Gateway/SubConverter/Redis digest、实际解析的 MyUrls digest、Compose profile 和已验证 Redis 备份。升级后检查健康、两个 Host、转换、短链创建、旧短码、日志脱敏和内部端口。失败时切回原 commit/digest；应用组件可重建，Redis 数据按已演练备份恢复。

比较两个锁文件时先运行预检。Redis 主版本变化必须提供已验证备份和显式确认：

```sh
./scripts/operations/preflight-upgrade.sh \
  --current "$PWD/deploy/versions.lock.json" \
  --target /absolute/path/to/target-versions.lock.json \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-redis-major
```

MyUrls 与 SubConverter 属于独立上游：先在各自边界验证，再更新本仓库锁文件。MyUrls 默认 `latest` 只应由其完整稳定版本发行推进；未发布的本地 commit 不能当作远端可拉取镜像。需要冻结 MyUrls 时使用 `.env` 的 `MYURLS_IMAGE` 覆盖。

## 常见故障

- 页面健康但转换失败：区分 gateway、SubConverter、远程配置和订阅源，按浏览器 Network 状态码定位。
- 短链创建失败但跳转正常：检查 `/short-api/short` 路由、Token 两端一致性和 MyUrls 日志，不输出 Token。
- 重启后短码丢失：确认没有删除/更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：先从主机用正确 Host 请求 loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
