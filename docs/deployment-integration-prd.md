# Subweb 部署与配置整合 PRD

> 状态：已完成
>
> 本文是部署与配置整合工作的执行基线与完成记录。它描述目标、边界、实施阶段和验收条件，不改变当前运行时边界。
>
> 当前运行合同仍以 [`architecture-prd.md`](architecture-prd.md)、可执行验证脚本和生产 Compose 文件为准。本 PRD 的所有阶段已完成，并已通过 repository、Compose 与 release 验证。

## 1. 背景与问题

Subweb 当前的运行时边界是合理的：统一 Go Gateway、隔离的 SubConverter、独立的 MyUrls Rust runtime，以及通过 Redis DB `0`/`1` 隔离的短链数据和 Gateway 限流状态。

主要整合问题不在容器数量，而在部署契约存在多个维护入口：

- 生产 Compose 文件之间存在公共配置和安全约束的重复。
- `versions.lock.json`、Compose 默认值、release workflow 和部署脚本都参与外部镜像配置。
- `.env`、配置脚本、部署脚本、Compose 插值和 Gateway 配置解析分别承担部分配置语义。
- 验证脚本、发布流程和文档可能各自重新推导服务拓扑、镜像来源和功能开关规则。

这些重复会增加配置漂移、发布回滚不完整和验证结论不一致的风险。

## 2. 产品目标

为自托管维护者和项目运维者提供一套单一、可追溯、可验证的部署契约，使：

1. 版本锁成为外部 runtime 镜像和来源元数据的唯一权威来源。
2. 短链开启和关闭两种生产部署 profile 由同一套公共配置模型生成或组合。
3. 部署、CI、release preflight 和文档检查验证同一个最终 Compose 产物。
4. `scripts/subweb.sh` 保持命令分发职责，不再重复实现配置和拓扑推导。
5. 改造不削弱当前的网络隔离、镜像不可变性、回滚合同、权限约束或 MyUrls HTTP 适配边界。

## 3. 非目标

本 PRD 明确不包含以下改造：

- 不合并 Gateway、SubConverter、MyUrls 或 Redis 容器。
- 不把 MyUrls 编译进 Gateway。
- 不把 SubConverter 运行逻辑并入 Gateway。
- 不合并两个内部 CONNECT egress listener。
- 不改变 APP、API、SHORT 公网路由和 `/short-api/links` 合同。
- 不改变 MyUrls 的 Redis DB、Turnstile、`PUBLIC_BASE_URL` 或 RFC 9457 错误合同。
- 不改变 Redis DB `0`/`1` 的数据边界。
- 不引入单容器生产部署模型。
- 不在本次改造中进行无关的前端重构、Go Gateway 业务重构或 Rust MyUrls 版本升级。

## 4. 固定约束与不变量

以下条件在改造前后必须保持成立：

### 4.1 生产 profile

- 短链启用 profile 必须包含 `gateway`、`subconverter`、`myurls`、`redis` 四个服务。
- 短链关闭 profile 必须只包含 `gateway`、`subconverter` 两个服务。
- 只有 Gateway 可以发布宿主机端口。
- Gateway 发布端口必须绑定 `127.0.0.1`，目标容器端口为 `8080`。
- 生产 profile 不得依赖 Compose profile 插值来隐藏缺失变量。

### 4.2 网络与信任边界

- SubConverter 只能通过 Gateway 的受控订阅 egress 访问外部网络。
- MyUrls 不得直连公网，只能通过 Gateway 的受限 hostname egress 访问 Turnstile。
- Gateway 不得加入 MyUrls 数据网络。
- SubConverter 不得加入 MyUrls 或 Redis 网络。
- 两个 CONNECT listener 保持职责和端口分离。

### 4.3 配置和发布

- `SHORT_LINKS_ENABLED` 只接受小写 `true` 或 `false`，并决定最终生产合同。
- `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 的现有唯一性和 profile 要求保持不变。
- 外部 runtime 镜像引用必须来自 `deploy/versions.lock.json`。
- 发布和部署继续使用不可变镜像引用；不得退回 `latest` 或可变产品标签。
- MyUrls 来源仓库、Rust `v2.x.y` source tag、GHCR 仓库及 source/image tag 一致性继续由验证器强制检查。
- 回滚必须使用完整 runtime image 集合；MyUrls HTTP 合同变化时必须同时恢复 Gateway 路由和前端行为。

### 4.4 安全和数据

- Redis 密码不得出现在宿主机进程参数中。
- 生产容器的只读 root filesystem、capability、网络和日志约束不得因渲染或配置整合而丢失。
- 现有备份、恢复、限流和数据卷合同保持不变。

## 5. 目标用户与使用场景

### 5.1 自托管维护者

输入域名、镜像和功能开关配置后，得到一份可审计的最终部署合同，并能明确知道将启动哪些服务、使用哪些镜像和网络。

### 5.2 发布维护者

修改版本锁后，可以生成发布所需的 runtime image 环境和 rollback manifest；CI 能验证这些产物与 Compose、Dockerfile 和文档一致。

### 5.3 故障恢复维护者

在升级失败时，能够使用完整且来源可追溯的镜像集合和对应 profile 恢复，而不需要手工猜测各服务版本。

## 6. 目标架构

```text
用户配置 + deploy/versions.lock.json
                 |
                 v
       deployment contract renderer
                 |
        +--------+---------+
        |                  |
        v                  v
  final Compose       generated image env
        |
        +--> deployment
        +--> compose validation
        +--> release preflight
        +--> documentation checks
        +--> rollback manifest
```

运行时仍保持：

```text
Gateway
  |-- controlled subscription egress --> SubConverter
  |-- restricted hostname egress -----> external Turnstile
  |-- HTTP adapter --------------------> MyUrls
  |-- Redis DB 1 ----------------------> rate limiting

MyUrls -------------------------------> Redis DB 0
```

## 7. 功能需求

### FR-1：建立公共部署契约

系统必须提供一个单一来源，表达以下公共服务属性：

- 服务名称和依赖关系
- 网络及其 `internal` 属性
- healthcheck
- restart、logging、resource 和 filesystem 约束
- Gateway loopback 端口
- 运行时 UID、capability 和 bootstrap 要求
- 公共环境变量和安全默认值

公共契约不得复制一份完整生产 Compose 作为第二事实来源。

### FR-2：表达两个显式生产 profile

系统必须保留两个可独立渲染、可独立验证的最终 Compose profile：

- `short-links-enabled`
- `short-links-disabled`

短链开关必须通过最终渲染结果反映，而不是由验证器信任调用者环境中的同名变量。

### FR-3：生成锁定的 runtime image 配置

渲染或发布步骤必须从 `deploy/versions.lock.json` 生成 runtime image 环境或等价结构化产物，至少包含：

- Redis
- SubConverter
- MyUrls
- 完整 runtime rollback image 列表

生成产物必须能追溯回锁文件中的 source commit、tag、image reference 和平台 manifest digest。

### FR-4：部署脚本只执行已解析合同

`subweb.sh` 可以选择命令和 profile，但不得独立重新实现：

- 镜像版本解析
- 服务拓扑推导
- 网络安全规则
- 生产 profile 选择逻辑
- runtime rollback image 生成

部署入口必须在启动前消费并验证最终合同。

### FR-5：验证统一面向最终产物

以下检查必须尽可能读取同一份最终 Compose 或其结构化渲染结果：

- Compose topology validation
- production readiness
- release preflight
- image/source lock validation
- rollback manifest validation
- documentation contract validation

现有独立验证入口可以继续存在，但不得对同一规则维护互相矛盾的第二实现。

### FR-6：保留本地开发合同

本地开发仍使用现有 `compose.dev.yaml` 和 `.runtime/local/compose.env` 工作流。生产契约整合不得破坏：

- SubConverter 本地 API URL 原子更新
- 本地代理变量隔离
- 本地 MyUrls loopback 配置
- Vite `/short-api` 代理
- verifier 自有容器和网络清理

如果生产渲染器被本地开发复用，必须明确区分生产和本地覆盖层，不能让本地变量泄漏进生产合同。

### FR-7：文档保持与产物一致

文档必须说明：

- 两种受支持生产 profile
- 配置和版本锁的权威来源
- 最终 Compose 的生成或解析方式
- 不支持单容器和合并运行时
- 回滚使用完整 runtime image 集合

`README.md`、架构文档、部署文档和验证文档不得描述已退休的 Compose 或 merged-container 路径。

## 8. 非功能需求

### NFR-1：可追溯性

任何最终镜像引用都必须能追溯到版本锁和对应上游来源；禁止生成无法解释来源的默认值。

### NFR-2：失败关闭

缺少锁定字段、profile 服务、网络、端口、digest 或安全约束时，渲染、验证和部署必须失败，不得自动降级为不安全默认值。

### NFR-3：幂等性

相同输入配置和相同版本锁必须生成字节稳定或语义稳定的结果；重复执行不得产生额外状态漂移。

### NFR-4：兼容性

本次改造不应改变现有用户配置变量名称、CLI 主要命令或生产 HTTP 路由；需要迁移的内部生成文件必须提供明确的兼容读取策略或一次性迁移步骤。

### NFR-5：可测试性

渲染器、配置归一化和 profile 选择逻辑必须可以脱离真实生产容器进行单元测试；最终 Compose 仍必须通过真实 Compose config/render 检查。

## 9. 分阶段执行计划

### Phase 0：基线冻结与差异清单

目标：在改动前锁定当前行为。

工作项：

- 记录两个生产 Compose 的服务、网络、端口、环境变量、healthcheck 和权限差异。
- 记录 `versions.lock.json` 被 workflow、脚本、Compose 和文档读取的位置。
- 为当前短链开启和关闭 profile 保存可验证的最终配置快照。
- 明确哪些重复规则必须先抽取，哪些差异是有意合同。

退出条件：差异清单完成，且没有把有意的安全差异误判为重复。

### Phase 1：锁文件到 runtime image 产物

目标：消除外部 runtime 镜像的多处手写来源。

工作项：

- 从 `deploy/versions.lock.json` 生成受管理的 runtime image env/manifest。
- 让 release workflow、部署脚本和 rollback manifest 消费同一来源。
- 保留 source commit、source tag 和 platform digest 的验证。
- 为缺失、漂移和伪造 provenance 添加失败测试。

退出条件：修改锁文件即可生成完整 runtime image 集合；Compose、workflow 和 rollback 验证通过。

### Phase 2：公共 Compose 契约和 profile 渲染

目标：消除两个生产 Compose 文件的公共手工重复。

工作项：

- 定义公共部署契约。
- 定义短链开启和关闭的显式差异层。
- 生成两个最终 Compose 文件，或生成一个等价的确定性 Compose 结果。
- 保留短链开启四服务和关闭短链两服务的失败关闭校验。

退出条件：两种 profile 的最终 Compose 结构与当前合同等价；真实 Compose config、网络、权限和 healthcheck 验证通过。

### Phase 3：部署入口收敛

目标：让 `subweb.sh` 只负责命令分发和调用已验证合同。

工作项：

- 移除部署入口中与渲染器重复的版本和拓扑推导。
- 统一 `up`、`verify`、`upgrade`、`backup`、`restore` 使用的 profile 选择来源。
- 保留 `subweb.sh up` 对本地镜像与预构建不可变镜像的既有行为。
- 验证恢复流程仍使用 `.env` 选择的 Compose 合同和完整五服务恢复合同。

退出条件：部署命令只使用已解析配置；生产、升级和恢复验证通过。

### Phase 4：验证和文档收敛

目标：让 CI、release preflight 和文档共同引用最终产物。

工作项：

- 抽取重复验证规则或让验证器读取结构化渲染结果。
- 保持 `release verification=passed` 明确终止标记。
- 更新 README、架构、部署、配置、维护和验证文档。
- 清理已退休路径的正向文案，但保留必要的历史说明。

退出条件：完整 repository verification、documentation、version-lock、Compose、release 和 diff-format gates 通过。

## 10. 验收标准

### AC-1：当前运行合同不变

短链开启和关闭两个 profile 的服务集合、端口、网络、权限、数据 DB、路由和 egress 语义与 `architecture-prd.md` 一致。

### AC-2：单一版本来源

Redis、SubConverter 和 MyUrls 的最终镜像引用全部来自 `deploy/versions.lock.json`；任何手工漂移均被验证器拒绝。

### AC-3：完整回滚来源

release workflow 能从版本锁生成完整 runtime rollback list，并拒绝缺失、重复、无 digest 或不一致的条目。

### AC-4：profile 失败关闭

删除任意必需服务、网络、Gateway loopback 端口、锁定镜像、必要内部配置或安全权限约束时，验证失败。

### AC-5：部署脚本职责收敛

`subweb.sh` 不再持有与 renderer/validator 重复的拓扑和版本事实；生产命令仍可正常执行。

### AC-6：本地开发不回归

`npm run verify:local` 及本地 Compose 生命周期继续通过，且本地环境变量不会污染生产渲染结果。

### AC-7：文档不漂移

`npm run verify:docs` 通过；README 和部署文档链接到本地开发指南，并且不再把退休路径描述为受支持方案。

### AC-8：发布证据完整

`npm run verify:release` 以明确的 `release verification=passed` 终止，并覆盖最终 Compose、锁定镜像、四服务/两服务 profile、真实运行时 smoke、恢复和证据检查。

## 11. 测试策略

每个阶段都必须采用增量测试：

- 单元测试：配置归一化、锁文件解析、profile 选择、生成结果稳定性和错误分类。
- 集成测试：渲染结果通过 Docker Compose config，服务集合、网络、端口、healthcheck 和权限符合合同。
- 发布测试：锁文件、Dockerfile runtime inputs、Compose 引用、source/image tag 和 platform digest 交叉验证。
- 端到端测试：APP/API/SHORT 路由、转换、短链创建/解析、短链关闭 profile 和恢复流程。
- 文档测试：README、架构、部署、验证文档的链接、退休路径和合同内容检查。

新增或修改行为必须先添加失败测试，再实现最小改动，最后运行完整受影响验证。覆盖率不得因本改造降低现有项目门槛。

## 12. 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| 生成器改变 Compose 插值语义 | 以最终 `docker compose config` 结果为验证对象，并覆盖缺失变量场景 |
| 两个 profile 的有意差异被误合并 | Phase 0 建立差异清单；网络、权限和短链依赖按合同逐项保留 |
| 版本锁生成产物与 workflow 漂移 | 只允许一个生成入口，并在 CI 中重新生成后比较结果 |
| 部署脚本迁移造成生产回归 | 先保留兼容读取路径，完成真实四服务和两服务 smoke 后再删除旧逻辑 |
| 本地开发变量污染生产 | 明确生产和本地输入边界，验证环境使用隔离的临时目录和环境文件 |
| 回滚只恢复镜像未恢复合同 | 将完整 runtime rollback manifest 和 profile 配置作为同一发布产物 |
| 文档先于代码更新造成误导 | 在对应 Phase 验收通过后才更新“当前支持”文案 |

## 13. 实施规则

后续执行必须遵循以下顺序：

1. 先读取本 PRD和当前架构合同，确认改动属于本范围。
2. 先建立或更新失败测试，再修改 renderer、脚本或 Compose。
3. 每个 Phase 完成后运行该阶段退出条件对应的验证。
4. 不得为了减少文件数量删除现有安全边界或验证覆盖。
5. 发现改动会影响 MyUrls HTTP 合同、路由或前端行为时，必须按完整跨合同回滚规则处理。
6. release 或 production readiness 验证失败时，不得提交、推送或发布；必须先区分代码回归与外部工具/环境失败。
7. 所有文档行为声明必须在可执行验证通过后更新。

## 14. 执行结果

所有阶段均已完成：

- Phase 0：部署 profile 基线与版本锁引用图已冻结为受验证文档。
- Phase 1：`runtime-image-contract.mjs` 成为外部运行时镜像和 rollback 数据的唯一受验证生成入口。
- Phase 2：两个显式生产 Compose 合同通过 `compose.common-services.yaml` 共享 Gateway 与 SubConverter 服务定义。
- Phase 3：配置、部署与 release 入口消费同一受管镜像合同。
- Phase 4：生产就绪检查验证最终渲染 Compose 模型，文档与 release workflow 已同步。

最终验收已运行 `npm run verify:ci`、两个 production-readiness profile 及 `npm run verify:release`，后者输出明确的 `release verification=passed` 标记。
