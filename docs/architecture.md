# 架构

Subweb 是独立维护的自托管订阅转换发行栈。默认 Compose 启动合并的 `subweb`、一个 MyUrls Rust v2.0.6 实例和 Redis，共 3 个服务。公网反向代理、TLS 和 DNS 不属于本仓库的运行时。

```text
Browser
  |-- APP_DOMAIN
  |     `-- subweb (Nginx + SubConverter)
  |           |-- /                     -> Subweb Vue 工作区
  |           `-- /short-api/links      -> MyUrls -> Redis
  |
  |-- API_DOMAIN
  |     `-- subweb -> /sub?... -> bundled SubConverter
  |
  `-- SHORT_DOMAIN
        `-- subweb -> MyUrls redirect for /:code
```

## 路由契约

| 公开入口 | 默认行为 |
| --- | --- |
| `APP_DOMAIN/` | Subweb Vue 工作区 |
| `APP_DOMAIN/short-api/links` | 仅接受 POST JSON，转发到 MyUrls `/api/links` |
| `APP_DOMAIN/:code` | 兼容已分享短码的 302 跳转 |
| `API_DOMAIN/sub?...` | 仅接受转换请求，转发到合并容器中的 SubConverter |
| `SHORT_DOMAIN/:code` | 仅短码跳转 |
| `SHORT_DOMAIN/*` | 返回 404；不公开 MyUrls UI、API 或健康端点 |

APP 适配入口清除浏览器的 Authorization、Cookie 和 Origin，覆盖客户端 IP 转发头，不注入旧 Bearer Token。SHORT 只会把已校验的短码路径转发给同一个 MyUrls 实例。该实例的 `TURNSTILE_HOSTNAME` 是 APP 域，`PUBLIC_BASE_URL` 是 SHORT 域，因此短链创建能保留 APP 域的挑战校验，生成的链接仍指向 SHORT 域。MyUrls v2.0.6 在 Redis 短暂断线后会重新建立连接；`REQUEST_TIMEOUT_MS` 为每个请求提供总超时边界。

## 默认信任边界

默认模式的所有服务只在一个 Compose 私有网络中通信，只有 `subweb` 将 `8080` 绑定到宿主机 loopback。Redis 和 MyUrls 不发布宿主机端口。合并后的 SubConverter 通过默认网络直接访问远程订阅源，这减少服务和网络复杂度，但不提供输入级 SSRF/DNS 防护、匿名限流、并发限制或按已验证 IP 的 CONNECT egress。它只适合可信维护者自用或受控输入。

## Hardened Compose

`compose.hardened.yaml` 保留之前的六服务拓扑：Gateway、Request Policy Service、SubConverter、分别服务 APP/SHORT hostname 的两个 MyUrls 实例和 Redis。Request Policy Service 验证 URL、DNS、端口、大小、超时、并发和匿名频率，并为仅在 `subconverter-egress` 网络上的 SubConverter 提供 HTTPS CONNECT proxy。Gateway 与 MyUrls、Redis、Request Policy 分别使用独立网络，避免默认网络路径越过安全边界。公开、多用户或不可信订阅输入必须使用此模式。

## 前端边界

- 转换 URL 构造保持为纯函数。
- `ShortLinkClient` 独占 MyUrls Rust HTTP 契约，并兼容旧版错误响应以支持完整 Subweb release 回滚。
- `ShortLinkWorkflow` 负责 UTF-8 长度预检、挑战、重试、复制和 stale-result。
- Vue 组件只绑定状态和用户动作。

本地开发由 Vite 提供页面，并把同源 `/short-api/*` 代理到 Compose 中的 MyUrls Rust 服务。转换请求通过本地 loopback `subweb` 端口进入合并容器。当前 Rust 端点为 `/api/links`；跨回旧 Node `/api/v1/links` 时，必须一并回退路由、前端与镜像，而不能只替换 MyUrls 镜像。

所有服务默认使用 `Asia/Shanghai` 时区。
