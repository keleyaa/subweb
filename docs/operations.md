# 运维

## 日常检查

公网入口由外部 TLS 反向代理负责；Compose 只发布 Gateway 的 loopback 端口。

```sh
./scripts/subweb.sh status
./scripts/subweb.sh logs gateway
./scripts/subweb.sh logs subconverter
./scripts/subweb.sh logs myurls-app myurls-short redis
```

`status` 通过 Compose 健康检查确认服务状态。启用短链时应看到 `gateway`、`subconverter`、`myurls-app`、`myurls-short` 和 `redis`；关闭短链时只应看到 `gateway` 与 `subconverter`。只有 Gateway 应有宿主机端口。

日志使用 `Asia/Shanghai`，json-file 驱动单文件 `10m`、最多 `3` 个文件。日志不应包含原始 IP、订阅 URL、Query、Token、Redis 密码或完整短码。Gateway 的受控 egress 失败和 MyUrls 的 challenge/retry 元数据可以用于排查，但不要扩大日志级别到 `verbose` 后长期运行。

SubConverter 日志会保留首条可恢复出站错误，并将连续、相同错误码的重复告警折叠为一条计数摘要；MyUrls 默认使用 `warn`，Redis 默认使用 `warning`，均保留警告和错误。其他日志仍逐条输出。

## 备份与恢复

短链数据在 Redis DB `0`，Gateway 限流状态在 DB `1`。只备份 Redis RDB，不备份转换 URL 或转换结果。

```sh
./scripts/subweb.sh backup --output /absolute/path/backup.rdb
./scripts/subweb.sh restore \
  --backup /absolute/path/backup.rdb \
  --confirm-stop-writes
```

恢复要求短链启用、备份路径是绝对路径的普通文件，并显式确认停止写入。脚本会根据 `.env` 选择对应 Compose 文件；`.env` 中 `SHORT_LINKS_ENABLED=false` 时，备份和恢复命令会拒绝执行，且不会启动 Redis 或 MyUrls。密码只在容器内通过 `REDISCLI_AUTH` 使用。恢复前保留当前 RDB，完成后检查 Redis、Gateway、SubConverter 和两个 MyUrls 服务健康状态。

## 发布后验证

GitHub package publish job 需要 `packages: write` 权限，并先通过完整发布门禁。完整业务 smoke 由 [`verify-unified-stack.sh`](../scripts/verify-unified-stack.sh) 执行，稳定入口是：

```sh
npm run verify:integration
```

该验证使用真实锁定生产镜像，覆盖三 Host、静态资源与 MIME、转换策略、短链创建/解析/过期、服务独立重启、disabled profile、响应大小/超时和敏感 header 边界。Redis RDB 恢复演练仍由 [`verify-redis-operations.sh`](../scripts/verify-redis-operations.sh) 单独负责：

```sh
npm run verify:operations
```

不要用旧 Nginx、旧 Request Policy 或历史 Compose 验证脚本代替这些入口。

## 资源与故障处理

- Gateway unhealthy：先查看 `gateway` 日志，再确认 `.env` 中 API URL、域名和 feature flags，没有把外部代理变量误传给本地服务。
- SubConverter unhealthy：检查 `/base` volume bootstrap、业务进程是否为非 root UID 和 `CapEff=0`，不要给容器恢复全部 capabilities。单容器模式还应检查入口进程是否仅保留启动所需的 `CHOWN`、`SETUID`、`SETGID`。
- MyUrls unhealthy：确认 Redis DB `0`、两个 `PUBLIC_BASE_URL` 和 Cloudflare Turnstile 配置分别对应 APP/SHORT 域名。
- Redis unhealthy：检查密码、只读配置模板和数据 volume；不要删除 volume 作为第一步排查。

维护前先记录 `git status --short` 和 Compose 状态。升级与恢复的详细边界见 [维护与验证](maintenance.md) 和 [安全](security.md)。
