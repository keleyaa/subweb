# Subweb 统一整合架构 PRD

**文档状态：** 已确认并已实施；本文保留决策依据，执行合同以当前 Compose、配置和验证脚本为准
**目标版本：** v1.0 统一网关架构  
**目标读者：** 项目维护者、实现代理、发布审核者、生产运维人员  
**决策范围：** 产品定位、技术栈、运行拓扑、功能开关、迁移路线与生产验收  

## 1. 文档目的

本文定义 Subweb 从「前端与多个上游镜像的组合项目」演进为「面向自托管用户的订阅转换与短链整合网关」所需的产品需求和技术方案。

本文用于指导后续设计、开发、测试、发布和生产部署。实施阶段不得仅以缩短启动命令为目标而牺牲安全边界、数据持久化、上游镜像独立升级能力或故障隔离能力。

## 2. 背景与问题

Subweb 最初是 Vue 前端，后续接入了 SubConverter-Extended、MyUrls 和 Redis，并增加了 Nginx Gateway、Request Policy、运行时配置、Docker Compose、镜像锁定和发布验证。

当前实现已经收敛为一个生产合同：Go Gateway 与 Request Policy 是同一个 Go 1.25 单二进制，前端仍是 Vue 3 + Vite，SubConverter、两个 MyUrls Rust v2.0.6 实例和 Redis 保持独立。短链启用时是五服务 Compose profile；关闭短链时使用明确的两服务 Compose profile。

该决策解决了以下问题：

- 生产部署只有一个默认合同，不再在简化和 hardened 语义之间选择。
- Gateway、URL/DNS 策略、限流和 CONNECT egress 由一个可测试的 Go 服务统一承担。
- 「一个部署入口」与「单容器运行」明确区分；项目使用 Compose，不把独立生命周期强行合并到一个容器。
- 功能开关、安全基线和上游镜像职责形成稳定接口。
- 外部 TLS 反向代理、项目自有 Gateway、上游服务和数据存储的责任边界清晰。

## 3. 产品定义

### 3.1 产品定位

Subweb 是面向自托管维护者的订阅转换与短链整合网关。

Subweb 为浏览器提供统一界面，为上游 SubConverter-Extended 和 MyUrls 提供稳定、安全的访问接口，并通过一个部署入口完成配置、镜像拉取、服务编排、健康检查和生产验证。

### 3.2 目标用户

主要用户：

- 在公网部署订阅转换服务的个人维护者。
- 为少量或中等规模用户提供匿名订阅转换服务的维护者。
- 需要短链创建、跳转、Turnstile 和 Redis 持久化能力的维护者。
- 已经使用 Nginx、Caddy、Traefik、1Panel、宝塔或 Cloudflare Tunnel 管理 TLS 的用户。

不作为首个版本主要目标的用户：

- 需要多租户账户、计费、权限管理或审计后台的 SaaS 运营方。
- 需要 Kubernetes Operator 或跨主机高可用编排的团队。
- 需要在 Subweb 内编辑 SubConverter 配置文件或管理 MyUrls 数据的管理员。

### 3.3 核心价值

- 使用一个部署入口完成生产栈启动，而不是手工连接多个上游容器。
- 对公开、不可信订阅 URL 提供默认开启且不可绕过的安全策略。
- 保留上游镜像边界，避免重复实现成熟转换和短链能力。
- 允许按环境变量关闭短链或自定义转换后端。
- 让前端、统一网关、转换引擎、短链引擎和存储各自拥有明确职责。
- 通过版本锁、集成测试和发布门禁提供可复现生产发布。

## 4. 目标与非目标

### 4.1 产品目标

- 仅维护一个正式生产拓扑及其可选功能集合。
- 使用 Go 1.25 重写并统一项目自有 Gateway 与 Request Policy。
- 继续使用 Vue 3 + Vite 构建静态 SPA。
- 继续消费 SubConverter-Extended、MyUrls 和 Redis 的固定版本镜像。
- 短链开启时使用 5 个容器，关闭时使用 2 个容器。
- 所有公网转换请求强制经过 URL、DNS、IP、大小、超时、并发和限流策略。
- 使用一个安装或启动命令执行 Docker Compose 编排。
- 所有服务只发布一个宿主机 loopback 入口。
- TLS、证书和公网 DNS 继续由外部反向代理负责。
- `SHORT_LINKS_ENABLED=false` 时同步移除前端入口、公开路由、配置要求和 MyUrls/Redis 容器。
- 保持现有短链 HTTP 合同和 Redis 数据兼容性。
- 为迁移、回滚、备份、恢复和升级提供可验证流程。

### 4.2 技术目标

- 项目自有生产后端收敛为一个 Go 单二进制。
- 使用 Go 标准库优先实现 HTTP 服务、反向代理、配置和并发控制。
- 仅在标准库无法可靠覆盖 Redis 协议等明确需求时引入小型、成熟依赖。
- Go Gateway 以稳定接口隐藏上游镜像、内部网络和错误格式差异。
- 前端不直接感知 MyUrls、Redis 或 SubConverter 的内部地址。
- 生产容器使用非 root、只读根文件系统、最小 capability 和不可变镜像引用。
- CI 和本地发布预检共用同一套完整验证入口。

### 4.3 非目标

首个统一架构版本不做以下工作：

- 不将所有进程打包进一个容器。
- 不要求用户使用字面意义上的单条 `docker run` 启动整个系统。
- 不重写 SubConverter-Extended。
- 不重写 MyUrls。
- 不使用 Go 直接操作 MyUrls 的 Redis 数据模型。
- 不将 Redis 替换为关系型数据库。
- 不引入 Nuxt、SSR、GraphQL、Pinia 或前端全栈框架。
- 不内置 ACME、TLS 证书或公网反向代理。
- 不建设用户账户、管理后台、计费、团队空间或多租户权限。
- 不提供关闭 SSRF、DNS、限流、超时或网络隔离的开关。
- 不恢复已删除的 simple/hardened 两套历史生产合同；当前执行合同只有五服务 profile 与明确的 disabled profile。
- 不以减少容器数量为由合并 Redis、MyUrls 或 SubConverter 的生命周期。

## 5. 成功标准

### 5.1 用户体验指标

- 新部署者准备好域名和外部反向代理后，可通过一个项目入口完成配置和启动。
- 安装入口在缺少 Docker、无效域名、缺少秘密、镜像不兼容或健康检查失败时给出可操作错误。
- 用户无需了解内部容器地址、Redis DB 分工或上游代理协议。
- 短链关闭时，不要求提供 Turnstile 或 Redis 秘密。
- 自定义后端关闭时，前端不显示相关控件，伪造请求也会被后端拒绝。

### 5.2 可靠性指标

- Gateway、SubConverter、MyUrls 和 Redis 分别重启后，已支持的业务路径可以恢复。
- Redis 短暂断线后，MyUrls 和 Gateway 限流能力可以恢复连接。
- 客户端断开转换请求后，Gateway 取消对应上游请求并释放并发额度。
- 上游超时、响应过大、DNS 失败和连接失败均有明确、有限时长的失败行为。
- 生产服务不得依赖修改只读镜像目录。

### 5.3 安全指标

- SubConverter 容器不能直接访问公网，只能通过 Gateway 提供的受控 HTTPS CONNECT egress。
- loopback、私网、link-local、保留地址和不允许端口不能作为远程订阅目标。
- DNS 校验后必须按已验证 IP 建连，禁止二次解析绕过策略。
- 客户端提供的 Authorization、Proxy-Authorization、Cookie、Origin 和代理 IP 头不得透传到内部上游。
- Redis、MyUrls 和 SubConverter 不发布宿主机端口。
- 任何生产镜像必须使用锁定版本和 digest。
- 日志不得包含原始订阅 URL、完整短码、Turnstile token、Redis 密码、IP hash secret 或完整客户端 IP。

### 5.4 发布指标

发布必须同时通过：

- Vue 单元测试、静态检查和生产构建。
- Go 单元测试、竞态测试、静态分析和生产构建。
- Compose 合同验证。
- Docker 容器验证。
- 默认生产拓扑集成测试。
- 短链开关关闭后的精简拓扑测试。
- 自定义后端开关组合测试。
- Redis 备份与恢复测试。
- 镜像版本锁验证。
- 安全扫描。
- 文档与示例命令验证。
- 发布预检终端成功标记验证。

## 6. 技术栈决策

### 6.1 前端

| 类别 | 选择 | 理由 |
| --- | --- | --- |
| UI 框架 | Vue 3 | 当前实现成熟，适合单页面交互工具。 |
| 构建工具 | Vite | 构建简单、开发反馈快，现有测试和配置可复用。 |
| 语言 | JavaScript，按模块逐步引入 TypeScript | 不为迁移而迁移；新增跨模块合同优先使用 TypeScript 或 JSDoc 类型。 |
| 单元测试 | Vitest | 与现有 Vite 工具链一致。 |
| 浏览器测试 | Playwright | 覆盖真实交互、响应式布局和功能开关。 |
| 状态管理 | Vue Composition API 与局部模块 | 当前状态规模不需要 Pinia。 |
| 样式 | 现有 CSS | 保持命令界面视觉合同，不引入无必要框架。 |

前端保持静态 SPA，不需要 SSR。它只负责界面状态、用户动作和结果展示，业务合同继续下沉到可独立测试的领域模块。

### 6.2 统一后端

| 类别 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | Go 1.25 | HTTP、并发、代理和单二进制部署能力成熟。 |
| HTTP 服务 | `net/http` | 标准库足以提供 Host 路由、静态文件、反向代理和健康检查。 |
| 依赖转发 | 项目内 HTTP client 与固定地址 Transport | 支持请求取消、完整响应缓冲、响应改写和受控拨号；不承诺 streaming 或 protocol upgrade。 |
| 配置 | 标准库环境变量解析与项目内校验 | 配置合同需要 fail closed，不引入大型配置框架。 |
| DNS/IP | `net.Resolver`、`net/netip` | 支持解析、CIDR 和地址分类。 |
| 并发限制 | channel semaphore | 需求固定且简单，不引入额外库。 |
| Redis | 选择一个维护活跃、支持 Context 的 Go 客户端 | 用于匿名限流；不得自行实现完整 Redis 协议。 |
| 日志 | `log/slog` | 提供结构化日志并便于字段白名单。 |
| 测试 | `testing`、`httptest`、必要的容器集成测试 | 标准库优先，真实镜像合同由 Docker 测试覆盖。 |

### 6.3 上游运行时

| 模块 | 来源 | 职责 |
| --- | --- | --- |
| SubConverter-Extended | 固定上游 OCI 镜像 | 执行订阅转换。 |
| MyUrls | 固定 Rust v2 OCI 镜像 | 创建和解析短链，执行 Turnstile 与短链风险控制。 |
| Redis | 固定官方 OCI 镜像 | 保存短链和匿名限流状态。 |
| 外部反向代理 | 用户已有设施 | 管理 TLS、证书和三个公网域名。 |

## 7. 目标架构

### 7.1 短链开启拓扑

```text
APP_DOMAIN ─────┐
API_DOMAIN ─────┼── external TLS proxy ── 127.0.0.1:18080
SHORT_DOMAIN ───┘                              │
                                               ▼
                                      gateway (Go)
                                      │       │       │
                                      │       │       └── Vue static assets
                                      │       ├── myurls-app ──┐
                                      │       └── myurls-short ─┤
                                      │                          ▼
                                      │                     Redis DB 0
                                      └── subconverter ── internal CONNECT egress
```

容器集合：

- `gateway`
- `subconverter`
- `myurls-app`
- `myurls-short`
- `redis`

### 7.2 短链关闭拓扑

```text
APP_DOMAIN ─────┐
API_DOMAIN ─────┼── external TLS proxy ── 127.0.0.1:18080
SHORT_DOMAIN ───┘                              │
                                               ▼
                                      gateway (Go)
                                      │                 │
                                      │                 └── Vue static assets
                                      └── SubConverter
                                               ▲
                                               │
                                   controlled HTTPS CONNECT
```

容器集合：

- `gateway`
- `subconverter`

此模式不启动 MyUrls 和 Redis。首个版本不为了限流单独保留 Redis；Gateway 在无 Redis 的精简拓扑中使用单实例内存限流。该差异必须明确记录为单主机、单 Gateway 实例合同，不承诺跨实例共享限流。

### 7.3 网络模型

生产 Compose 定义以下网络：

- 默认网络：Gateway 与其本地依赖的基础通信。
- `subconverter-egress`：Gateway 的 CONNECT 代理与 SubConverter 通信，设置为 `internal: true`。
- `myurls-edge`：Gateway 与两个 MyUrls 实例通信，设置为 `internal: true`。
- `myurls-data`：两个 MyUrls 实例与 Redis 通信，设置为 `internal: true`。
- `redis-policy`：Redis 与 Gateway 限流客户端通信，设置为 `internal: true`。

规则：

- Gateway 容器监听 `8080`，宿主机只通过 loopback 发布一个映射端口。
- SubConverter 仅加入其必需的内部网络，不加入具有默认公网路由的网络。
- MyUrls 不能直接访问 Gateway 之外的公开入口。
- Redis 只加入 `myurls-data` 与 `redis-policy`；Gateway 不加入 `myurls-data`。
- Docker DNS 能解析名称不代表网络可达性，验证必须检查实际网络成员和连接结果。

## 8. 模块设计

### 8.1 Gateway 模块

外部接口：

```text
HTTP listener: 0.0.0.0:8080
Health: GET /healthz
Readiness: GET /readyz
```

职责：

- 根据 Host 和精确路由分发请求。
- 托管 Vue 静态文件和浏览器运行时配置。
- 提供 SPA fallback，但不掩盖缺失静态资源。
- 转发转换请求、短链创建和短码解析。
- 清除敏感请求头。
- 规范客户端 IP。
- 统一错误响应和 request ID。
- 统一访问日志字段。
- 设置 CSP、HSTS 之外的安全头；HSTS 由外部 TLS 入口负责。
- 将请求 Context 取消传播到所有上游操作。

Gateway 不负责：

- 实现转换算法。
- 直接读写短链数据。
- 签发 TLS 证书。
- 信任任意客户端 Forwarded 头。

### 8.2 Conversion Policy 模块

稳定接口概念：

```go
type ConversionRequest struct {
    ClientIP netip.Addr
    Target   *url.URL
}

type ConversionPolicy interface {
    Authorize(ctx context.Context, request ConversionRequest) (AuthorizedTarget, error)
}
```

实际实现可以继续细分内部模块，但这些内部接口不得扩散到 Gateway 调用者。

职责：

- 校验 URL scheme、userinfo、hostname、端口和长度。
- 解析 DNS。
- 拒绝不允许的地址范围。
- 返回已授权目标和已验证 IP 集合。
- 将授权结果传递给受控 Dialer，禁止重新按 hostname 解析。
- 执行匿名频率限制、请求大小限制、响应大小限制、超时和并发限制。
- 在重定向时重新执行完整授权。

### 8.3 Egress Proxy 模块

职责：

- 仅接受来自 SubConverter 网络身份的 CONNECT 请求。
- 仅允许由 Conversion Policy 授权的目标。
- 对目标 hostname 和已验证 IP 建立绑定。
- 应用连接超时、空闲超时和总请求取消。
- 不记录完整目标 URL 或敏感 Query。
- 禁止作为通用开放代理使用。

授权信息应有短 TTL，并与原始转换请求建立不可伪造关联。实施计划必须选择具体机制并通过并发与重放测试；不得仅根据目标 hostname 判断授权。

### 8.4 Short Link Adapter 模块

职责：

- 独占 MyUrls Rust HTTP 合同。
- 将 APP 域的 `POST /short-api/links` 映射到 MyUrls `/api/links`。
- 将 APP/SHORT 域短码路径映射到 MyUrls 解析接口。
- 清除客户端凭据和内部 Token。
- 转换 RFC 9457 problem details 与兼容回滚错误格式。
- 保留 `retryAfterSeconds` 和 `challenge` 字段。
- 限制请求体为 16 KiB。
- 使用 10 秒客户端请求总超时。

不得通过单独替换 `MYURLS_IMAGE` 回滚到旧 Node `/api/v1/links` 合同。跨合同回滚必须同时恢复 Gateway 路由、前端适配和镜像。

### 8.5 Runtime Configuration 模块

职责：

- 读取并验证全部环境变量。
- 根据功能开关判断必填项。
- 启动时一次性生成不可变配置对象。
- 生成浏览器可读取但不包含秘密的 `/conf/config.js`。
- 对未知、冲突或危险值 fail closed。
- 提供可脱敏输出的配置摘要。

### 8.6 Frontend Domain 模块

保留并收敛当前职责：

- 转换 URL 构造保持纯函数。
- `ShortLinkClient` 独占统一 Gateway 短链接口。
- `ShortLinkWorkflow` 负责长度预检、挑战、重试、复制和 stale-result。
- Vue 组件只绑定状态和用户动作。
- 运行时配置决定是否渲染短链和自定义后端控件。

## 9. 路由合同

### 9.1 APP 域

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/` | 返回 Vue SPA。 |
| GET | `/assets/*` | 返回构建资源，支持 immutable cache。 |
| GET | `/conf/config.js` | 返回运行时公开配置，禁止缓存秘密。 |
| GET | `/favicon.svg` | 返回明确 MIME 类型。 |
| GET | `/apple-touch-icon.png` | 返回 `image/png`。 |
| GET | `/icon-192.png` | 返回 `image/png`。 |
| GET | `/icon-512.png` | 返回 `image/png`。 |
| GET | `/site.webmanifest` | 返回 `application/manifest+json`。 |
| GET | `/robots.txt` | 返回 `text/plain`。 |
| GET | `/sitemap.xml` | 返回 XML MIME 类型。 |
| POST | `/short-api/links` | 短链开启时创建短链。 |
| GET | `/:code` | 短链开启时兼容已有 APP 域短码。 |
| GET | `/healthz` | 进程存活检查。 |
| GET | `/readyz` | 依赖就绪检查。 |

以下路径必须返回 404，不得进入 SPA fallback：

- 缺失的 PWA 资源。
- 缺失的 crawler metadata。
- `/short-api/*` 的未知子路径。
- 内部健康、管理和调试接口。

### 9.2 API 域

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/sub` | 执行完整策略后代理到 SubConverter。 |
| GET | `/healthz` | Gateway 存活检查。 |
| GET | `/readyz` | 转换链路就绪检查。 |

其他方法和路径返回 404 或 405。`/sub` 转发前必须清除：

- `Authorization`
- `Proxy-Authorization`
- `Cookie`
- `Origin`
- 客户端提供的 `Forwarded`
- 客户端提供的 `X-Forwarded-*`

### 9.3 SHORT 域

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/:code` | 短码跳转。 |
| GET | `/healthz` | Gateway 存活检查。 |

SHORT 域不公开：

- MyUrls UI。
- MyUrls API。
- MyUrls health 路由。
- 静态管理资源。
- 任意通配代理。

当 `SHORT_LINKS_ENABLED=false` 时，SHORT 域所有业务路径返回 404。

## 10. 错误合同

Gateway 对浏览器和调用者返回统一 problem details：

```json
{
  "type": "about:blank",
  "title": "Request rejected",
  "status": 403,
  "code": "url_not_allowed",
  "requestId": "req_..."
}
```

可选字段：

```json
{
  "retryAfterSeconds": 30,
  "challenge": {
    "provider": "turnstile",
    "siteKey": "public-site-key"
  }
}
```

要求：

- Content-Type 使用 `application/problem+json`。
- `requestId` 在 Gateway 生成并贯穿内部日志。
- 不向客户端返回内部容器地址、解析 IP、Redis 错误或 Go stack trace。
- 上游断开、超时、响应过大和策略拒绝必须使用不同稳定错误码。
- HTTP 状态码与当前 MyUrls Rust 合同保持兼容，其中 Gateway 的 `url_not_allowed` 保持 HTTP `403`；Rust MyUrls 自身的 `url_not_allowed` 才使用 HTTP `422`。

## 11. 功能开关

### 11.1 `SHORT_LINKS_ENABLED`

默认值为 `true`。

开启时：

- 启动 MyUrls 和 Redis。
- 暴露短链创建与跳转路由。
- 前端显示短链操作。
- 强制要求 Redis、IP hash 和 Turnstile 配置。
- Redis DB `0` 保存短链数据。

关闭时：

- 不启动 MyUrls 和 Redis。
- 不暴露短链路由。
- 前端不加载 Turnstile，不显示短链操作。
- 不要求 Redis 和 Turnstile 秘密。
- `/short-api/*` 和短码路径返回 404。

### 11.2 `CUSTOM_BACKEND_ENABLED`

默认值为 `true`。

开启时：

- 前端显示自定义转换后端入口。
- 用户输入仍受完整 URL 和网络策略约束。
- 自定义后端不能绕过统一 Gateway。

关闭时：

- 前端隐藏自定义后端入口。
- 只允许部署者配置的固定转换入口。
- 后端拒绝伪造的自定义目标参数。

### 11.3 不可关闭的生产控制

以下控制不是功能，不提供关闭开关：

- SSRF 防护。
- DNS rebinding 防护。
- 地址范围和端口校验。
- 请求体和响应体大小限制。
- 请求、DNS、连接和关闭超时。
- 并发限制。
- 匿名限流。
- 敏感头清理。
- 非 root 用户。
- 只读根文件系统。
- capability 清理。
- 私有网络。
- 日志脱敏。
- 镜像版本锁。

## 12. 配置合同

### 12.1 基础变量

| 变量 | 默认值 | 条件 | 规则 |
| --- | --- | --- | --- |
| `APP_DOMAIN` | 无 | 必填 | 纯 hostname，不含 scheme、路径或端口。 |
| `API_DOMAIN` | 无 | 必填 | 必须与其他域名不同。 |
| `SHORT_DOMAIN` | 无 | 短链开启时必填 | 必须与 APP/API 不同。 |
| `API_URL` | `https://${API_DOMAIN}` | 必填 | 只允许 HTTPS 或 loopback HTTP。 |
| `SUBWEB_PORT` | `18080` | 可选 | 范围 1 到 65535，仅绑定 `127.0.0.1`。 |
| `TZ` | `Asia/Shanghai` | 可选 | 所有服务保持一致。 |
| `TRUSTED_PROXY_CIDR` | 无 | 使用外部代理客户端 IP 时必填 | 只允许明确 CIDR，拒绝 `0.0.0.0/0`。 |

### 12.2 功能变量

| 变量 | 默认值 | 规则 |
| --- | --- | --- |
| `SHORT_LINKS_ENABLED` | `true` | 只接受 `true` 或 `false`。 |
| `CUSTOM_BACKEND_ENABLED` | `true` | 只接受 `true` 或 `false`。 |

### 12.3 短链变量

| 变量 | 默认值 | 条件 |
| --- | --- | --- |
| `REDIS_PASSWORD` | 自动生成 | 短链开启时必填。 |
| `IP_HASH_SECRET` | 自动生成 | 短链开启时必填，64 字符十六进制。 |
| `TURNSTILE_SITE_KEY` | 无 | 短链开启时必填。 |
| `TURNSTILE_SECRET_KEY` | 无 | 短链开启时必填。 |
| `MYURLS_LOG_LEVEL` | `info` | 可选。 |
| `MYURLS_TRUST_PROXY_CIDR` | Gateway 固定地址 `/32` | 由 Compose 生成，不建议用户覆盖。 |

### 12.4 转换策略变量

| 变量 | 默认值 | 允许范围 |
| --- | --- | --- |
| `CONVERSION_RATE_LIMIT` | `10` | 正整数。 |
| `CONVERSION_RATE_WINDOW_SECONDS` | `60` | 有限正整数。 |
| `CONVERSION_MAX_REQUEST_BYTES` | `16384` | 最大 `1048576`。 |
| `CONVERSION_MAX_RESPONSE_BYTES` | `8388608` | 最大 `67108864`。 |
| `CONVERSION_REQUEST_TIMEOUT_MS` | `10000` | 有限、实际可执行范围。 |
| `CONVERSION_DNS_TIMEOUT_MS` | `2000` | 小于请求总超时。 |
| `CONVERSION_EGRESS_CONNECT_TIMEOUT_MS` | `5000` | 小于请求总超时。 |
| `CONVERSION_MAX_CONCURRENCY` | `2` | 有限正整数。 |

### 12.5 镜像变量

| 变量 | 规则 |
| --- | --- |
| `SUBWEB_IMAGE` | 生产只接受不可变 `sha-*` 标签或 digest。 |
| `SUBCONVERTER_IMAGE` | 必须与版本锁一致。 |
| `MYURLS_IMAGE` | 必须与 Rust v2 当前 HTTP 合同兼容并通过版本锁校验。 |
| `REDIS_IMAGE` | 必须与版本锁一致。 |

## 13. 数据与持久化

### 13.1 Redis DB `0`

仅在短链开启时存在，用于：

- 短链目标。
- 短链 TTL。
- MyUrls 风险状态。

### 13.2 Gateway 限流状态

首个统一架构只支持单 Gateway 实例：

- 短链开启时可以使用 Redis DB `1` 保存带 TTL 的匿名限流状态。
- 短链关闭时使用进程内限流状态，重启后重置。
- 不承诺跨主机或多 Gateway 实例一致性。

未来只有在明确支持水平扩展时，才要求限流 Redis 独立于短链功能持续运行。

### 13.3 禁止持久化的数据

- 原始订阅 URL。
- 转换结果。
- Turnstile token。
- 完整客户端 IP。
- Authorization 或 Cookie。
- IP hash secret。
- Redis 密码。
- 完整短码访问日志。

### 13.4 备份与恢复

短链开启时必须提供：

- Redis 备份命令。
- 备份完整性验证。
- 恢复命令。
- 恢复到临时实例后的短链解析验证。
- 升级前强制 preflight。
- 失败时不覆盖现有数据。

## 14. 部署接口

### 14.1 部署原则

「一个命令部署」定义为一个用户入口调用 Docker Compose 启动多个职责独立的容器，不定义为单容器运行。

不得使用远程脚本管道作为唯一正式文档路径。正式路径必须允许用户固定版本并在执行前检查内容。

### 14.2 建议命令

正式 Shell CLI 先生成配置，再选择已验证的 Compose profile：

```sh
./scripts/configure.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key SITE_KEY \
  --turnstile-secret-key SECRET_KEY
./scripts/validate-compose.sh
./scripts/subweb.sh up
```

日常命令：

```sh
./scripts/subweb.sh up
./scripts/subweb.sh down
./scripts/subweb.sh status
./scripts/subweb.sh logs
./scripts/subweb.sh verify
./scripts/subweb.sh backup
./scripts/subweb.sh upgrade
```

CLI 只是 Compose 的薄封装，不重新实现容器编排。

### 14.3 安装流程

安装入口依次执行：

1. 检查 Docker Engine 和 Compose v2。
2. 校验域名、端口、功能开关和秘密。
3. 原子生成权限为 `0600` 的 `.env`。
4. 读取并验证 `deploy/versions.lock.json`。
5. 选择由功能开关决定的 Compose service/profile。
6. 拉取所有不可变镜像。
7. 运行 Compose 合同校验。
8. 使用 `--no-build --pull never` 启动已拉取镜像。
9. 等待健康检查。
10. 执行业务 smoke test。
11. 输出外部反向代理配置摘要，不输出秘密。

### 14.4 外部反向代理合同

三个域名都转发到：

```text
127.0.0.1:${SUBWEB_PORT}
```

要求：

- 保留原始 Host。
- 只从明确可信来源接收客户端 IP 头。
- TLS 终止发生在外部反向代理。
- 不将 Redis、MyUrls 或 SubConverter 暴露到公网。
- 项目提供外部 TLS 反向代理示例，但不维护证书生命周期；示例不能访问内部服务端口。

## 15. 容器要求

### 15.1 Gateway 镜像

使用多阶段构建：

1. Node 24 构建 Vue 静态资源。
2. Go 1.25 构建静态二进制。
3. 最小非 root 运行镜像包含 Go 二进制、静态资源、CA 证书和时区数据。

要求：

- 固定所有基础镜像 digest。
- `CGO_ENABLED=0`，除非有经过记录的必要依赖。
- 非 root UID/GID。
- 只读根文件系统。
- `/tmp` 使用受限 tmpfs。
- `cap_drop: ALL`。
- `no-new-privileges:true`。
- 提供 OCI source、version、revision 和 license 标签。

### 15.2 上游容器

- SubConverter 保持上游运行目录和相对资源语义。
- 两个 MyUrls 实例使用已验证 Rust v2.0.6 镜像和 UID `10001:10001`，各自保持独立的 PUBLIC_BASE_URL。
- Redis 使用固定镜像、named volume、密码和只读配置模板。
- 不通过复制部分上游文件到无关基础镜像的方式破坏其运行时合同。

## 16. 可观测性

### 16.1 日志

使用结构化 JSON 或 `slog` 文本格式，固定字段：

- timestamp
- level
- requestId
- route
- method
- status
- durationMs
- errorCode
- upstreamName

禁止字段：

- 原始 URL Query。
- Authorization。
- Cookie。
- Turnstile token。
- Redis secret。
- 完整客户端 IP。
- 完整短码。

### 16.2 健康检查

`/healthz`：

- 只证明 Gateway 进程存活。
- 不访问外部网络。
- 必须快速返回。

`/readyz`：

- 检查启用功能所需内部上游。
- SubConverter 不健康时返回失败。
- 短链开启时检查 MyUrls 和 Redis 链路。
- 短链关闭时不得因 MyUrls/Redis 缺失失败。

### 16.3 指标

首个版本不引入 Prometheus 依赖。日志和健康检查先满足单机运维需求。出现明确容量或 SLO 需求后再增加指标接口。

## 17. 测试策略

### 17.1 Go 单元测试

覆盖：

- 环境变量解析和交叉条件。
- Host 和路由分发。
- 请求头清理。
- URL、端口、userinfo 和 scheme 校验。
- IPv4、IPv6、CIDR 和保留地址分类。
- DNS 超时与多地址结果。
- 重定向重新授权。
- 请求大小和响应大小限制。
- 并发额度获取与释放。
- 客户端取消传播。
- 统一错误合同。
- 日志脱敏。

### 17.2 差分测试

迁移 Request Policy 时，同一输入集同时运行旧 Node 实现和新 Go 实现，比较：

- 允许/拒绝结果。
- HTTP 状态。
- 错误码。
- 超时边界。
- 重定向行为。
- DNS/IP 分类。
- 响应大小处理。

差异必须被明确批准，不能默认为新实现正确。

### 17.3 前端测试

覆盖：

- 短链开关控制界面和请求。
- 自定义后端开关控制界面和参数。
- 转换 URL 生成。
- 短链 challenge、retry 和错误映射。
- stale-result 与复制行为。
- 运行时配置无秘密。
- 桌面和移动端无内容重叠。

### 17.4 Docker 集成测试

必须使用真实发布镜像验证：

- Vue 页面和所有静态资源 MIME。
- APP、API 和 SHORT Host 路由。
- 转换成功路径。
- 受阻 URL、私网 IP 和 DNS 失败。
- 响应过大和超时。
- 限流和并发。
- 短链创建、跳转和过期。
- Turnstile challenge 合同。
- Gateway、SubConverter、MyUrls 和 Redis 分别重启后的恢复。
- 短链关闭时只启动 2 个容器。
- 自定义后端关闭时伪造请求失败。
- 容器网络实际不可达性。
- 只读根文件系统和非 root 用户。
- 日志隐私哨兵。

### 17.5 发布验证

统一入口必须包含：

```sh
npm run verify:ci
go test -race ./...
go vet ./...
go build ./...
./scripts/validate-compose.sh
./scripts/verify-release.sh
git diff --check
```

只有观察到明确终端标记 `release verification=passed` 才可视为发布预检成功。截断输出或部分子命令成功不能作为发布证据。

## 18. 迁移计划

### 阶段 0：冻结现有生产合同

交付：

- 记录当前 Vue、MyUrls、SubConverter、Redis 和路由行为。
- 为现有 hardened 路径补齐必要基线测试。
- 固定迁移起点 commit 和镜像 digest。
- 验证 Redis 备份与恢复。

退出标准：

- 当前生产路径可重复启动并通过完整集成测试。
- 关键路由、错误和数据合同均有自动化测试。

### 阶段 1：建立 Go Gateway 骨架

交付：

- Go module 和目录结构。
- 配置模块。
- Host 路由。
- 静态资源托管。
- `/healthz` 和 `/readyz`。
- problem details 错误模型。
- request ID 和结构化日志。

退出标准：

- Go Gateway 可以独立托管当前 Vue 构建。
- 静态资源、SPA fallback 和 Host 隔离测试通过。

### 阶段 2：迁移 Conversion Policy

交付：

- URL 和 DNS 策略。
- 受控 Dialer。
- 请求/响应边界。
- 并发和匿名限流。
- HTTPS CONNECT egress。
- 与旧 Node Request Policy 的差分测试。

退出标准：

- 所有已知安全合同在 Go 实现中通过。
- SubConverter 无直接公网访问路径。
- 旧 Node Request Policy 尚未删除，可用于回归比较。

### 阶段 3：迁移转换路由

交付：

- `/sub` 进入 Go Gateway。
- 请求取消、流式响应和错误映射。
- API Host 约束。
- 完整转换集成测试。

退出标准：

- 生产转换流量不再经过 Nginx 或 Node Request Policy。
- 转换成功与失败路径均通过真实镜像验证。

### 阶段 4：迁移短链路由

交付：

- Go Short Link Adapter。
- APP 创建接口。
- APP/SHORT 短码解析。
- Turnstile challenge 和错误合同。
- MyUrls/Redis 重启恢复测试。

退出标准：

- 前端仅通过 Go Gateway 使用 MyUrls。
- MyUrls 管理/API 路径不对 SHORT 域公开。
- Redis 现有短链数据无需迁移即可解析。

### 阶段 5：加入功能开关

交付：

- `SHORT_LINKS_ENABLED`。
- `CUSTOM_BACKEND_ENABLED`。
- Compose profiles 或等价服务选择。
- 前端运行时配置。
- 配置条件和组合测试。

退出标准：

- 短链关闭时只有 Gateway 与 SubConverter 运行。
- 自定义后端关闭时 UI 和后端均拒绝该能力。
- 安全能力不存在关闭路径。

### 阶段 6：切换唯一生产 Compose

交付：

- 新 `compose.yaml` 成为唯一生产合同。
- 删除 simple/hardened 双生产语义。
- 旧拓扑保留为有期限的迁移文件或 release tag，不继续扩展。
- 更新部署、配置、安全和运维文档。

退出标准：

- 默认 Compose 完整覆盖公网生产安全需求。
- 所有 CI、release 和本地预检只验证同一生产合同及其功能组合。

### 阶段 7：部署入口与发布

交付：

- 单一安装/运维 CLI。
- 镜像发布。
- 版本锁。
- 升级 preflight。
- 回滚流程。
- 生产部署 runbook。

退出标准：

- 干净主机可以按文档完成部署。
- 升级失败可以恢复到上一组完整合同和 Redis 数据。
- 发布预检出现明确成功标记。

## 19. 回滚策略

- 每个迁移阶段保持可单独回退的 commit。
- Go Gateway 完成全部合同前，不删除旧 Nginx/Node 实现。
- 切换生产流量前保留上一版完整镜像集合和 Compose 文件。
- 回滚使用完整 release manifest，不逐个猜测镜像版本。
- MyUrls 跨 Rust/Node HTTP 合同时必须同步回退 Gateway、前端和镜像。
- Redis schema 或 TTL 策略变更前必须备份并验证恢复。
- 发布元数据中的 runtime image rollback 列表由版本锁生成。

## 20. 风险与缓解

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| Go egress 实现出现 SSRF 或 DNS rebinding 回归 | 高 | 差分测试、恶意 DNS 集成测试、按验证 IP 建连、独立安全审查。 |
| 重写范围过大导致长期双实现 | 高 | 分阶段迁移，每阶段有退出标准；先代理和安全合同，后删除旧实现。 |
| 功能开关形成组合爆炸 | 中 | 首个版本只保留 2 个业务开关；安全控制不可配置关闭。 |
| 单实例内存限流重启后重置 | 中 | 明确单实例合同；短链开启时使用 Redis；水平扩展时再统一外部限流存储。 |
| 上游镜像合同变化 | 高 | 版本锁、digest、真实镜像集成测试和升级 preflight。 |
| Go 与 Vue 构建增加双工具链 | 中 | 使用多阶段 Docker 构建和统一验证命令；不引入额外全栈框架。 |
| 外部反向代理配置错误 | 高 | 提供最小模板、可信代理 CIDR 校验和部署 smoke test。 |
| 旧 Redis 数据回滚失败 | 高 | 升级前备份、临时恢复验证、禁止未经验证的数据迁移。 |

## 21. 发布门禁

禁止发布的条件：

- Go、Vue、Compose、容器或文档验证任一失败。
- 未观察到 `release verification=passed`。
- 生产 Compose 缺少 Gateway、SubConverter 或启用功能所需服务。
- 镜像引用未锁定或与版本锁不一致。
- 安全扫描存在未处理高危/严重漏洞，且没有经过范围限定的审计例外。
- Redis 备份恢复未通过。
- 功能开关组合未通过集成测试。
- 日志出现秘密、完整订阅 URL、短码或 token。
- 生产容器需要 root、可写根文件系统或额外 capability，且没有已批准说明。

## 22. 文档交付物

实施时必须同步维护：

- `README.md`：产品定位和快速开始。
- `docs/architecture.md`：最终运行架构。
- `docs/configuration.md`：环境变量和开关。
- `docs/deployment-docker.md`：生产部署。
- `docs/deployment-local.md`：本地开发。
- `docs/security.md`：威胁模型和不可关闭控制。
- `docs/operations.md`：日志、备份、恢复和升级。
- `docs/maintenance.md`：版本锁、发布和回滚。
- `deploy/versions.lock.json`：全部生产镜像来源和 digest。
- 逐阶段实现计划：精确到文件、测试、命令和 commit。

## 23. 验收场景

### 场景 A：公网完整部署

给定短链和自定义后端均开启，部署成功后：

- APP 域加载 Vue 页面。
- API 域完成可信公网订阅转换。
- APP 域创建短链。
- SHORT 域完成短码跳转。
- 私网订阅 URL 被拒绝。
- 超大响应被中止。
- Redis、MyUrls 和 SubConverter 不暴露宿主机端口。

### 场景 B：关闭短链

给定 `SHORT_LINKS_ENABLED=false`：

- 只启动 Gateway 和 SubConverter。
- 不要求 Redis 和 Turnstile 配置。
- 页面不显示短链操作。
- `/short-api/links` 返回 404。
- SHORT 域业务路径返回 404。
- 转换功能保持可用。

### 场景 C：关闭自定义后端

给定 `CUSTOM_BACKEND_ENABLED=false`：

- 页面不显示自定义 API 控件。
- 正常转换使用部署者配置的 API URL。
- 修改前端请求或直接调用接口不能提交自定义后端。
- SSRF 和 egress 策略保持启用。

### 场景 D：依赖恢复

依次重启 Gateway、SubConverter、MyUrls 和 Redis：

- 健康检查在依赖不可用时准确失败。
- 依赖恢复后 readiness 恢复。
- 已创建短链仍可解析。
- 新的转换和短链创建恢复。
- 日志中没有秘密或原始订阅 URL。

### 场景 E：升级失败回滚

给定新 Gateway 镜像未通过 readiness：

- 部署入口停止升级。
- 不删除 Redis 数据卷。
- 使用上一 release manifest 恢复完整镜像集合。
- APP、API 和 SHORT 路径恢复。
- 回滚结果通过业务 smoke test。

## 24. 最终决策摘要

本 PRD 固定以下决策：

1. 产品面向公网生产，不再以不安全的简化模式作为默认合同。
2. 「一个命令部署」由单一入口和 Docker Compose 实现，不采用单容器多进程方案。
3. TLS、证书和 DNS 继续外置。
4. 前端保持 Vue 3 + Vite 静态 SPA。
5. 项目自有 Gateway 与 Request Policy 重写为 Go 1.25 单二进制。
6. SubConverter-Extended、MyUrls 和 Redis 保持独立上游镜像。
7. 短链和自定义后端是仅有的首批业务功能开关。
8. 所有安全控制保持强制开启。
9. 短链开启时运行 4 个容器，关闭时运行 2 个容器。
10. 迁移采用并行验证、阶段切换和完整 release manifest 回滚，不进行一次性替换。
