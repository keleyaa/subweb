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

日志分享前删除域名以外的 query、订阅 URL、Token、Redis URL 和短码目标。

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

记录 Git commit、四个服务 digest、Compose profile 和已验证 Redis 备份。升级后检查健康、两个 Host、转换、短链创建、旧短码、日志脱敏和内部端口。失败时切回原 commit/digest；应用组件可重建，Redis 数据按已演练备份恢复。

比较两个锁文件时先运行预检。Redis 主版本变化必须提供已验证备份和显式确认：

```sh
./scripts/operations/preflight-upgrade.sh \
  --current "$PWD/deploy/versions.lock.json" \
  --target /absolute/path/to/target-versions.lock.json \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-redis-major
```

MyUrls 与 SubConverter 属于独立上游：先在各自边界验证，再更新本仓库锁文件。未发布的本地 commit 不能用于生产锁定。

## 常见故障

- 页面健康但转换失败：区分 gateway、SubConverter、远程配置和订阅源，按浏览器 Network 状态码定位。
- 短链创建失败但跳转正常：检查 `/short-api/short` 路由、Token 两端一致性和 MyUrls 日志，不输出 Token。
- 重启后短码丢失：确认没有删除/更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：先从主机用正确 Host 请求 loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
