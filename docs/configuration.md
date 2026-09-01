# 配置

使用 `scripts/configure.sh` 生成权限为 `0600` 的 `.env`：

```sh
./scripts/configure.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY
```

重新运行 `configure.sh` 会重新生成 `.env`，而不是合并旧文件中的可选覆盖项。需要保留已验证的日志级别、可信代理 CIDR 或镜像引用时，先以权限受控的方式备份 `.env`，重新生成后再逐项恢复并运行 `./scripts/validate-compose.sh`；不要把 `.env` 输出到终端、日志或工单。

## 公开配置

| 变量 | 用途 |
| --- | --- |
| `APP_DOMAIN` | Subweb 页面和同源短链适配入口 |
| `API_DOMAIN` | 默认由合并 Subweb 容器提供的转换入口域名 |
| `SHORT_DOMAIN` | 短码域名；默认模式仅公开 `/:code` 跳转 |
| `API_URL` | 写入浏览器运行时配置的转换后端地址 |
| `SUBWEB_PORT` | Subweb 的 loopback 端口，默认值为 `18080` |

浏览器可读取 `/conf/config.js`。该文件只包含 `apiUrl`、菜单和远程配置选项。短链入口固定为同源 `/short-api/links`，不再公开短链服务地址。

## 默认模式的秘密与运行时配置

| 变量 | 规则 |
| --- | --- |
| `REDIS_PASSWORD` | 独立的 64 位十六进制秘密 |
| `IP_HASH_SECRET` | MyUrls 使用的独立秘密，长度不少于 32 字节 |
| `TURNSTILE_SITE_KEY` | Cloudflare 站点 key（Site Key） |
| `TURNSTILE_SECRET_KEY` | Cloudflare secret key（Secret Key） |
| `TURNSTILE_HOSTNAME` | 默认 Compose 从 `APP_DOMAIN` 设置；短链创建在 APP 域完成 |
| `MYURLS_LOG_LEVEL` | MyUrls 日志级别，默认 `info`；必要时可临时调整为 `warn` 降低日志量 |
| `RESOLVE_LIMIT_10S` | 单个 IP 在 10 秒内的短链解析上限，默认值为 `600` |
| `MYURLS_TRUST_PROXY_CIDR` | MyUrls 信任 `subweb` 覆盖后的客户端 IP 头的 Docker bridge CIDR；默认 `172.16.0.0/12`，若 Docker 使用其他地址池则改为实际私网 CIDR |

生产环境缺少 Turnstile 凭据、Redis 密码或 IP 哈希秘密时，Compose 会 fail closed。不要把这些值写入 `public/`、日志、截图、Issue 或命令行输出。默认 Compose 的 MyUrls 短链数据使用 Redis DB `0`。

默认 Compose 中的 SubConverter 直接访问远程订阅源，不执行 Request Policy 的 HTTPS、DNS、响应大小、并发或 egress proxy 校验。可信自用输入可以使用这个低服务数模式；公开、多用户或不可信 URL 必须改用 `compose.hardened.yaml`。

## Hardened Compose 变量

`compose.hardened.yaml` 还消费下列 Request Policy 变量：

| 变量 | 规则 |
| --- | --- |
| `TRUSTED_PROXY_CIDR` | 外层反代的精确来源 CIDR，禁止 `0.0.0.0/0` |
| `CONVERSION_RATE_LIMIT` | 单个匿名 IP 每分钟允许的转换次数，默认值为 `10` |
| `CONVERSION_MAX_CONCURRENCY` | 全局同时运行的转换请求数，默认值为 `2` |
| `CONVERSION_MAX_REQUEST_BYTES` | 转换请求最大大小，默认 `16384`，上限 `1048576` |
| `CONVERSION_MAX_RESPONSE_BYTES` | 上游响应体大小上限，默认 `8388608`，上限 `67108864` |
| `CONVERSION_REQUEST_TIMEOUT_MS` | 单次转换总超时，默认 `10000` |
| `CONVERSION_DNS_TIMEOUT_MS` | DNS 解析超时，默认 `2000` |
| `CONVERSION_EGRESS_CONNECT_TIMEOUT_MS` | egress proxy 到已验证 IP 的 TCP 连接超时，默认 `5000` |

`Request Policy Service` 使用 Redis DB `1` 保存带 TTL 的匿名限流状态，不保存订阅 URL 或转换结果。它会在转换请求进入 `SubConverter-Extended` 前校验公网 HTTPS 地址，并按已验证 IP 建连。Clash 输出中的 provider URL 仍由最终客户端直接拉取，该客户端侧请求不经过本服务。

## 镜像

生产默认使用带 manifest digest 的 MyUrls Rust v2.0.6 镜像。`MYURLS_IMAGE` 只可覆盖为与当前 Rust HTTP 契约兼容、已验证的镜像；Compose 只能校验 OCI 引用格式，不能自动证明替代镜像实现了 `/api/links`、RFC 9457 错误体、健康端点和非 root UID 契约。不得只通过 `MYURLS_IMAGE` 回退到旧 Node 镜像。旧 Node 的 `/api/v1/links` 与当前 Rust 的 `/api/links` 不兼容，跨契约回滚必须一并回退路由、前端与镜像。升级时必须同步更新版本锁并重新验证。完整源码、镜像和平台 digest 记录在 [`deploy/versions.lock.json`](../deploy/versions.lock.json)。

v2.0.6 生产镜像不编入 Turnstile test adapter；`compose.test.yaml` 仅与 `compose.hardened.yaml` 合并运行，使用生产配置和较高的直接放行阈值，避免集成 smoke 触发真实 Cloudflare 请求。challenge/retry 契约由前端、Rust 和浏览器测试覆盖，测试适配器只用于本地 Rust 测试构建，不用于发布镜像。

## 本地开发

| 变量 | 默认值 |
| --- | --- |
| `LOCAL_VITE_PORT` | 5173 |
| `LOCAL_MYURLS_PORT` | 18082 |
| `LOCAL_SUBWEB_PORT` | 18081 |

三个端口必须互不相同，且位于 `1024` 到 `65535` 之间。Redis 不发布本地端口；`LOCAL_SUBWEB_PORT` 仅用于可信本机调试，不复现 hardened Compose 的 egress 边界。
