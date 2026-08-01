# 部署索引

| 方式 | 适用场景 | TLS 与公网入口 | 当前状态 |
| --- | --- | --- | --- |
| [本机源码](deployment-local.md) | 开发、调试、完整源码验证 | 默认只在本机端口；公开时自行配置外层代理 | 脚本和静态契约已验证；当前维护机缺少部分原生依赖，未完成本机全链路实跑 |
| [Docker](deployment-docker.md) `behind-proxy` | 已有宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 或其他入口 | 外层服务终止 TLS，Compose 只绑定 `127.0.0.1:18080` | 已实现并有自动化集成验证 |
| [Docker](deployment-docker.md) `direct-tls` | 没有外层代理，但已有合法双域名证书且 80/443 可用 | 网关直接监听 80/443；部署者负责证书申请与续期 | 已实现并有自动化集成验证 |
| [Railway](deployment-railway.md) | 希望平台管理 TLS、私网和 Redis | 仅 gateway 公开 | 设计中，尚非正式支持 |
| [Render](deployment-render.md) | 希望 Blueprint 管理服务和 Key Value | 仅 gateway 公开 | 设计中，尚非正式支持 |

项目不依赖 Caddy。已有面板或反向代理不会与 `behind-proxy` 冲突：外层代理占用 80/443，Subweb 只监听 loopback 端口。不要同时启用 `direct-tls`，否则会争用 80/443。

无论采用哪种方式，`ml1.one` 与 `api.ml1.one` 都只是维护者展示值。部署者需要准备两个不同域名，并让它们指向同一公网 gateway；应用 Host 提供网页和短链，API Host 提供转换接口。

生产前同时阅读[配置](configuration.md)、[架构](architecture.md)、[安全](security.md)和[运维](operations.md)。
