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

当前仓库尚未交付自动恢复脚本；正式数据操作必须先在副本演练。Docker 的最低可审计流程是先让 Redis 执行同步保存，再从命名卷复制 RDB 到权限受限目录。不要把 Redis 密码放在 shell 历史、命令参数或输出中。

1. 暂停 gateway/MyUrls 的写入口。
2. 确认 Redis healthy，并通过容器内环境完成认证后执行 `SAVE` 或 `BGSAVE`。
3. 把 `dump.rdb` 复制到新建的私有备份目录，设置文件权限 `0600`，记录当前 Git commit、Redis digest、时间和校验和。
4. 在独立临时 Redis 实例加载备份，检查 key 数、TTL 统计和随机测试短码，不输出 key/value。
5. 验证成功后再恢复写入口。

平台部署必须使用平台提供的快照/导出功能并验证可恢复性；Railway/Render 尚未实测，不能假设免费层或 Key Value 自动提供可用备份。

## 恢复

恢复会覆盖业务数据，必须安排维护窗口并保留当前数据的二次备份：停止 gateway 与 MyUrls、验证目标备份和 Redis 版本兼容、替换 RDB、只启动 Redis 检查、再启动 MyUrls 和 gateway，最后验证旧短码。任一步失败应停止写入口并还原操作前备份，不能继续向不确定数据集写入。

禁止把 `docker compose down -v` 作为恢复步骤。不要跨 Redis 主版本直接复用被新版本写过的数据卷。

## 域名与证书

更换域名：更新两个 DNS 记录，重新运行 `configure.sh`，更新外层代理或 SAN 证书，执行 `validate-compose.sh` 和 `docker compose up -d --build --wait`，再验证网页、API、短链创建与旧短码。

`direct-tls` 证书续期后先验证文件权限与完整链，执行 `docker compose exec gateway-tls nginx -t`，再重启 gateway。`behind-proxy` 的证书续期由宝塔、1Panel、Nginx、OpenResty、Cloudflare 或其他外层服务负责。

## 升级与回滚

升级前：

```sh
git status --short
npm run verify:locks
./scripts/validate-compose.sh
```

记录 Git commit、四个服务 digest、Compose profile 和已验证 Redis 备份。升级后检查健康、两个 Host、转换、短链创建、旧短码、日志脱敏和内部端口。失败时切回原 commit/digest；应用组件可重建，Redis 数据按已演练备份恢复。

MyUrls 与 SubConverter 属于独立上游：先在各自边界验证，再更新本仓库锁文件。MyUrls 当前未发布的 Redis URL/TLS commit 不能用于生产锁定或 PaaS 声明。

## 常见故障

- 页面健康但转换失败：区分 gateway、SubConverter、远程配置和订阅源，按浏览器 Network 状态码定位。
- 短链创建失败但跳转正常：检查 `/short-api/short` 路由、Token 两端一致性和 MyUrls 日志，不输出 Token。
- 重启后短码丢失：确认没有删除/更换 `redis-data` 卷，检查 Compose project name 和恢复记录。
- 外层代理 502：先从主机用正确 Host 请求 loopback health，再核对 upstream 和防火墙。
- 磁盘告警：先检查 Docker volume、镜像和日志占用；不要在未确认目标时运行广泛删除命令。
