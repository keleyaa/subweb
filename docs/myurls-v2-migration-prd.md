# Subweb 与 MyUrls v2 集成重整 PRD

状态：Implementation complete; production cutover blocked by D2
基线日期：2026-08-28
适用仓库：Subweb `faa2434`、MyUrls `9494ae3`

## 1. 背景与结论

MyUrls 已使用 TypeScript、Fastify、Svelte 和 Redis 完成 v2 重构。Subweb 当前仍完整依赖
MyUrls v1 的运行参数、HTTP 接口、静态资源路径、Redis 键结构和本地 Go 构建流程，因此本次工作
不是普通依赖升级，而是一次需要数据决策和回滚能力的跨项目契约迁移。

本次实施已核实 MyUrls v2 的 GHCR multi-platform manifest，并将 Subweb 生产 Compose 固定到
`v2.0.2@sha256:b76423a5b5f346c27c40cbecb3954409f645f85df462d49577bb14d738d6127b`。
该版本由上游稳定 Git tag `v2.0.2` 发布，tag 指向源码 commit
`c86c5d6d7d85eb1c02bfdef73dff489e8a547395`，并已核验 amd64/arm64 manifest digest。

## 2. 目标

1. 完成 Subweb 对 MyUrls v2 运行配置、API、页面资源和 Redis 数据模型的完整适配。
2. 保持“生成并复制转换链接”和“生成并复制短链”的核心工作流。
3. 为历史短链提供明确的数据盘点、迁移、验证和回滚方案，禁止静默丢失。
4. 使用不可变镜像 digest 和跨项目契约测试，防止上游 `latest` 再次造成无感破坏。
5. 收敛前端模块职责和本地开发流程，删除只服务于 MyUrls v1 的代码与依赖。

## 3. 非目标

- 不将反向代理、TLS 或域名管理移入 MyUrls 运行时。
- 不增加账号、统计、管理后台或新的商业功能。
- 不重写 SubConverter，也不改变其现有转换协议。
- 不在本次迁移中全面重写 Vue 或强制全项目切换 TypeScript。
- 不在未完成数据盘点和备份验证前修改生产 Redis 数据。

## 4. 当前事实与差距（已完成项的基线）

| 级别 | 当前实现 | MyUrls v2 要求 | 影响 |
| --- | --- | --- | --- |
| P0 | MyUrls 监听 `8080`，使用旧 `MYURLS_*` 参数 | 监听 `3000`，使用 `PUBLIC_BASE_URL`、`REDIS_URL`、`IP_HASH_SECRET`、Turnstile 等参数 | 容器无法按现有配置正常启动 |
| P0 | `POST /short`，表单字段 `longUrl`，客户端 Base64 编码 | `POST /api/v1/links`，JSON `{url, alias?, challengeToken?}` | 短链创建完全不兼容 |
| P0 | 成功响应为 HTTP 200 和 `{Code, ShortUrl}` | 成功响应为 HTTP 201 和 `{code, shortUrl, expiresAt}` | 前端会把成功响应判定为失败 |
| P0 | Gateway 注入 Bearer Token | v2 使用按风险触发的 Turnstile | 旧鉴权和测试均失效 |
| P0 | 裸 Redis key、365 天 TTL | `myurl:link:{code}`、90 天 TTL | 直接切换会让历史短链返回 404 |
| P0 | 未为 MyUrls 精确定义可信代理 | 仅信任 `TRUST_PROXY_CIDRS` 中的代理 | 所有用户可能被识别为 Gateway IP |
| P1 | SHORT 域只显式放行 `/app.js`、`/styles.css`、`/fonts/` | v2 使用 Vite 哈希资源 `/assets/*` | MyUrls 页面资源无法加载 |
| P1 | 本地脚本使用 Go 编译 MyUrls 并探测 `/healthz` | v2 是 Node 应用，健康端点为 `/health/live` 和 `/health/ready` | 本地联调流程失效 |
| P2 | `SubTable.vue` 同时承担 UI、URL 构造、网络、状态和复制 | 远程依赖应通过稳定客户端边界接入 | 修改风险和测试耦合较高 |

实施后的本地门禁为 `npm test` 292 项通过、3 项跳过，`npm run lint`、`npm run build`、文档、证据和锁校验均通过；
真实 Docker 集成脚本覆盖两个实例的健康检查、v2 201、挑战重试、资源、302、Redis 重启和隐私扫描；Redis 运维覆盖盘点、迁移、RDB 校验和恢复。

## 5. 目标架构

```text
Browser
  |-- APP_DOMAIN
  |     `-- Gateway
  |           |-- /sub?...                  --> SubConverter
  |           `-- /short-api/v1/links       --> MyUrls v2 (APP instance) --> Redis
  |
  `-- SHORT_DOMAIN
        `-- Gateway transparent proxy       --> MyUrls v2 (SHORT instance) UI/API/redirect
```

### 5.1 APP 域短链适配入口

- 浏览器只请求同源的 `POST /short-api/v1/links`，不再依赖公开 `SHORT_URL` 运行时配置。
- Gateway 只允许 JSON 和 POST，限制请求体，校验 Origin 必须等于 APP origin。
- Gateway 清理浏览器 Origin 后，将请求和响应主体原样转发到 MyUrls `/api/v1/links`。
- Gateway 不注入 Bearer Token，不改写 MyUrls 稳定错误码、挑战信息或 `expiresAt`。
- 该入口不接受通配路径，防止成为任意 MyUrls API 代理。

### 5.2 SHORT 域透明代理

- 透明转发 MyUrls 首页、`/assets/*`、`/api/v1/links`、健康端点和短码跳转。
- 不维护静态资源白名单，不复制 MyUrls 路由表。
- MyUrls 负责自身 CSP、Turnstile 和响应安全头；APP 与 SHORT 使用独立实例分别校验 hostname，
  两个实例共用 Redis、IP 哈希密钥和镜像版本；Gateway 只负责入口、TLS 和转发头清理。

### 5.3 前端模块边界

- `ConversionLink`：纯函数模块，负责转换 URL 构建、规范化和 4096 字节预检。
- `ShortLinkClient`：负责 v2 HTTP 请求、响应解析、超时、稳定错误码和挑战协议。
- `ConversionWorkflow`：负责生成、挑战、重试、复制和 stale-result 状态流转。
- Vue 组件只渲染状态和派发用户动作，不直接理解 MyUrls HTTP 细节。

## 6. 产品与技术需求

### FR-1 短链创建

- 正常创建成功后立即显示并复制 `shortUrl`，同时保存 `expiresAt`。
- URL 必须在请求前按 UTF-8 字节数验证，超过 4096 字节时显示可操作的行内错误。
- 不再使用 Base64、`URLSearchParams` 或旧 `{Code, ShortUrl}` 兼容逻辑。

### FR-2 渐进式 Turnstile

- 首次请求不加载 Cloudflare 脚本。
- 收到 `challenge_required` 后才显示验证控件。
- 验证成功后使用同一 conversion key 和 `challengeToken` 自动重试。
- 输入发生变化时作废旧挑战和旧响应，防止过期结果覆盖新输入。

### FR-3 真实客户端 IP

- 为 Gateway 到 MyUrls 建立独立内部网络边界，并通过 edge-only service alias 只信任实际 Gateway 来源 CIDR。
- Gateway 必须覆盖而不是追加外部 `X-Forwarded-For` 和 `Forwarded`。
- 禁止 `0.0.0.0/0`、`::/0` 或与外部 `TRUSTED_PROXY_CIDR` 概念混用。

### FR-4 配置与秘密

- `scripts/configure.sh` 生成独立且不少于 32 字节的 `IP_HASH_SECRET`。
- 部署必须显式提供 Turnstile site key 和 secret key；生产的 APP/SHORT hostname 由 Compose 从对应域名注入，缺失凭据时失败关闭。
- 不复用旧 `MYURLS_API_TOKEN` 作为 IP 哈希密钥。
- 日志和诊断输出不得包含长 URL、短码、Turnstile token、Redis 密码或 IP 哈希密钥。

### FR-5 发布可复现性

- 生产默认使用 MyUrls semver 加 manifest digest，禁止使用 `latest`。
- `deploy/versions.lock.json` 记录实际通过集成测试的 commit、镜像版本和 digest。
- MyUrls 发布后触发 Subweb 固定版本兼容测试，通过后再提交版本更新 PR。

## 7. 历史数据迁移决策门

发布 v2 前必须完成只读 Redis 盘点：旧裸 key 数量、新命名空间 key 数量、TTL 分布和命名冲突
数量。盘点输出只能包含聚合统计，不能输出 key 或 value。

默认建议采用一次性、离线、幂等迁移：

1. 停止写入口并生成 RDB 备份。
2. 在隔离 Redis 中验证备份可加载，并记录 checksum 和 key 数量。
3. 扫描合法旧裸 key，以 `NX` 复制为 `myurl:link:{code}`。
4. 冲突只记录数量并使迁移失败，不覆盖现有 v2 key。
5. 不删除旧 key；完成抽样跳转和 TTL 验证后再切换流量。

旧链接 TTL 已确定采用以下策略：

- 迁移 TTL 使用 `min(旧剩余 TTL, 90 天)`，作为统一策略；新链接仍固定 90 天。
- 旧 key 不删除；已过期或无 TTL 的 key 不迁移，并在盘点/迁移结果中计数。

若确认历史短链可全部放弃，应使用新的 v2 数据卷并明确记录破坏性切换，不允许复用旧卷后让
历史链接静默返回 404。

## 8. 实施计划

| 批次 | 范围 | 主要完成信号 |
| --- | --- | --- |
| PR0 紧急冻结 | 将 MyUrls 固定到已验证的 v1.13.0 digest，停止自动使用 `latest` | 新部署不会意外拉取 v2 |
| PR1 运行与网关 | Compose、v2 环境变量、3000 端口、健康检查、APP 适配入口、SHORT 透明代理、可信代理 | 固定 v2 镜像后全栈健康 |
| PR2 前端工作流 | `ShortLinkClient`、JSON API、Turnstile、错误状态、长度预检、复制反馈 | 正常、挑战、限流和失败路径均可操作 |
| PR3 数据与运维 | 盘点、迁移工具、备份恢复、抽样跳转、回滚演练、隐私哨兵 | 历史链接策略可验证且可回滚 |
| PR4 清理与发布 | 删除 v1 Token、旧路由、Go 本地工作流和过时测试；精简依赖、更新文档和版本锁 | 仓库无 v1 契约残留并通过完整门禁 |

各 PR 必须保持单一迁移目的，PR0 可以独立发布；PR1 至 PR3 未全部验收前不得移除 v1 回滚能力。

## 9. 测试与验收

### 9.1 发布阻断门禁

- 全新目录使用固定 digest 执行 `docker compose up -d --wait` 成功。
- `/health/live` 验证进程存活，`/health/ready` 验证 Redis 可用。
- APP 同源创建返回 201、`code`、`shortUrl` 和 `expiresAt`，并自动复制。
- 非 JSON、超限、错误 Origin、非法 URL 和未知字段返回对应稳定错误码。
- `challenge_required` 触发控件，验证后自动重试；token 不进入日志。
- 两个不同客户端 IP 进入不同限流桶，伪造转发头不能改变客户端身份。
- SHORT 域页面、哈希静态资源、API 和 302 跳转均可访问。
- 迁移后的随机抽样旧短码可跳转，TTL 符合已批准策略。
- 备份能在隔离实例中加载；恢复失败时能够回到操作前快照。

### 9.2 测试结构调整

- 使用 `ShortLinkClient` fake 测试前端状态，不在组件测试里重复伪造 Axios v1 响应。
- 使用真实 Nginx 和 fake v2 upstream 验证 JSON、Origin、转发头及静态资源路径。
- 使用固定 MyUrls v2 digest 执行 Compose 集成测试和 Redis 备份恢复测试。
- 保留现有移动端、无障碍、主题、剪贴板和 stale-result Playwright 覆盖。
- 删除仅通过读取源码并匹配 v1 字符串的测试；静态安全事实无法低成本行为验证时除外。

### 9.3 P2 优化指标

- 评估并移除仅用于少量能力的 Element Plus、Axios、Vuex 和 Vue Router。
- 不为减少文件长度拆出无行为的透传组件。
- 当前构建总 JS gzip 约 83 kB；优化目标为不高于 65 kB，未达成时必须提供 bundle 分析和
  保留依赖的理由。该指标不是 v2 发布的 P0 阻断项。

## 10. 回滚方案

1. PR0 保留已验证的 v1.13.0 digest、旧 Compose 配置和旧 Redis 数据。
2. 数据迁移前保留 checksum 已验证的 RDB；迁移只复制，不删除或覆盖旧 key。
3. 切换失败时停止 Gateway 和 MyUrls 写入口，恢复 v1 镜像与配置，再加载操作前快照。
4. 回滚验证必须覆盖 v1 健康检查、创建请求和随机历史短码跳转。
5. 任何恢复或回滚失败时保持写入口关闭，不允许对数据状态不确定的 Redis 继续写入。

## 11. 发布前待决事项

| 编号 | 决策 | 推荐默认值 |
| --- | --- | --- |
| D1 | 历史短链是否保留 | 保留并迁移，采用 `cap-90d` |
| D2 | Turnstile 生产凭据和 hostname | 发布前显式提供，缺失失败关闭 |
| D3 | Gateway 到 MyUrls 的可信 CIDR | 使用独立内部网络和精确来源范围 |
| D4 | MyUrls v2 发布标识 | 使用匹配源码的稳定版本并固定 digest |
| D5 | MyUrls 本地源码模式 | 默认废弃，改为 Compose-first HTTP 契约联调 |

## 12. 当前实施结论

- D1：已确定采用保留历史短链的离线复制方案和 `cap-90d`；迁移 TTL 为 `min(旧剩余 TTL, 90 天)`，不删除旧 key。
- D2：已完成架构落地；APP 与 SHORT 使用独立 MyUrls 实例并分别校验各自 hostname。生产仍需提供真实 Turnstile 凭据。
- D3：已完成，Gateway 到 MyUrls 使用 `172.30.255.2/32` 独立内部网络信任边界。
- D4：已完成，上游 `v2.0.2` stable tag 指向锁定源码 commit，GHCR multi-platform manifest 与平台 digest 已固定。
- D5：已完成，旧源码构建、Go 本地流程和 v1 前端契约已移除，使用 Compose-first HTTP 联调。

生产切流的剩余前置条件是：提供真实 D2 凭据，随后重跑 `verify:integration`、`verify:operations` 和浏览器门禁。

只有 D1 至 D4 均有明确结论、PR1 至 PR3 的发布阻断门禁全部通过后，才允许将生产流量切换到
MyUrls v2。
