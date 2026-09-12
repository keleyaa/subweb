# 运维

## 日常检查

公网入口由外部 TLS 反向代理负责；Compose 只发布 Gateway 的 loopback 端口。

```sh
./scripts/subweb.sh status
./scripts/subweb.sh logs gateway
./scripts/subweb.sh logs subconverter
./scripts/subweb.sh logs myurls redis
```

`status` 通过 Compose 健康检查确认服务状态。启用短链时应看到 `gateway`、`subconverter`、`myurls` 和 `redis`；关闭短链时只应看到 `gateway` 与 `subconverter`。只有 Gateway 应有宿主机端口。

日志使用 `Asia/Shanghai`，json-file 驱动单文件 `10m`、最多 `3` 个文件。日志不应包含原始 IP、订阅 URL、Query、Token、Redis 密码或完整短码。

默认记录策略是"正常请求有记录、健康探测不产生噪音"：

| 服务 | 默认级别 | 记录内容 | 健康探测 |
| --- | --- | --- | --- |
| `gateway` | `info`（`LOG_LEVEL`） | 每个请求一行访问日志：`request_id`、host 类别、方法、路由类别、状态、耗时 | `/healthz` 与 `/readyz` 不记录 |
| `subconverter` | `info`（entrypoint 固定） | 启动、转换请求与出站重试告警；地址与 Token 由过滤器脱敏 | 过滤器丢弃每 30 秒一次的 `path=/healthz` 行 |
| `myurls` | `warn`（`MYURLS_LOG_LEVEL`） | 只保留警告与错误 | 不产生健康探测日志；短链的正常记录由 Gateway 访问日志覆盖 |
| `redis` | `warning`（配置模板） | Redis 自身警告与错误 | `PING` 健康检查不产生日志 |

`gateway` 的访问日志只包含路由类别（例如 `sub`、`short-create`、`short-resolve`、`static`），不记录 Query、订阅 URL、原始 IP 或完整短码；需要更少输出时把 `LOG_LEVEL` 调到 `warn` 或 `error`，访问日志会一并关闭。`myurls` 的 `info` 会为每次健康探测写一行且无法按路由过滤，因此生产保持 `warn`；只有在排查短链问题、并接受该噪音时才临时打开。MyUrls 的 challenge/retry 元数据与 Gateway 的受控 egress 失败仍可用于排查，但不要长期开启 `verbose`：SubConverter entrypoint 会把 `print_debug_info` 强制为 `false`，不得通过卷内旧配置重新打开。

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
- SubConverter unhealthy：检查 `/base` volume bootstrap、业务进程是否为非 root UID 和 `CapEff=0`，不要给容器恢复全部 capabilities。
- MyUrls unhealthy：确认 Redis DB `0`、`PUBLIC_BASE_URL=https://${SHORT_DOMAIN}` 和 `TURNSTILE_HOSTNAME=${APP_DOMAIN}`；创建挑战需要有效的 Cloudflare 配置，且 `EGRESS_ALLOWED_HOSTS` 必须包含 `challenges.cloudflare.com`，否则 siteverify 无法经 Gateway 的受限 `:25503` egress 到达，会以 `503 dependency_unavailable` fail closed。
- Redis unhealthy：检查密码、只读配置模板和数据 volume；不要删除 volume 作为第一步排查。

维护前先记录 `git status --short` 和 Compose 状态。升级与恢复的详细边界见 [维护与验证](maintenance.md) 和 [安全](security.md)。
