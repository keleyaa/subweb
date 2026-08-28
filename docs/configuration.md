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

## 公开配置

| 变量 | 用途 |
| --- | --- |
| `APP_DOMAIN` | Subweb 页面和同源短链适配入口 |
| `API_DOMAIN` | SubConverter 公开域名 |
| `SHORT_DOMAIN` | MyUrls 页面与短码域名 |
| `API_URL` | 写入浏览器运行时配置的转换后端地址 |
| `SUBWEB_PORT` | Gateway 的 loopback 端口，默认值为 `18080` |

浏览器可读取 `/conf/config.js`。该文件只包含 `apiUrl`、菜单和远程配置选项。短链入口固定
为同源 `/short-api/v1/links`，不再公开短链服务地址。

## 秘密与内部配置

| 变量 | 规则 |
| --- | --- |
| `REDIS_PASSWORD` | 独立的 64 位十六进制秘密 |
| `IP_HASH_SECRET` | 独立的、长度不少于 32 字节的秘密，不得复用旧 Token |
| `TURNSTILE_SITE_KEY` | Cloudflare 站点 key（Site Key） |
| `TURNSTILE_SECRET_KEY` | Cloudflare secret key（Secret Key） |
| `TURNSTILE_HOSTNAME` | 不再写入 `.env`；生产 Compose 分别使用 `APP_DOMAIN` 和 `SHORT_DOMAIN`，与各自的 MyUrls 实例匹配 |
| `MYURLS_TRUST_PROXY_CIDR` | 仅填写 Gateway 在内部网络中的精确 CIDR |
| `MYURLS_LOG_LEVEL` | MyUrls 日志级别，默认 `info`；必要时可临时调整为 `warn` 降低日志量 |
| `RESOLVE_LIMIT_10S` | 单个 IP 在 10 秒内的短链解析上限，默认值为 `600` |

生产环境缺少 Turnstile 凭据、Redis 密码或 IP 哈希秘密时，Compose 会 fail closed。不要把这些值写入
`public/`、日志、截图、Issue 或命令行输出。

## 镜像

生产默认使用带 manifest digest 的 MyUrls v2 镜像。可用 `MYURLS_IMAGE` 执行显式回滚，
但不得使用 `latest`。完整源码、镜像和平台 digest 记录在
[`deploy/versions.lock.json`](../deploy/versions.lock.json)。

## 本地开发

| 变量 | 默认值 |
| --- | --- |
| `LOCAL_VITE_PORT` | 5173 |
| `LOCAL_MYURLS_PORT` | 18082 |
| `LOCAL_SHORT_MYURLS_PORT` | 18083 |
| `LOCAL_SUBCONVERTER_PORT` | 25500 |

4 个端口必须互不相同，且位于 `1024` 到 `65535` 之间。Redis 不发布本地端口。
