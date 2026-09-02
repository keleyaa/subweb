# 配置

生产配置由 `scripts/configure.sh` 管理并写入根目录 `.env`。文件应为权限 `0600` 的普通文件，不应提交到 Git。Compose 会根据 `SHORT_LINKS_ENABLED` 选择生产文件：启用时使用 `compose.yaml`，关闭时使用 `compose.disabled-short-links.yaml`。

## 必填配置

| 变量 | 启用短链 | 关闭短链 | 说明 |
| --- | --- | --- | --- |
| `APP_DOMAIN` | 必填 | 必填 | APP Host，必须是 ASCII hostname |
| `API_DOMAIN` | 必填 | 必填 | API Host，必须与 APP 不同 |
| `SHORT_DOMAIN` | 必填 | 不需要 | SHORT Host，必须与其他域名不同 |
| `API_URL` | 必填 | 必填 | HTTPS 公网 API URL，或本地 loopback HTTP URL |
| `SHORT_LINKS_ENABLED` | `true` | `false` | 只接受 `true` 或 `false` |
| `CUSTOM_BACKEND_ENABLED` | `true/false` | `true/false` | 关闭时前端强制使用默认 API URL |
| `REDIS_PASSWORD` | 必填 | 不需要 | Redis DB `0`/`1` 的共享密码 |
| `IP_HASH_SECRET` | 必填 | 不需要 | 64 个十六进制字符，用于 IP HMAC |
| `TURNSTILE_SITE_KEY` | 必填 | 不需要 | MyUrls 公共 challenge key |
| `TURNSTILE_SECRET_KEY` | 必填 | 不需要 | MyUrls 私有 challenge key |

启用短链时 APP 与 SHORT 使用不同的 `PUBLIC_BASE_URL`，因此需要两个 MyUrls 实例。不要把两个域名合并到一个实例，也不要给 SHORT Host 暴露管理 API。

## Gateway 策略

以下变量用于统一 Gateway 的 `/sub` 请求策略：

```dotenv
CONVERSION_RATE_LIMIT=10
CONVERSION_RATE_WINDOW_SECONDS=60
CONVERSION_MAX_REQUEST_BYTES=16384
CONVERSION_MAX_RESPONSE_BYTES=8388608
CONVERSION_REQUEST_TIMEOUT_MS=10000
CONVERSION_DNS_TIMEOUT_MS=2000
CONVERSION_EGRESS_CONNECT_TIMEOUT_MS=5000
CONVERSION_MAX_CONCURRENCY=2
```

Gateway 对远程 URL 只允许 HTTPS，或 loopback host 上的 HTTP；解析结果必须是 public-unicast 地址，拒绝私网、特殊用途、scoped IPv6、DNS rebinding 和非 `443` CONNECT 目标。超时、响应大小、并发和限流限制必须是有限正整数，错误时 fail closed。

## 代理与镜像

`TRUSTED_PROXY_CIDR` 只应配置外层反向代理的确切来源 CIDR。没有可信代理时不要填写。Compose 默认使用 `deploy/versions.lock.json` 中的 Gateway、SubConverter、MyUrls Rust v2 和 Redis 引用；`SUBWEB_IMAGE`、`SUBCONVERTER_IMAGE`、`MYURLS_IMAGE`、`REDIS_IMAGE` 仅接受与锁定合同兼容的不可变覆盖。不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像；跨合同回滚必须同时恢复 Gateway 路由和前端行为。

## 运行时前端配置

Gateway 提供不缓存的 `/conf/config.js`。它只公开非敏感配置，包括 `apiUrl`、`shortLinksEnabled`、`customBackendEnabled` 和可公开的 `turnstileSiteKey`。前端优先读取 `window.__SUBWEB_CONFIG__`，并兼容旧的 `window.config` 别名。Redis 密码、Turnstile secret、IP hash secret、上游地址和 Token 永远不能进入该文件。

## 修改配置

```sh
./scripts/configure.sh --help
./scripts/validate-compose.sh
./scripts/subweb.sh verify
```

修改 feature flag 后必须重新运行配置、Compose 验证和对应 profile 的启动检查。禁用短链时不要只删除 `SHORT_DOMAIN` 后继续使用 `compose.yaml`；必须使用显式 disabled Compose 文件。
