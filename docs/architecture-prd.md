# Subweb 架构与产品合同

> 状态：已实现并通过发布预检。本文描述当前受支持的运行合同，不包含待执行步骤。

## 1. 产品范围

Subweb 是面向自托管环境的订阅转换与短链服务。项目自有 Go Gateway 统一处理公网 Host 路由、静态资源、转换策略、匿名限流、MyUrls 适配和受控 HTTPS CONNECT egress。前端是 Vue 3 + Vite 静态 SPA；SubConverter、MyUrls Rust v2 和 Redis 使用独立容器。

TLS、证书和公网 DNS 由部署者已有的外部反向代理负责。Subweb 只接收外部代理转发到 loopback 的 HTTP 流量，并根据可信代理配置重建客户端身份。

## 2. 生产部署合同

### 2.1 短链开启

`compose.yaml` 是唯一的短链开启生产 Compose 文件，准确运行五个服务：

| 服务 | 职责 |
| --- | --- |
| `gateway` | 唯一公开 loopback 端口；Host 路由、静态资源、转换策略、限流、MyUrls 适配和 egress |
| `subconverter` | 执行订阅转换；只能通过内部 CONNECT egress 访问外部订阅 |
| `myurls-app` | APP 域名的短链创建和管理 API |
| `myurls-short` | SHORT 域名的短码解析和跳转 |
| `redis` | DB `0` 保存 MyUrls 数据，DB `1` 保存 Gateway IP 限流状态 |

只有 Gateway 发布宿主机端口，而且端口必须绑定 `127.0.0.1`。MyUrls、Redis 和 SubConverter 不发布宿主机端口。

### 2.2 短链关闭

`SHORT_LINKS_ENABLED=false` 时，部署入口选择 `compose.disabled-short-links.yaml`，只运行：

- `gateway`
- `subconverter`

该 profile 不要求 `SHORT_DOMAIN`、Redis、MyUrls 或 Turnstile 私钥。Gateway 使用单实例内存限流；该 profile 不承诺多 Gateway 实例之间共享限流状态。

### 2.3 网络边界

生产 Compose 使用以下内部网络：

- `myurls-data`：Redis 与两个 MyUrls 实例之间的数据网络。
- `myurls-edge`：Gateway 与两个 MyUrls 实例之间的 HTTP 边界。
- `redis-policy`：Gateway 与 Redis 限流 DB 之间的边界。
- `subconverter-egress`：Gateway egress listener 与 SubConverter 之间的受控网络，标记为 internal。

Gateway 不加入 `myurls-data`；SubConverter 不加入 MyUrls 或 Redis 网络；外部订阅连接只能经 Gateway 的 CONNECT listener 建立。

## 3. 公网入口和路由

外部 TLS 反向代理将以下域名转发到 Gateway 的 loopback 端口，并保留原始 Host：

| 域名 | 主要路由 |
| --- | --- |
| `APP_DOMAIN` | Vue 页面、`/short-api/links` 和短链管理请求 |
| `API_DOMAIN` | `/sub` 转换接口、健康检查和 API 资源 |
| `SHORT_DOMAIN` | 短码解析和跳转 |

短链开启时，APP 创建请求只访问 `myurls-app`，SHORT 解析请求只访问 `myurls-short`。Gateway 不向 SHORT 域公开 APP 管理接口。

Gateway 静态资源只服务文件和明确的 PWA/crawler 路径；缺少扩展名的页面请求才允许受限 SPA fallback。目录、路径遍历、未知资源和错误 Host 不会被 fallback 掩盖。

## 4. 转换流程

1. Gateway 验证请求方法、Host、请求体大小和客户端取消。
2. Gateway 对目标 URL 执行 scheme、userinfo、端口、DNS、特殊地址和公网单播策略检查。
3. Gateway 获取匿名 IP 限流额度和并发额度，并应用总请求超时。
4. Gateway 通过一次性授权凭据把已验证地址绑定到内部 egress CONNECT 请求。
5. egress proxy 重新验证 CONNECT 目标，只允许 `:443`，使用已验证 IP 直接拨号。
6. Gateway 清除客户端凭据、Cookie、Origin 和转发身份头，再向 SubConverter 转发。
7. Gateway 对响应执行有限缓冲和 `max+1` 大小检查，并映射稳定的 problem-details 错误合同。

Gateway 依赖响应采用完整缓冲，不支持流式传输、协议升级或 WebSocket 等可选 `ResponseWriter` 能力。

## 5. MyUrls 适配

Go Gateway 是前端与 MyUrls 之间的唯一适配边界：

- APP `POST /short-api/links` 映射到 MyUrls `/api/links`。
- APP 和 SHORT 的短码路径映射到允许的解析接口。
- 请求只转发 Gateway 重建的 `X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host`、`X-Real-IP` 和有效 request ID。
- 客户端 Authorization、Proxy-Authorization、Cookie、Origin 和任意未经允许的转发头不会跨越依赖边界。
- RFC 9457 problem details 只保留白名单错误、`requestId`、`retryAfterSeconds` 和 `challenge` 元数据。
- MyUrls 客户端禁用上游重定向，只接受 HTTP(S) 解析结果，并使用 10 秒总超时。

两个 MyUrls 实例共享同一个锁定的 Rust v2 镜像，但分别使用 APP 和 SHORT 的 `PUBLIC_BASE_URL`、Turnstile hostname 与路由职责。

## 6. 配置和功能开关

生产配置由 `scripts/configure.sh` 原子写入根目录 `.env`，权限为 `0600`。部署入口 `scripts/subweb.sh` 根据 `SHORT_LINKS_ENABLED` 选择 Compose 文件。

| 变量 | 合同 |
| --- | --- |
| `APP_DOMAIN` | APP 公网域名；短链关闭时仍必需 |
| `API_DOMAIN` | API 公网域名；短链关闭时仍必需 |
| `SHORT_DOMAIN` | SHORT 公网域名；仅短链开启时必需 |
| `API_URL` | HTTPS URL，或仅指向 loopback 的 HTTP URL |
| `SHORT_LINKS_ENABLED` | 只接受 `true` 或 `false`，默认 `true` |
| `CUSTOM_BACKEND_ENABLED` | 只接受 `true` 或 `false`，默认 `true` |
| `SUBWEB_PORT` | Gateway loopback 端口，范围 `1-65535` |
| `TRUSTED_PROXY_CIDR` | 外部 TLS 代理的准确来源 CIDR；不可信时留空 |
| `MYURLS_IMAGE` | 由 `deploy/versions.lock.json` 锁定的 MyUrls Rust v2 镜像 |
| `SUBCONVERTER_IMAGE` | 由版本锁定的 SubConverter 镜像 |
| `REDIS_IMAGE` | 由版本锁定的 Redis 镜像 |

`SHORT_LINKS_ENABLED` 和 `CUSTOM_BACKEND_ENABLED` 只控制业务能力。SSRF、DNS 校验、限流、超时、请求大小、网络隔离、日志脱敏和容器收紧控制没有关闭路径。

浏览器配置通过不含秘密的 `/conf/config.js` 暴露，同时兼容 `window.__SUBWEB_CONFIG__` 和 legacy `window.config`。消费端会再次归一化配置，以覆盖模块初始化早于入口脚本的场景。

## 7. 安全和隐私合同

- 只允许 HTTPS 外部目标；HTTP 目标仅允许 loopback。
- 拒绝完整相关的 IANA 特殊用途地址范围、DNS rebinding、scoped IPv6、userinfo、非法端口和非 `:443` CONNECT。
- DNS 只解析一次，授权凭据一次性使用并短 TTL 过期。
- 请求体上限为 `16 KiB`；上游响应超过配置上限时返回 `response_too_large`。
- 请求总超时、DNS 超时、CONNECT 超时、并发和限流均有有限上限，并正确传播取消。
- Gateway、MyUrls、Redis 和 SubConverter 使用只读根文件系统、最小权限和受限网络；SubConverter 只在初始化阶段使用明确的 root bootstrap，运行时切换到 UID `101` 且清除有效 capability。
- 日志不记录原始订阅 URL、完整 query、Authorization、Cookie、Redis 密码或完整客户端 IP。
- 短链是持有即可访问的数据；用户应按公开资源处理短链。

## 8. 本地开发和运维

本地开发使用 `compose.yaml` 与 `compose.dev.yaml`，配置写入 `.runtime/local/compose.env`，服务名与生产保持一致。开发覆盖关闭 MyUrls Turnstile，并将 Gateway 与 SHORT 端口只绑定到 loopback。

```sh
npm ci
npm run dev
npm run dev:status
npm run dev:stop
npm run verify:local
```

生产运维入口：

```sh
./scripts/subweb.sh verify
./scripts/subweb.sh up
./scripts/subweb.sh status
./scripts/subweb.sh logs gateway
./scripts/subweb.sh backup --output /absolute/path/backup.rdb
./scripts/subweb.sh restore --backup /absolute/path/backup.rdb --confirm-stop-writes
./scripts/subweb.sh upgrade
./scripts/subweb.sh down
```

恢复只接受短链开启 profile、绝对路径普通备份文件和明确的停止写入确认。恢复流程保留现有 RDB，使用锁定镜像启动隔离栈，并验证 Redis、Gateway、SubConverter 与两个 MyUrls 实例的恢复。

## 9. 验证和发布

当前支持的验证入口：

```sh
npm run verify
npm run verify:ci
npm run verify:local
npm run verify:integration
npm run verify:operations
npm run verify:compose
npm run verify:locks
npm run verify:docs
npm run verify:evidence
npm run verify:release
```

`verify:release` 会运行浏览器、真实五服务 smoke、两服务 profile、测试 fixture、Redis backup/restore、锁定镜像扫描和 evidence 检查。Go race、Go vet、构建和 `git diff --check` 是需要另行执行或由 CI job 覆盖的独立检查；只有明确输出 `release verification=passed` 才能记录 release verifier 成功。

## 10. 发布、证据和回滚

`deploy/versions.lock.json` 记录外部运行时依赖的来源、版本、平台 digest 和端口。Gateway 由 release workflow 从当前源码构建并发布为不可变 `sha-*` 引用；workflow 扫描 Gateway、MyUrls、Redis 和 SubConverter，并从版本锁生成外部 runtime rollback manifest。

回滚使用上一 release manifest 中的完整镜像集合与对应配置，不逐项猜测版本。若 MyUrls HTTP 合同发生变化，回滚必须同时恢复 Gateway 路由、前端适配和 MyUrls 镜像。Redis 数据卷在升级失败时保留，并通过恢复演练验证可用。

## 11. 验收结果

当前实现已验证以下场景：

- 五服务生产 profile 的 APP/API/SHORT Host 路由、静态/PWA MIME、转换和短链创建/解析。
- 私网目标、DNS 失败、超时、响应过大、限流、并发和依赖请求头清理。
- Gateway、SubConverter、两个 MyUrls 实例和 Redis 的独立重启恢复。
- 两服务短链关闭 profile 的启动、转换、功能开关和资源缺失行为。
- 本地五依赖 Compose-first 生命周期、Vite `/short-api` 代理和 SHORT loopback `302`。
- 锁、Compose 网络/权限、文档、证据、镜像安全和 release preflight 合同。

本文、`docs/architecture.md`、`docs/configuration.md`、部署/运维/安全文档、`README.md`、Compose 文件、版本锁和验证脚本共同构成当前合同；出现冲突时，以可执行验证脚本与生产 Compose 为准。
