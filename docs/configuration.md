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

## 获取 Turnstile 密钥

登录 [Cloudflare Dashboard 的 Turnstile 页面](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)，选择 **Add widget** 创建 Widget。Hostname 至少填写 `APP_DOMAIN`；如果 SHORT 域名也承载验证组件，同时填写 `SHORT_DOMAIN`。创建后复制 Site Key 和 Secret Key。

部署命令中的 `--turnstile-site-key` 接收 Site Key；交互式部署会隐藏提示输入 Secret Key，并将两者写入根目录 `.env`（权限 `0600`）。CI 或非交互环境使用 `--turnstile-secret-key-stdin` 通过标准输入传入 Secret Key。Site Key 会出现在前端运行时配置中，Secret Key 只能保留在服务端，不能提交到 Git、写入镜像或放入日志。

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

## 日志级别

生产环境的 MyUrls APP/SHORT 默认使用 `MYURLS_LOG_LEVEL=warn`，Redis 默认使用 `loglevel warning`，保留警告和错误并减少正常请求噪音。临时排查时可在 `.env` 设置 `MYURLS_LOG_LEVEL=info`，完成后恢复为 `warn`；不要长期启用 debug/trace 级别。

## 代理与镜像

`TRUSTED_PROXY_CIDR` 只应配置外层反向代理的确切来源 CIDR。没有可信代理时不要填写；`configure.sh` 入口当前只接受 IPv4 CIDR。Gateway 仅在 socket peer 命中该 CIDR 时信任 `X-Forwarded-For`/`X-Real-IP`；可信链从右向左取首个非可信地址作为限流和上游身份，其他连接始终使用 socket peer。Compose 为 SubConverter、MyUrls Rust v2 和 Redis 内嵌 [版本锁](../deploy/versions.lock.json) 的默认引用，并由 `validate-compose.sh` 校验解析后的服务镜像；`SUBWEB_IMAGE` 是单独的 Gateway release 输入。不可变的 `*_IMAGE` 环境覆盖本身不等于与版本锁兼容，不能用它绕过 `validate-compose.sh` 或 `subweb.sh upgrade` 的合同校验。不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像；跨合同回滚必须同时恢复 Gateway 路由和前端行为。

## 运行时前端配置

Gateway 提供不缓存的 `/conf/config.js`。它只公开非敏感配置，包括 `apiUrl`、`shortLinksEnabled`、`customBackendEnabled` 和可公开的 `turnstileSiteKey`。前端优先读取 `window.__SUBWEB_CONFIG__`，并兼容旧的 `window.config` 别名。Redis 密码、Turnstile secret、IP hash secret、上游地址和 Token 永远不能进入该文件。

## 修改配置

```sh
./scripts/configure.sh --help
./scripts/validate-compose.sh
./scripts/subweb.sh verify
```

修改 feature flag 后必须重新运行配置、Compose 验证和对应 profile 的启动检查。禁用短链时不要只删除 `SHORT_DOMAIN` 后继续使用 `compose.yaml`；必须使用显式 disabled Compose 文件。
