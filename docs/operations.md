# 运维

## 日常命令

```sh
./scripts/subweb.sh up
./scripts/subweb.sh status
./scripts/subweb.sh logs gateway subconverter
./scripts/subweb.sh down
```

外部 TLS 反向代理不属于 Compose 运行时，只把保留 Host 的请求转发到 Gateway loopback 端口。`status` 通过 Compose 健康检查确认服务状态。短链启用与关闭都是受支持的 profile，两者都只运行 `gateway` 与 `subconverter`。只有 Gateway 应有宿主机端口。

## 日志

日志使用 `Asia/Shanghai`，json-file 驱动单文件 `10m`、最多 `3` 个文件。日志不应包含原始 IP、订阅 URL、Query、Token、数据库路径或完整短码。

| 服务 | 默认级别 | 说明 |
| --- | --- | --- |
| `gateway` | `info`（`LOG_LEVEL`） | 访问日志只记录路由类别，不记录 Query、订阅 URL、原始 IP 或完整短码 |
| `subconverter` | `warning` | 保留首条可恢复出站错误，连续相同错误折叠为计数摘要 |

需要更少输出时把 `LOG_LEVEL` 调到 `warn` 或 `error`，访问日志会一并关闭。访问日志运行在 `info` 且不受限流保护：限流只作用于 `/sub` 与短链创建，静态资源、`404` 和外站 Host 请求都能写日志，因此未认证洪水可以在 `10m × 3` 轮转窗口内挤掉较早的记录。

## 数据与备份

短链映射与到期时间保存在 Gateway 独占的 `links-data` 命名卷中（容器内 `/data/links.db`，SQLite WAL 模式）。只备份短链数据库，不备份转换 URL 或转换结果。

```sh
./scripts/subweb.sh backup --output /absolute/path/links-$(date -u +%Y%m%dT%H%M%SZ).db
./scripts/subweb.sh restore \
  --backup /absolute/path/links-20260101T000000Z.db \
  --confirm-stop-writes
```

- 备份通过 Gateway 自身的 `--backup-links` 子命令生成一致性快照（SQLite `VACUUM INTO`），不直接复制正在写入的数据库文件。
- 恢复要求短链启用、备份路径是绝对路径的普通 SQLite 文件，并显式确认停止写入。
- 恢复期间 Gateway 停止写入，完成后重新启动并等待健康检查通过；其他服务保持运行。
- 普通 `./scripts/subweb.sh down` 只停止容器，不删除命名 volume。不要把删除 volume 作为首次故障排查步骤。

## 故障排查

- 短链创建 `503 dependency_unavailable`：确认 `TURNSTILE_SECRET_KEY` 有效，且 `EGRESS_ALLOWED_HOSTS` 包含 `challenges.cloudflare.com`；siteverify 经受限 `:25503` egress 访问，未列出的目标会 fail closed。
- 短链创建 `403 challenge_required` / `challenge_invalid`：检查前端 Turnstile Site Key 与后端的 Secret Key 是否属于同一 Cloudflare 站点，且 `APP_DOMAIN` 与 widget 域名一致。
- 短链解析 `404`：链接已过期或不存在；`SHORT_LINK_TTL_SECONDS` 默认 7776000 秒（90 天）。
- 短链创建 `429 rate_limited`：默认每 IP 10 分钟 20 次、每天 100 次；单实例部署使用进程内计数，重启会清零。
- Gateway 启动失败并提示数据库不可写：确认 `links-data` 卷可写；容器以 UID 65532 运行。
- 升级后 SubConverter 行为异常：镜像变更后旧的 `subconverter-runtime` 卷会保留上一版模板，按升级提示处理，不要与短链数据库混淆。

## 验证

`./scripts/verify-unified-stack.sh` 使用真实锁定镜像覆盖：两服务拓扑、三 Host 路由、短链创建/解析/过期、Gateway 重启后的持久化、日志密钥泄漏检查，以及 disabled profile。Redis 与 MyUrls 已从运行时移除；旧栈迁移使用 `scripts/operations/export-redis-links.sh` 与 `migrate-shortlinks.sh`。
