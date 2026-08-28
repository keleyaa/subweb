# 架构

Subweb 是独立维护的自托管订阅转换发行栈。生产 Compose 启动 Gateway、SubConverter、
两个分别服务 APP/SHORT hostname 的 MyUrls v2 实例和 Redis。公网反向代理、TLS 和 DNS 不属于本仓库的运行时。

```text
Browser
  |-- APP_DOMAIN
  |     `-- Gateway
  |           |-- /sub?...                -> SubConverter
  |           `-- /short-api/v1/links    -> MyUrls v2 (APP instance) -> Redis
  |
  |-- API_DOMAIN
  |     `-- Gateway -> SubConverter
  |
  `-- SHORT_DOMAIN
        `-- Gateway transparent proxy -> MyUrls v2 (SHORT instance) UI/API/redirect
```

## 路由契约

| 公开入口 | 行为 |
| --- | --- |
| `APP_DOMAIN/` | Subweb Vue 工作区 |
| `APP_DOMAIN/short-api/v1/links` | 仅接受 POST JSON，精确转发到 MyUrls `/api/v1/links` |
| `APP_DOMAIN/:code` | 兼容已分享短码的 302 跳转 |
| `API_DOMAIN/*` | 保留原路径和查询参数转发给 SubConverter |
| `SHORT_DOMAIN/*` | 透明转发 MyUrls 页面、`/assets/*`、API、健康检查和短码 |

APP 适配入口清除浏览器的 Authorization、Cookie 和 Origin，覆盖客户端 IP 转发头，不注入
旧 Bearer Token。SHORT 域保留 MyUrls 所需的同源 Origin，由 MyUrls 自行执行 API、CSP、
Turnstile 和响应协议校验。APP 与 SHORT 使用两个独立的 MyUrls 进程，分别校验各自的 hostname，避免
Cloudflare Token 的 hostname 约束与双域入口冲突；两个进程共用 Redis、IP 哈希密钥和镜像版本。

## 信任边界

Gateway 通过仅存在于该网络的 `myurls-app-edge`、`myurls-short-edge` 别名连接 MyUrls，避免
Docker 默认网络解析绕过可信边界。MyUrls 只信任该网络中固定的 Gateway 地址，默认是
`172.30.255.2/32`。外部反代的 `TRUSTED_PROXY_CIDR` 是另一层边界，不得设置为
`0.0.0.0/0`。Redis、MyUrls 和 SubConverter 均不发布宿主机端口。

## 前端边界

- 转换 URL 构造保持为纯函数。
- `ShortLinkClient` 独占 MyUrls v2 HTTP 契约。
- `ShortLinkWorkflow` 负责 UTF-8 长度预检、挑战、重试、复制和 stale-result。
- Vue 组件只绑定状态和用户动作。

本地开发由 Vite 提供页面，并把同源 `/short-api/*` 代理到 Compose 中的 MyUrls v2。
SubConverter 与 MyUrls 使用 loopback 调试端口，Redis 保持私有。

所有服务默认使用 `Asia/Shanghai` 时区。
