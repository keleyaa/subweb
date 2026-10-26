# Subweb 架构与产品合同

> 状态：已实现并通过发布预检。本文描述当前受支持的运行合同，不包含待执行步骤。

## 1. 产品范围

Subweb 是面向自托管环境的订阅转换与短链服务。项目自有 Go Gateway 统一处理公网 Host 路由、静态资源、转换策略、匿名限流、内嵌短链存储和受控 HTTPS CONNECT egress。前端是 Vue 3 + Vite 静态 SPA；只有 SubConverter 使用独立容器，短链数据保存在 Gateway 独占的 SQLite 卷中。

TLS、证书和公网 DNS 由部署者已有的外部反向代理负责。Subweb 只接收外部代理转发到 loopback 的 HTTP 流量，并根据可信代理配置重建客户端身份。

## 2. 生产部署合同

### 2.1 短链开启

`compose.yaml` 是唯一的短链开启生产 Compose 文件，准确运行两个服务：

| 服务 | 职责 |
| --- | --- |
| `gateway` | 唯一公开 loopback 端口；Host 路由、静态资源、转换策略、限流、内嵌短链存储和 egress |
| `subconverter` | 执行订阅转换；只能通过内部 CONNECT egress 访问外部订阅 |

只有 Gateway 发布宿主机端口，而且端口必须绑定 `127.0.0.1`。SubConverter 不发布宿主机端口。

### 2.2 短链关闭

`SHORT_LINKS_ENABLED=false` 时，部署入口选择 `compose.disabled-short-links.yaml`，只运行：

- `gateway`
- `subconverter`

该 profile 不要求 `SHORT_DOMAIN`、短链数据库或 Turnstile 私钥。Gateway 使用单实例内存限流；该 profile 不承诺多 Gateway 实例之间共享限流状态。

### 2.3 网络边界

生产 Compose 使用以下网络：

- `default`：Gateway 的 loopback 发布端口与容器入口。
- `subconverter-egress`：Gateway egress listener 与 SubConverter 之间的受控网络，标记为 internal。

SubConverter 不加入默认网络；外部订阅连接只能经 Gateway 的 CONNECT listener 建立。短链数据不使用网络，而是 Gateway 独占的 `links-data` 命名卷。

## 3. 公网入口和路由

外部 TLS 反向代理将以下域名转发到 Gateway 的 loopback 端口，并保留原始 Host：

| 域名 | 主要路由 |
| --- | --- |
| `APP_DOMAIN` | Vue 页面、`/short-api/links` 和短链管理请求 |
| `API_DOMAIN` | `/sub` 转换接口、健康检查和 API 资源 |
| `SHORT_DOMAIN` | 短码解析和跳转 |

短链开启时，APP 创建与 APP/SHORT 解析都由 Gateway 直接处理，映射写入内嵌 SQLite 数据库。Gateway 不向 SHORT 域公开 APP 管理接口。

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

## 5. 短链实现

短链由 Gateway 内嵌实现，对外合同保持与既有 `/api/links` 兼容：

- APP `POST /short-api/links` 创建短链，返回 `{ code, shortUrl, expiresAt }`。
- APP 和 SHORT 的短码路径返回 `302` 与 `Location`；未知或过期返回 `404`。
- 短码为 4–32 位 `[A-Za-z0-9_-]`；自定义 alias 冲突返回 `409 alias_unavailable`。
- 短链映射与到期时间写入 `links-data` 卷中的 SQLite 数据库（`/data/links.db`，WAL 模式）。
- 错误信封只保留白名单错误码、`requestId`、`retryAfterSeconds` 和 `challenge` 元数据。
- 创建需要 Turnstile 校验（`TURNSTILE_ENABLED=true` 时）与每 IP 限流；解析只有限流。

Turnstile siteverify 经 Gateway 的受限 `:25503` CONNECT 监听访问 `EGRESS_ALLOWED_HOSTS`（默认 `challenges.cloudflare.com`），未列出的目标在 DNS 解析前被拒绝。创建返回地址固定为 `https://${SHORT_DOMAIN}/<code>`，hostname 校验固定使用 `APP_DOMAIN`。

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
| `SUBCONVERTER_IMAGE` | 由 `deploy/versions.lock.json` 锁定的 SubConverter 镜像 |
| `SHORT_LINK_DB_PATH` | Gateway 内嵌短链数据库路径，默认 `/data/links.db` |
| `SHORT_LINK_TTL_SECONDS` | 短链有效期，默认 90 天 |
| `TURNSTILE_ENABLED` | 是否要求 Turnstile 校验；本地开发可关闭 |

`SHORT_LINKS_ENABLED` 和 `CUSTOM_BACKEND_ENABLED` 只控制业务能力。SSRF、DNS 校验、限流、超时、请求大小、网络隔离、日志脱敏和容器收紧控制没有关闭路径。

浏览器配置通过不含秘密的 `/conf/config.js` 暴露，同时兼容 `window.__SUBWEB_CONFIG__` 和 legacy `window.config`。消费端会再次归一化配置，以覆盖模块初始化早于入口脚本的场景。

## 7. 安全和隐私合同

- 只允许 HTTPS 外部目标；HTTP 目标仅允许 loopback。
- 拒绝完整相关的 IANA 特殊用途地址范围、DNS rebinding、scoped IPv6、userinfo、非法端口和非 `:443` CONNECT。
- DNS 只解析一次，授权凭据一次性使用并短 TTL 过期。
- 请求体上限为 `16 KiB`；上游响应超过配置上限时返回 `response_too_large`。
- 请求总超时、DNS 超时、CONNECT 超时、并发和限流均有有限上限，并正确传播取消。
- Gateway 与 SubConverter 使用只读根文件系统、最小权限和受限网络；SubConverter 只在初始化阶段使用明确的 root bootstrap，随后以非 root 用户运行并清除有效 capability。
- 日志不记录原始订阅 URL、完整 query、Authorization、Cookie、数据库密钥或完整客户端 IP。
- 短链是持有即可访问的数据；用户应按公开资源处理短链。

## 8. 本地开发和运维

本地开发使用 `compose.yaml` 与 `compose.dev.yaml`，配置写入 `.runtime/local/compose.env`，服务名与生产保持一致。开发覆盖关闭 Turnstile，并且只由 Gateway 发布 loopback 端口。

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
./scripts/subweb.sh backup --output /absolute/path/backup.db
./scripts/subweb.sh restore --backup /absolute/path/backup.db --confirm-stop-writes
./scripts/subweb.sh upgrade
./scripts/subweb.sh down
```

恢复只接受短链开启 profile、绝对路径普通 SQLite 备份文件和明确的停止写入确认。恢复流程通过 Gateway 的 `--restore-links` 子命令原子替换数据库并校验行数，然后重新启动并等待健康检查。

## 9. 验证和发布

当前支持的验证入口：

```sh
npm run verify
npm run verify:ci
npm run verify:local
npm run verify:integration
npm run verify:production-readiness
npm run verify:compose
npm run verify:locks
npm run verify:docs
npm run verify:evidence
npm run verify:release
```

`verify:release` 会运行浏览器、真实两服务 smoke、两服务 profile、短链持久化与过期、锁定镜像扫描和 evidence 检查。Go race、Go vet、构建和 `git diff --check` 是需要另行执行或由 CI job 覆盖的独立检查；只有明确输出 `release verification=passed` 才能记录 release verifier 成功。

## 10. 发布、证据和回滚

`deploy/versions.lock.json` 记录外部运行时依赖的来源、版本、平台 digest 和端口。Gateway release workflow 通过手动输入已有 Git tag 从该 tag 检出源码并构建，随后以该 tag 和 digest 发布；workflow 扫描 Gateway 与 SubConverter，并从版本锁生成外部 runtime rollback manifest。

回滚使用上一 release manifest 中的完整镜像集合与对应配置，不逐项猜测版本。短链数据库 schema 变化必须由 Gateway 迁移并保持向后兼容；`links-data` 卷在升级失败时保留，并通过备份/恢复演练验证可用。

## 11. 验收结果

当前实现已验证以下场景：

- 两服务生产 profile 的 APP/API/SHORT Host 路由、静态/PWA MIME、转换和短链创建/解析。
- 私网目标、DNS 失败、超时、响应过大、限流、并发和依赖请求头清理。
- Gateway 重启后的短链持久化恢复。
- 两服务短链关闭 profile 的启动、转换、功能开关和资源缺失行为。
- 本地四依赖 Compose-first 生命周期、Vite `/short-api` 代理和 SHORT loopback `302`。
- 锁、Compose 网络/权限、文档、证据、镜像安全和 release preflight 合同。

本文、`docs/architecture.md`、`docs/configuration.md`、部署/运维/安全文档、`README.md`、Compose 文件、版本锁和验证脚本共同构成当前合同；出现冲突时，以可执行验证脚本与生产 Compose 为准。
