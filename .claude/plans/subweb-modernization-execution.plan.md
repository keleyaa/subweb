# subweb 现代化执行计划（修订版）

- Status: P2-03a-complete-awaiting-next-task
- Current task: none
- Last completed: P2-03a
- Next task: P2-03b

> 说明：本文是本项目后续现代化改造的**唯一执行台账**。P0 至 P4 的已批准本地变更已完成；仍未执行的 Docker、GitHub Actions、镜像仓库与回滚演练均明确列为外部验证缺口，不得据此宣称生产发布已验证。

## 1. Scope Lock

### 允许范围
- 仅做规划、拆解、排序、风险控制与验收定义
- 仅在后续获得明确批准后，才进入实际变更
- 仅使用现有仓库事实做计划，不推定已完成实施

### 本次明确不做
- 不改生产代码
- 除本执行计划台账外，不创建实施文件
- 不进行整体重构式迁移
- 不一次性替换 Vue CLI、Vuex、JS、Docker、CI 全部栈
- 不引入无法回滚的架构性改动
- 不在没有验证路径前做 UX 大改

### 变更边界原则
- 每个原子任务只覆盖单一主风险面
- 先安全稳定，再基础设施，再渐进迁移，再体验，再特性，再发布体系
- 任何偏离计划的需求都必须停止、记录、请求批准
- 若一个任务需要新路由、新 API 合约、新构建目标或新依赖，则必须重新拆分并重新批准

---

## 2. 当前仓库事实基线

本计划基于以下已确认仓库事实：
- `package.json` 仍是 Vue CLI 构建，脚本为 `serve` / `build` / `lint`
- `Dockerfile` 当前使用多阶段构建，构建阶段基于 `node:20.15.1-alpine`，运行阶段基于 `nginx:1.26.2-alpine`，并使用锁文件驱动的 `npm ci`
- `start.sh` 通过 `sed` 把运行时配置写入 `/usr/share/nginx/html/conf/config.js`
- `public/conf/config.js` 以 `window.config` 暴露站点配置
- `public/index.html` 通过 `<script src="<%= BASE_URL %>conf/config.js"></script>` 注入配置
- GitHub Actions 工作流 `.github/workflows/docker-build-release.yml` 仍会构建并推送 `latest` 与版本 tag

---

## 3. Branch Strategy

当前分支是 `main`，且跟踪 `origin/main`。建议采用：
- 先从 `main` 拉出短生命周期工作分支
- 每个阶段或每组独立可回滚的原子任务使用独立分支
- 推荐命名：`modernize/p0-safety-<topic>`、`modernize/p1-vite-pinia-<topic>` 等
- 每个原子任务完成后尽快合并或回收，避免长生命周期集成分支
- 若某任务需要试验性迁移，使用专门的 spike 分支，但不得直接进主线
- 生产发布仍以可追踪 tag / 镜像版本为回滚边界，不依赖 `latest` 作为唯一回滚锚点

---

## 4. Migration Compatibility Strategy

### 总原则
- 采用双轨并行、逐步切换、保留旧接口的兼容策略
- 所有新能力先以适配层 / 包装层 / 兼容层接入
- 先保留旧 API、旧路由、旧数据流，再逐步替换内部实现
- 先迁移纯函数、网络封装、状态容器和可视化壳层，最后才动核心交互

### 兼容策略建议
- Vuex 与 Pinia 的过渡期并存，但必须明确主数据源方向
- Vue CLI 与 Vite 过渡期并存，以构建验证和最小入口切换为主
- JS 到 TS 采用逐文件、先纯函数后组件、先类型声明后严格化的节奏
- 旧 UI 与新 UI 并行一段时间，通过 feature flag 或路由级切换控制
- runtime config 继续支持 `window.config`，同时准备更清晰的配置适配层
- Docker / CI 变更先做可验证的旁路检查，再切换默认流程

### 禁止事项
- 不做一把梭的全量目录迁移
- 不在没有回滚方案时删除旧实现
- 不把所有状态、路由、构建一次性重写

---

## 5. Phase Gates

### P0 安全 / 稳定门
进入条件：
- 已完成仓库现状盘点
- 已明确 runtime config、Docker、短链、复制、网络调用等风险点

通过条件：
- 关键故障面具备防护、验证和回滚点
- 无新增不可控运行时风险

### P1 Vite / Pinia / 渐进 TypeScript 门
进入条件：
- P0 已完成并稳定
- 已能在不改变外部行为前提下建立兼容层

通过条件：
- 至少完成构建体系与状态管理的渐进切换路径
- 纯函数和核心 helper 已有 TS 化落点

### P2 核心 UX 重设计门
进入条件：
- P1 已提供足够的组件边界和状态边界
- 输入、输出、校验、错误处理路径已稳定

通过条件：
- 新旧 UI 可并行或可切换
- 关键用户路径可回退

### P3 新产品特性门
进入条件：
- 核心 UX 已稳定
- 兼容层和配置层已清晰

通过条件：
- 新功能不破坏旧用户流
- 每个新功能独立开关、独立回滚

### P4 CI / Container / Release 门
进入条件：
- 构建和运行路径已稳定
- 版本、镜像、发布流程清晰

通过条件：
- CI 可重复、容器可预测、发布可回滚
- 依赖和镜像版本可追踪

---

## 6. Global Definition of Done

整个 modernize 计划完成时必须满足：
- 关键用户路径稳定可用
- 生产行为可回归验证
- 失败有明确回滚点
- 无未记录的架构偏移
- 已完成逐步迁移，不依赖一次性重写
- 构建、运行、发布、回滚流程都有明确操作
- 新旧兼容期的过渡方案已结束或明确收敛
- 每个原子任务均有状态、证据与结论
- 每个原子任务都只覆盖一个主风险面，并具有明确验证路径

---

## 7. Progress Log

| 时间 | 任务 ID | 状态 | 结果 | 风险 | 回滚状态 | 备注 |
|---|---|---|---|---|---|---|
| 2026-07-28 | P0-00 | [x] 已完成 | 已盘点构建、启动、发布、运行时配置、浏览器入口、路由、状态、网络和主用户流；确认唯一工作流及缺失的常见部署配置表面 | 低；仅调查，无生产代码变更 | 不适用；P0-01 已将 Git 提交确认为唯一可靠回滚锚点 | 工作分支 `modernize/p0-safety-baseline`；`latest` 不作为可靠回滚锚点 |
| 2026-07-28 | P0-01 | [x] 已完成 | 已冻结本地可证实的构建、启动、发布和核心用户流合同；已记录外部服务与测试覆盖缺口 | 低；仅调查，无生产代码变更 | 当前不可变锚点为 Git 提交 `8739041259f5db471d1cc40e2907e6526f00b9be`；历史参考为 `v2.0`→`246022088b93d6f0a077e4ee53733f11ceddf7aa`、`v1.0`→`68879fd8f1db9175d218aa7bbd027acdf02c9be5` | `main`、`latest`、版本/日期镜像标签均可能被重推，未捕获 digest 前不得作为可靠镜像回滚点；未访问外部 API、短链、远程配置或镜像仓库 |
| 2026-07-28 | P0-02a | [x] 已完成 | 已加固 `start.sh`：安全空值判断、配置模板/复制/写入失败即中止、拒绝换行/回车、正确转义 JS 单引号与 sed 特殊字符、临时文件后原子替换、`exec nginx` | 中；启动脚本变更已经离线矩阵验证和独立代码审查 | 恢复 `start.sh` 到锚点提交 `8739041259f5db471d1cc40e2907e6526f00b9be` 的版本 | `sh -n`、`git diff --check` 通过；本地 Node 语义验证默认/空值/特殊字符/缺模板/换行拒绝通过；容器运行时与外部服务未实际启动验证 |
| 2026-07-28 | P0-02b | [x] 已完成 | 已在 `index.html` 为 `window.config` 添加同步默认值与最终类型规范化，保持 `config.js` 和容器环境变量渲染合约不变 | 中；内联脚本是为配置脚本缺失/解析失败提供的特意兜底 | 恢复 `public/index.html` 到锚点提交 `8739041259f5db471d1cc40e2907e6526f00b9be` 的版本 | Node VM 验证正常、缺失、解析失败、部分、原始类型和无效数组配置均通过；`git diff --check` 通过；依赖未安装，未能运行 Vue 构建 |
| 2026-07-28 | P0-04 | [x] 已完成 | 已定义 Axios 包装器合同：默认 5 秒超时、保留原始 Axios resolve/reject 语义，并将旧 `header` 参数兼容映射到标准 `headers` | 低；仅网络包装层，无 UI 行为变更 | 恢复 `src/network/index.js` 到锚点提交 `8739041259f5db471d1cc40e2907e6526f00b9be` 的版本 | Node mock 验证默认/显式超时、header 映射、headers 优先、原始 resolve/reject 透传通过；三路独立审查通过；未对外发起短链请求 |
| 2026-07-28 | P0-03 | [x] 已完成 | 已统一校验、配置、短链和复制失败反馈；短链业务/请求失败不再静默；复制临时节点和加载状态均在所有退出路径清理 | 中；仅 `SubTable.vue` 的用户反馈与异步控制流变更 | 恢复 `src/views/home/SubTable.vue` 到锚点提交 `8739041259f5db471d1cc40e2907e6526f00b9be` 的版本 | 静态检查、`git diff --check`、本地 VM 成功路径及失败路径验证通过；最终范围裁定批准；未用真实浏览器/外部短链服务进行端到端验证 |
| 2026-07-28 | P0-GATE | [x] 已通过 | `npm ci`、生产构建和本地页面/订阅链接生成/复制烟雾验证通过；lint 自动修改的计划外格式化文件已按用户授权恢复 | 中；依赖安装揭示旧锁文件、Node 24 engine 警告及 58 个审计漏洞 | 如需重置验证依赖，删除 `node_modules` 并重新执行 `npm ci`；不回退 P0 代码 | 构建存在资产体积和过期 Browserslist 警告；未真实调用短链服务；lint 自动修改策略需在后续质量治理任务中显式处理 |
| 2026-07-28 | P1-01 | [x] 已完成 | 已完成并经复核的 Vue CLI→Vite 旁路迁移评估；冻结默认 Docker/Vue CLI/运行时配置/入口/路由/网络合同，明确未来 Vite 必须作为独立实施任务 | 低；仅评估，无生产代码变更 | 不适用；默认 `npm run build`、Dockerfile、start.sh、CI 均保持现状，未来仅回滚 Vite 专属新增项 | 独立审查最终通过；P1-02a 可独立推进，但 Vite 实施必须另行批准 |
| 2026-07-28 | P1-02a | [x] 已完成 | 将 `getSubLink` 内部的链接归一化、布尔查询值和高级参数拼接拆为私有纯函数，保留公开导出与调用方式 | 低；仅行为保持型 helper 提取 | 恢复 `src/views/home/index.js` 到锚点提交 `8739041259f5db471d1cc40e2907e6526f00b9be` 的版本 | 与 HEAD 的普通/空行/特殊字符/远程配置/truthy-falsy 差分输出一致；Node 语法与 diff 检查通过；初始组合审查两项 HIGH 经三路复现均被证伪 |
| 2026-07-28 | P1-02b | [x] 已完成 | 为 URL 纯函数与 Axios 包装器添加宽松、如实的 JSDoc 合同，记录旧 coercion、可选字段、header/header(s) 优先级和原始 Promise 语义 | 低；仅注释，运行时实现不变 | 移除 `src/views/home/index.js` 与 `src/network/index.js` 中本任务的 JSDoc 注释 | JSDoc 准确性审查批准；Node 运行时差分与 mock 合同保持不变；局部 ESLint、语法和 `git diff --check` 通过；生产构建成功；lint 格式化漂移已按授权恢复 |
| 2026-07-28 | P1-03 | [x] 已完成 | 完成 Vuex 状态所有权图与 Pinia 目标映射设计；明确 Vuex 当前唯一 source of truth、按 slice 的单写者规则、Dialog/布局 helper 兼容约束，以及 menu 占位模块不迁移 | 低；仅设计，无 Pinia 安装或源码变更 | 不适用；后续若实施失败，恢复 Vuex-only 作为唯一写入源 | 设计修正版经独立审查通过；明确 `app.dialog` mutation 非对称语义、`navStyles` 的 Set/class mapping 约束、`isCollapsed` 双写入口及 SubTable 全局 helper 依赖 |
| 2026-07-28 | P1-04 | [x] 已完成 | 完成渐进式静态约束的设计-only边界与未来 P1-04a 固定实施合同；本任务不改生产文件、不执行 scoped lint 实施 | 低；仅设计与交接规则 | 不适用；未来 P1-04a 失败时仅回滚其固定白名单文件 | 明确默认 lint/build 合同不变、直接 ESLint 显式文件参数和只读/no-fix要求、warning/error baseline与预算；工作区生产修改均为此前已批准任务，不归因于 P1-04 |
| 2026-07-28 | P2-00 | [x] 已完成 | 已确认现有单一路由 `/`、`App.vue` 根出口、`MainLayout.vue` 布局壳、`HomeView.vue`/`SubTable.vue` 旧 UI 路径；推荐在现有 App/Layout 边界做 shell-level 分支，保持路由不变，缺失/无效/未解析时严格回退旧 UI | 低；仅设计，无生产代码变更 | 回退到现有 `App.vue → router → MainLayout.vue → HomeView.vue → SubTable.vue` 基线路径 | 已否决将 query flag 作为 P2-00 既定机制；当前尚未确定切换源治理方式（build-time、runtime config 或 app-level state），需后续单独批准；未验证真实浏览器切换、容器运行时和外部服务 |
| 2026-07-28 | P2-02 | [x] 已完成 | 完成新旧 UX 并行切换机制评估；确认当前没有既有的路由、query 或全局 feature-flag 合同，因此不引入 speculative switch plumbing；保留 `window.config` 默认优先和 SubTable 现有本地选择状态作为唯一已验证的 fallback-first 切换来源 | 低；仅设计，无生产代码变更 | 不启用任何新切换源，维持现有 `/` 路由、旧 UI 和 `window.config` 默认路径 | `App.vue`、`MainLayout.vue`、router、runtime config 和 SubTable 状态静态审查完成；未验证真实浏览器、容器运行时或外部服务；若未来要新增部署级 UX flag，必须另行批准配置 schema 和实施任务 |
| 2026-07-29 | P2-01a | [x] 已完成 | 已将 `SubTable.vue` 的表单输入准备与校验决策边界保持在 `prepareConversion` 辅助层，`getConverter` 仍只负责 UI 侧消息映射与结果赋值；保留现有 conversion、short-link、clipboard、route 与 API 合约不变 | 中；仅进行最小纯逻辑边界分离，未触碰输出/交互分层 | 回退到 `src/views/home/index.js` 与 `src/views/home/SubTable.vue` 的 P2-01a 变更前状态 | `npm run lint`、`npm run build` 和 `git diff --check` 通过；未改 `HomeView.vue`，未新增路由/API/依赖，未改变短链请求形状或复制时序 |
| 2026-07-29 | P2-01b | [x] 已完成 | 已确认 `SubTable.vue` 在保留单组件边界的前提下分离结果展示与动作入口：`showConversionResult` 负责转换结果复制，`getSubUrl`/`getShortUrl` 只编排既有转换、复制、短链与 loading 路径；不改数据准备、DOM、dialog/store、runtime config、route 或 API 合约 | 中；仅确认既有输出/交互职责边界，未抽取新组件、未新增隐藏状态或改变副作用时序 | 回退到 `src/views/home/SubTable.vue` 的 P2-01b 前版本 | `npm run lint`、`npm run build`、`git diff --check` 与现有行为历史对比通过；短链请求仍为原 `POST {shortUrl}/short` + `FormData.longUrl=btoa(result.subUrl)` 形状，复制仍使用原 DOM fallback/cleanup 路径 |
| 2026-07-29 | P2-03a | [x] 已完成 | 已在 `src/views/home/SubTable.vue` 中保留单卡片布局、DOM 顺序、v-model、动作与网络路径不变，只增加语义分组与 label/id 关联：输入区与输出区各自使用 fieldset/legend，订阅与结果控件补齐可确定的 id/for 关系 | 低；仅语义与可访问性关联调整，无业务规则/流程变更 | 回退到 `src/views/home/SubTable.vue` 的 P2-03a 变更前版本 | `npm run lint`、`npm run build`、`git diff --check` 和本地 label/fieldset/key 结构合同检查通过；未新增路由、API、依赖或外部调用；P2-02 仍保持设计完成、因缺少已批准 switch contract 而不实施 |
| 2026-07-28 | P3-01 | [x] 已完成 | 完成配置与模板管理产品化评估；确认当前仅存在公开、部署时 `window.config`/`config.js`/`start.sh` 配置链，没有认证、持久化、管理 API 或多租户能力；将 `siteName`、`menuItem`、`remoteConfigOptions` 评为未来可考虑的 admin-only/local-only 内容，将 `apiUrl`、`shortUrl` 保持 deployment-only | 中；仅评估，无生产代码变更；公开配置、订阅 Token、远程配置 URL 和短链服务存在既有隐私/SSRF/多用户暴露边界 | 维持现有静态默认值、配置文件和容器环境覆盖路径；不启用任何新产品化能力 | 静态事实盘点、产品边界、回滚和安全审查完成；未访问外部服务或实现认证/持久化；未来 runtime-editable/admin-managed 能力必须单独批准并定义 API、auth、source-of-truth、迁移和 allowlist |
| 2026-07-28 | P3-02a | [x] 已完成 | 定义已实现的 conversion、copy 和 short-link 边界：`result.subUrl` 为 canonical artifact；复制只处理 plain string；短链固定为 `POST {shortUrl}/short` + `FormData.longUrl=btoa(result.subUrl)`；未来 share 必须是独立、可选、版本化扩展 | 中；订阅 URL 是可重放 bearer-like 数据，base64 不是加密，短链/远程配置存在第三方暴露和 SSRF 边界；仅设计，无生产代码变更 | 始终回退到现有 conversion URL、plain-text clipboard 和当前 `/short` v1 合同；未来 share 失败不得阻断现有流程 | 已完成代码事实、兼容性、隐私和安全边界审查；未实现 share endpoint、envelope、存储或新字段；未调用外部短链服务；未来 schema、隐私确认、allowlist 和后端 ownership 需单独批准 |
| 2026-07-28 | P3-02b | [x] 已完成 | 完成短链与分享 UI 接入评估；确认当前已存在“短链”生成后复制的 UI，但不存在独立 share UI、share endpoint 或 share schema；不增加代码、不改变 `/short` v1 合同 | 高；短链默认将完整订阅 URL 发送至配置的第三方服务，复制与远程配置也有既有隐私/供应链/SSRF 边界；进一步实现前需产品、隐私和后端批准 | 延迟任何新 UI/transport；维持现有 `result.subUrl`、短链可选旁路、plain-text copy 和失败时长链 fallback | 已完成短链成功/失败、末尾斜杠、loading、copy target 和 fallback 的静态验证设计；未调用真实短链服务、未做真实浏览器 clipboard E2E；未来需明确 consent、operator ownership、allowlist、share API/schema 和日志政策 |
| 2026-07-29 | P4-01 | [x] 已完成 | 完成 CI/Docker/发布可重复性审计，并实施基础镜像更新、锁定依赖安装与构建输入边界加固；发布目标保持 Docker Hub + Harbor，tag 保持 `latest` 与 Dockerfile `ENV VERSION`/日期 fallback | 中；基础镜像仍为可变版本 tag，Docker/GitHub/registry 实际运行未在本地实证 | 恢复 Dockerfile、`.dockerignore` 与 workflow 到 P4 实施前的已知基线；任何实施失败只回滚对应文件 | 当前 Dockerfile 使用 `node:20.15.1-alpine`、`nginx:1.26.2-alpine` 和 `npm ci`；digest、registry、CI logs、Hub/Harbor 一致性和 provenance 仍未外部验证；`latest` 不作为可靠回滚锚点 |
| 2026-07-29 | P4-01a | [x] 已完成 | 将 Dockerfile 依赖安装收敛为 `RUN npm ci`，使用已提交 lockfile 执行冻结依赖安装，并保留依赖层缓存顺序 | 低；Docker runtime 不可用，无法执行真实镜像构建 | 恢复 Dockerfile 的依赖安装与复制顺序到 P4 实施前版本 | `npm run lint`、`npm run build` 和 `git diff --check` 通过；Docker build 未验证，因为环境没有 Docker |
| 2026-07-29 | P4-01b | [x] 已完成 | 更新构建与运行时基础镜像到 `node:20.15.1-alpine` 和 `nginx:1.26.2-alpine`，保持多阶段构建、公开 runtime-config 模板和启动合同 | 中；镜像 tag 未按 digest 固定，容器运行时未实际启动 | 恢复 Dockerfile 基础镜像引用到 P4 实施前版本 | 静态 Dockerfile、shell、lint/build 与 diff 检查通过；实际镜像拉取、构建和运行仍需外部验证 |
| 2026-07-29 | P4-02 | [x] 已完成 | 容器启动与 runtime-config 加固已由 P0-02a/P0-02b 完成并纳入 P4 发布控制：配置写入失败中止、值转义/换行拒绝、原子替换与 Nginx PID 1 语义保持 | 中；最终镜像中的容器启动未实际验证 | 恢复 `start.sh` 与 `public/index.html` 到 P0 基线 | 离线矩阵和静态检查通过；Docker runtime-config 注入仍需容器验证 |
| 2026-07-29 | P4-03 | [x] 已完成 | 新增 `.dockerignore` 收敛 Docker build context，排除 Git/CI/Claude、本地依赖、构建产物、日志、编辑器状态和环境文件，同时保留 `.env.example` | 低；仍依赖 Docker build context 的真实构建验证 | 删除 `.dockerignore` 并恢复 Dockerfile context 相关改动 | 静态检查确认保留 package/lock/source、`start.sh` 与配置模板；真实 Docker build 未执行 |
| 2026-07-29 | P4-04 | [x] 已完成 | 所有第三方 GitHub Actions 已固定为完整 commit SHA，保留原有触发、registry 与 tag 行为 | 中；上游 action SHA 与供应商发布版本的对应关系未在外部重新核验 | 恢复 workflow action 引用到 P4-03 前状态 | workflow 静态/YAML 与 diff 检查通过 |
| 2026-07-29 | P4-05 | [x] 已完成 | 捕获 Docker Hub source digest 与 Git SHA、workflow run、ref、tag、平台、UTC 构建时间；digest 缺失或格式错误时 fail closed | 中；GitHub Actions、Docker Hub/Harbor 推送和 digest 一致性未在本地实证 | 移除发布身份步骤并恢复仅按 tag 发布的 workflow；不回滚 P4-04 action SHA pin | workflow 静态/YAML 检查和 diff 检查通过；仅输出非 Secret 单行身份字段 |
| 2026-07-29 | P4-06 | [x] 已完成 | Docker Hub 构建请求 Buildx `provenance: mode=min` 与 `sbom: true`，并保留现有构建平台与发布目标 | 中；registry-side attestation/referrer 的生成、保留与 promotion 传播未实际验证 | 移除 provenance/SBOM 输入及其所需 workflow 配置 | 本地仅验证 workflow 合同；attestation 仍需发布后外部检查 |
| 2026-07-29 | P4-07 | [x] 已完成 | 将 workflow 改为一次 Docker Hub 多架构构建，再以 source digest 通过 `docker buildx imagetools create` promotion 到 Harbor；保留两端 `latest`/resolved tag；promotion 后有限重试 inspect Harbor tag，严格校验并比较 destination manifest digest | 中；真实 registry promotion、manifest parity、blob/referrer 与 provenance/SBOM 保留未执行 | 恢复第二个 Harbor build/push，移除 digest promotion/inspect；不回滚 P4-05/P4-06 identity/evidence 配置 | 静态 YAML、shell、diff gate 和独立审查通过；source 使用 `repo@digest` 不依赖 mutable tag；Docker/GitHub Actions/registry runtime 未执行 |
| 2026-07-29 | P4-07a | [x] 已完成 | promotion 结果由实际 Harbor inspect digest 记录；严格校验 source/destination digest，并在不相等或不可观测时 fail closed | 中；Harbor eventual consistency、权限、跨仓库复制与实际 parity 未在真实 registry 验证 | 移除 Harbor digest 验证/证据步骤并恢复 P4-07 前发布记录 | 代码含 5 次有限 retry/backoff 和严格 SHA-256 格式/相等性检查；外部 registry 行为未验证 |
| 2026-07-29 | P4-08 | [x] 已完成 | 通过 `jq -n --arg` 生成并 `jq -e` 验证 rollback manifest；记录 source/destination references/digests、Git SHA、workflow identity、tag、平台和构建时间，并作为 90 天 artifact 上传 | 中；artifact 上传、下载、保留及受控 rollback 演练未实际执行 | 移除 manifest 和 artifact upload 步骤，恢复 P4-07a 前 workflow | 不把多行 JSON 写入 GitHub outputs；本地只验证源文本合同 |
| 2026-07-29 | P4-09 | [x] 已完成 | 完成并保留最终 textual/static release-control contract gate：校验完整 action SHA pins、单次 build-push、digest-based promotion、严格 digest checks、provenance/SBOM 请求、rollback manifest jq/schema/artifact wiring 和 `.dockerignore` 关键排除项；明确不执行 live registry、Docker runtime、artifact retention 或 secret runtime 检查 | 中；GitHub Actions、Docker Hub/Harbor promotion、attestation/referrer、artifact retention 和 Docker runtime 仍需外部执行验证 | 移除 Verify release-control contracts 步骤并恢复 P4-08 workflow；不改变发布行为 | YAML、`sh -n`、`git diff --check`、`npm run lint`、`npm run build` 通过；静态 gate 已修复 shell literal expansion 问题；最终独立审查通过；live 验证缺口已明确记录 |












说明：
- P0-00 与 P0-01 已完成；后续每完成一个原子任务，立即追加一条进度记录，再暂停。
- 进度记录只陈述实际验证过的事实；外部服务、镜像仓库和运行时行为若未验证，必须明确标注为缺口。

---

## 8. 状态约定

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 暂停 / 需批准 / 偏离中止
- `[~]` 需复核 / 待验证

---

## 9. Decision Log

后续执行时必须保留决策日志区，记录：
- 决策时间
- 决策项
- 备选方案
- 选择原因
- 影响范围
- 回滚方式
- 批准人 / 批准状态

当前建议的关键决策如下：
- 先修安全和稳定，再做架构迁移
- 先做纯函数与网络封装的可测化，再碰 UI 结构
- Vuex→Pinia 采用并行过渡，不立即删除 Vuex
- Vue CLI→Vite 采用旁路验证和渐进切换，不立即一刀切
- JS→TS 先从 helper / service / type 定义开始，不直接全量组件改写
- Docker / CI 先强化可验证性与可回滚性，再升级版本和动作

---

## 10. Atomic Task Checklist Blueprint

以下任务为建议的执行账本结构。当前阶段仅保留为规划项；**不表示已经开始实施**。

### P0 Safety / Stability

#### [x] P0-00 盘点仓库现状与关键入口
- 目标：先建立真实仓库表面清单，再谈基线冻结
- 依赖：无
- 覆盖范围：
  - `package.json`
  - `Dockerfile`
  - `start.sh`
  - `public/conf/config.js`
  - `public/index.html`
  - `.github/workflows/docker-build-release.yml`
  - 主要入口文件
- 实施步骤：
  1. 盘点当前构建、启动、发布、运行时配置的真实路径
  2. 列出关键入口文件与配置入口
  3. 明确当前镜像 tag 策略与回滚锚点候选
- 验收标准：
  - 已明确当前构建 / 启动 / 发布路径
  - 不存在未覆盖的关键入口文件
  - 形成可复述的现状盘点清单
- 回滚说明：
  - 规划阶段不进入实施；若后续发现盘点不完整，先补盘点，不进入代码变更
- 复杂度 / 风险：低 / 低

#### [x] P0-01 建立现状基线与回滚锚点
- 目标：冻结当前可用基线，明确后续所有变更的比较对象
- 依赖：P0-00 完成
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/README.md`
  - `/Users/li/Desktop/GitHub/subweb/package.json`
  - `/Users/li/Desktop/GitHub/subweb/Dockerfile`
  - `/Users/li/Desktop/GitHub/subweb/public/conf/config.js`
- 实施步骤：
  1. 记录当前分支、提交、构建方式、运行方式
  2. 汇总 runtime config、Docker、发布流程、核心用户路径
  3. 定义 rollback anchor 为当前镜像 tag / 当前提交
- 验收标准：
  - 已形成现状基线清单
  - 已明确当前构建 / 启动 / 发布路径
  - 不存在未覆盖的关键入口文件
- 回滚说明：
  - 规划阶段不进入实施；后续如需回退，以未实施为默认回退状态
- 复杂度 / 风险：低 / 低

#### [x] P0-02a `start.sh` 配置渲染加固
- 目标：降低启动脚本对环境变量替换的脆弱性
- 依赖：P0-01
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/start.sh`
- 实施步骤：
  1. 设计输入约束与异常处理策略
  2. 明确环境变量为空、非法字符、替换失败时的行为
  3. 保留旧默认值作为 fallback
- 验收标准：
  - 空环境变量使用文档化默认值
  - 特殊字符要么被正确保留，要么被明确拒绝
  - 渲染失败时不会生成无效启动状态
- 回滚说明：
  - 恢复之前的 `start.sh` 语义
- 复杂度 / 风险：中 / 中

#### [x] P0-02b `public/conf/config.js` 与 `public/index.html` 的启动注入兜底
- 目标：保证配置 bootstrap 在脚本注入失败或缺省场景下仍有可用默认值
- 依赖：P0-02a
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/public/conf/config.js`
  - `/Users/li/Desktop/GitHub/subweb/public/index.html`
- 实施步骤：
  1. 明确 `window.config` 默认值与注入覆盖顺序
  2. 定义 bootstrap 失败时的 fallback 行为
  3. 保持页面可加载且配置对象可读
- 验收标准：
  - 默认配置可正常读取
  - 注入失败时仍保留有效配置对象
  - bootstrap 行为有明确且可复述的顺序
- 回滚说明：
  - 恢复之前的 `public/conf/config.js` 与 `public/index.html` 注入语义
- 复杂度 / 风险：中 / 中

#### [x] P0-03 统一短链 / 复制 / 校验失败的用户反馈策略
- 目标：让错误、警告、成功反馈一致且可追踪
- 依赖：P0-04 或保持 UI 侧独立，不与网络封装变更同时合并
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/components/notification/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/components/loading/index.js`
- 实施步骤：
  1. 盘点现有提示文案和失败分支
  2. 设计统一错误分级：校验失败、网络失败、复制失败、配置缺失
  3. 保持旧行为兼容，先不改变交互位置
- 验收标准：
  - 至少覆盖四类错误：校验失败、网络失败、复制失败、配置缺失
  - 每类错误有唯一文案或统一错误码映射
  - 主流程不被中断
- 回滚说明：
  - 恢复原有提示逻辑
- 复杂度 / 风险：中 / 低

#### [x] P0-04 处理网络请求封装的基础可靠性
- 目标：让 axios 封装更可预测，为后续服务层迁移打基础
- 依赖：P0-01
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/network/index.js`
- 实施步骤：
  1. 明确请求配置字段、超时、错误形态
  2. 统一成功与失败返回契约
  3. 保持现有调用方无需改动或只做最小改动
- 验收标准：
  - 说明 success shape、failure shape、timeout 行为、非 2xx 处理方式
  - 至少明确一个现有调用方保持兼容
  - 请求失败不会破坏页面主流程
- 回滚说明：
  - 恢复旧 request wrapper，并同步恢复依赖适配层
- 复杂度 / 风险：中 / 中

---

### P1 Vite / Pinia / 渐进 TypeScript

#### [x] P1-01 引入 Vite 迁移评估支架
- 目标：建立 Vite 旁路验证路径，不影响现有构建
- 依赖：
  - P0-00
  - P0-02a
  - P0-02b
  - P0-03
  - P0-04
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/package.json`
  - `/Users/li/Desktop/GitHub/subweb/vue.config.js`
  - `/Users/li/Desktop/GitHub/subweb/jsconfig.json`
- 实施步骤：
  1. 识别与 Vue CLI 绑定的配置项
  2. 列出需要平移到 Vite 的等价能力
  3. 仅规划，不切换默认构建
- 验收标准：
  - 迁移路径明确
  - 默认构建未受影响
  - 规划阶段不要求新增依赖或修改 `package.json`
- 回滚说明：
  - 不启用 Vite，仅保留评估结论
- 复杂度 / 风险：中 / 低

#### [x] P1-02a 纯函数 helper 边界拆分
- 目标：先把可独立验证的 helper 识别出来
- 依赖：P0-04
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/network/index.js`
- 实施步骤：
  1. 确定函数输入输出边界
  2. 区分纯计算逻辑与副作用逻辑
  3. 保持运行时输出不变
- 验收标准：
  - helper 的输入输出边界被文档化
  - 纯逻辑与副作用逻辑分离清晰
  - 运行时行为保持一致
- 回滚说明：
  - 回退到原始 helper 边界定义
- 复杂度 / 风险：中 / 低

#### [x] P1-02b 纯函数 helper 的类型约束补充
- 目标：在不改行为前提下补充类型约束
- 依赖：P1-02a
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/network/index.js`
- 实施步骤：
  1. 为 helper 增加 JSDoc 或 TS 类型草案
  2. 不改变导入、调用与返回行为
  3. 只收紧可验证边界，不扩大改动面
- 验收标准：
  - 运行时输出与旧实现一致
  - 不改变现有 callers 的调用方式
  - 仅引入类型信息，不引入业务差异
- 回滚说明：
  - 移除类型注释，保留 helper 实现
- 复杂度 / 风险：中 / 低

#### [x] P1-03 明确 Vuex 与 Pinia 的单向主从模型
- 目标：为 Vuex→Pinia 过渡建立清晰的主数据源方向
- 依赖：P0-01
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/store/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/store/modules/app.js`
  - `/Users/li/Desktop/GitHub/subweb/src/store/modules/menu.js`
  - `/Users/li/Desktop/GitHub/subweb/src/store/modules/style.js`
- 实施步骤：
  1. 盘点现有 store 状态职责
  2. 选择单一方向：Vuex 为 source of truth，Pinia 读取适配；或 Pinia 为 source of truth，Vuex 作为 façade
  3. 按模块拆分迁移顺序，而非全局并行
- 验收标准：
  - 明确一个主数据源方向
  - 至少有一个模块级迁移路径
  - 不出现双写互相竞争的状态源
- 回滚说明：
  - 继续使用原 Vuex 结构，撤销适配层规划
- 复杂度 / 风险：中 / 中

#### [x] P1-04 渐进式引入类型声明与 lint 约束
- 目标：提升静态约束，但不阻塞现有开发
- 依赖：P1-02b、P1-03
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/.eslintrc.js`
  - `/Users/li/Desktop/GitHub/subweb/jsconfig.json`
  - `/Users/li/Desktop/GitHub/subweb/package.json`
- 实施步骤：
  1. 选择最小范围的类型 / 检查规则
  2. 先覆盖 helper / service，再扩展到组件
  3. 避免一次性收紧到不可提交
- 验收标准：
  - 静态检查增强但不引入不可控噪音
  - 不新增阻塞级 lint 失败
  - 允许的告警预算事先明确
- 回滚说明：
  - 降低规则严格度，回到之前的 lint 水平
- 复杂度 / 风险：中 / 中

---

### P2 核心 UX 重设计

#### [ ] P2-00 确认路由、layout 与 feature-flag 插入点
- 目标：在做并行 UI 之前，先确认实际可切换的入口
- 依赖：P1-03
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/router/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/layouts/main/MainLayout.vue`
- 实施步骤：
  1. 确认当前路由结构
  2. 确认 layout 注入位置
  3. 确认可用的切换方式：query flag、route flag、env flag 或别的方式
- 验收标准：
  - 明确至少一种可实现的切换机制
  - 旧界面能作为 fallback
  - 不需要额外新增未批准的路由合约
- 回滚说明：
  - 维持原入口，不启用切换
- 复杂度 / 风险：中 / 低

#### [ ] P2-01a 拆分 SubTable 的数据准备与校验逻辑
- 目标：把表单数据处理从 UI 渲染中隔离出来
- 依赖：P0-03、P1-02b
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/HomeView.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/index.js`
- 实施步骤：
  1. 按输入、校验、转换前准备拆分职责
  2. 保持外部行为一致
  3. 仅分离逻辑，不改交互语义
- 验收标准：
  - 数据准备与校验逻辑可单独复述
  - 转换、短链、复制的 DOM / 交互无回退
  - 不引入新业务规则
- 回滚说明：
  - 恢复原组件边界与 prop / slot 契约
- 复杂度 / 风险：高 / 中

#### [x] P2-01b 拆分 SubTable 的输出与交互逻辑
- 目标：把渲染与动作处理从数据准备中再剥离一层，同时保留现有组件边界、DOM 交互、短链请求、dialog/store 与 runtime config 合约不变

- 依赖：P2-01a

- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/HomeView.vue`

- 实施步骤：
  1. 分离结果展示、按钮动作、提示反馈
  2. 维持现有用户行为
  3. 不改变对外接口

- 验收标准：
  - 转换、短链、复制三条主路径无回退
  - 输出层逻辑可独立维护
  - 不新增隐藏状态

- 回滚说明：
  - 恢复原组件单文件结构

- 复杂度 / 风险：高 / 中

#### [ ] P2-02 建立新旧 UX 并行切换机制
- 目标：允许新界面逐步上线，而不是直接覆盖旧界面
- 依赖：P2-00、P2-01b
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/router/index.js`
  - `/Users/li/Desktop/GitHub/subweb/src/layouts/main/MainLayout.vue`
- 实施步骤：
  1. 定义切换入口
  2. 保留旧界面作为 fallback
  3. 设计可回退的路由或开关机制
- 验收标准：
  - 新旧路径都能打开
  - 切换机制可复述且可回退
  - 不引入新的权限或登录语义
- 回滚说明：
  - 切回旧路由或旧入口
- 复杂度 / 风险：中 / 中

#### [ ] P2-03a 重做输入与结果区域的信息架构
- 目标：改善表单、校验、结果展示的可读性和操作效率
- 依赖：P2-01a、P2-01b
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/components/dialog/...`
- 实施步骤：
  1. 梳理信息优先级
  2. 优先解决高频任务：粘贴、转换、短链、复制
  3. 保留原行为与结果
- 验收标准：
  - 新布局不引入新业务规则
  - 关键任务路径更清晰
  - 无功能倒退
- 回滚说明：
  - 退回原布局
- 复杂度 / 风险：中 / 中

#### [ ] P2-03b 交互与文案微调
- 目标：在信息架构稳定后再做细粒度体验优化
- 依赖：P2-03a
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/components/notification/index.js`
- 实施步骤：
  1. 优化提示文案
  2. 调整交互反馈节奏
  3. 维持原功能语义
- 验收标准：
  - 仅做体验优化，不引入新业务规则
  - 反馈一致、清晰
  - 可回退到原文案与交互
- 回滚说明：
  - 恢复旧文案和旧交互节奏
- 复杂度 / 风险：中 / 低

---

### P3 新产品特性

#### [ ] P3-01 新增配置 / 模板管理能力的产品化评估
- 目标：评估是否将现有 runtime config 扩展为可管理能力
- 依赖：独立产品批准，不自动并入现代化主线
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/public/conf/config.js`
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
- 实施步骤：
  1. 确定哪些配置可以产品化
  2. 明确默认值、覆盖规则、回退方式
  3. 保持原默认配置兼容
- 验收标准：
  - 业务目标已单独批准
  - 明确是 admin-only、local-only 还是 runtime-editable
  - 现有默认配置不受影响
- 回滚说明：
  - 回到 `window.config` 默认值，不启用产品化能力
- 复杂度 / 风险：中 / 中

#### [ ] P3-02a 定义短链 / 分享载荷边界
- 目标：先定义分享数据、短链数据和复制数据的边界
- 依赖：P2-01b
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/network/index.js`
- 实施步骤：
  1. 定义分享 / 复制 / 短链的差异
  2. 明确哪些字段进入 payload
  3. 固定向后兼容格式
- 验收标准：
  - 载荷边界清晰
  - 与现有短链格式兼容
  - 不引入新的存储依赖
- 回滚说明：
  - 关闭新载荷格式，保留旧短链响应
- 复杂度 / 风险：中 / 中

#### [ ] P3-02b 短链生成与分享 UI 接入
- 目标：把已定义的载荷接入生成与展示路径
- 依赖：P3-02a
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/src/views/home/SubTable.vue`
  - `/Users/li/Desktop/GitHub/subweb/src/network/index.js`
- 实施步骤：
  1. 接入短链生成
  2. 接入复制 / 分享按钮
  3. 保持错误兜底与兼容性
- 验收标准：
  - 旧短链接口保持兼容
  - 分享路径可单独关闭
  - 错误兜底明确
- 回滚说明：
  - 退回现有短链逻辑
- 复杂度 / 风险：中 / 中

---

### P4 CI / Container / Release

#### [x] P4-01 升级构建与发布链路的可重复性
#### [x] P4-01a 冻结依赖安装
#### [x] P4-01b 构建输入加固
#### [x] P4-02 优化容器运行时安全与可维护性
#### [x] P4-03 收敛 Docker build context 与 COPY 边界
- 目标：排除本地状态和无关输入，明确构建与运行时所需文件

- 允许文件：`.dockerignore`、`Dockerfile`、必要时 workflow context 行
- 禁止范围：应用代码、依赖图、基础镜像、tag、registry、runtime config 语义、provenance/SBOM、promotion
- 验收标准：排除 `.claude/`、`node_modules/`、`dist/`、日志和编辑器状态；保留构建所需 package/lock/source 和运行时 `start.sh`/配置模板；npm ci/build/diff 检查通过
- 回滚说明：删除 `.dockerignore` 并恢复 Dockerfile/workflow 的 context 相关改动

#### [x] P4-04 将 GitHub Actions 固定到不可变 commit SHA
- 目标：消除 workflow action mutable tag 风险

- 允许文件：`.github/workflows/docker-build-release.yml`
- 禁止范围：Dockerfile、运行时、registry、tag、trigger、依赖
- 依赖：P4-03
- 验收标准：每个第三方 action 使用已核验 commit SHA；workflow 结构和发布行为不变
- 回滚说明：恢复 action 引用到 P4-03 前状态

#### [x] P4-05 捕获镜像 digest 与发布身份
- 目标：为每次构建记录不可变镜像身份及 source/build 元数据

- 允许文件：`.github/workflows/docker-build-release.yml`
- 禁止范围：应用代码、registry 迁移、tag 删除、运行时行为
- 依赖：P4-04
- 验收标准：记录 Git SHA、workflow run、tag、digest、平台和构建时间；Docker Hub/Harbor 目标不变
- 回滚说明：移除身份捕获步骤，恢复原发布步骤

#### [x] P4-06 生成 provenance、SBOM 与 attestation
- 目标：为发布镜像生成供应链证明

- 允许文件：`.github/workflows/docker-build-release.yml`
- 禁止范围：Dockerfile runtime、应用代码、registry、tag 命名
- 依赖：P4-05
- 验收标准：发布构建生成并关联 provenance/SBOM/attestation；失败策略明确；运行时不变
- 回滚说明：移除证据生成和对应权限/配置

#### [x] P4-07 按 digest 进行 immutable artifact promotion
- 目标：构建一次并按不可变 digest 推送/提升到现有 registry，同时保留兼容 tag

- 允许文件：`.github/workflows/docker-build-release.yml`
- 禁止范围：凭据、registry 目标、应用运行时、build context
- 依赖：P4-05、P4-06
- 验收标准：promotion 以 digest 为锚；latest 不再是唯一发布/回滚依据；现有 tag 兼容
- 回滚说明：恢复原 tag-based 发布路径

#### [x] P4-07a 生成滚动发布前置校验与回退证据
- 目标：为 promotion 结果提供可核对、可回退的机器可读证据

- 允许文件：`.github/workflows/docker-build-release.yml`
- 禁止范围：应用代码、依赖、registry 布局、运行时行为
- 依赖：P4-07
- 验收标准：记录 source/destination digest、source commit、workflow run、tag、platforms、build time；失败时不静默继续
- 回滚说明：移除新增证据步骤，恢复仅发布身份摘要

#### [x] P4-08 生成正式 rollback manifest
- 目标：记录 tag、digest、Git SHA、workflow run、平台和基础输入，形成可执行回滚证据

- 允许文件：workflow；若需新增 manifest 文件，须在实施前确认其格式
- 禁止范围：应用代码、依赖、registry 布局、运行时行为
- 依赖：P4-07
- 验收标准：每次发布生成可追踪 manifest，能够定位具体 digest 和 source commit
- 回滚说明：移除 manifest 生成，恢复人工回滚记录

#### [x] P4-09 P4 发布控制验证
- 目标：验证 P4-03 至 P4-08 的静态合同和失败阻断行为

- 允许文件：workflow 及现有计划/文档记录
- 禁止范围：应用功能、Docker runtime、发布目标扩展
- 依赖：P4-03、P4-04、P4-05、P4-06、P4-07、P4-07a、P4-08
- 验收标准：验证 action pin、context、digest、provenance/SBOM、promotion 和 rollback identity；失败不能静默发布
- 回滚说明：恢复验证前 workflow gate

- 依赖：P0-01
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/.github/workflows/docker-build-release.yml`
  - `/Users/li/Desktop/GitHub/subweb/Dockerfile`
- 实施步骤：
  1. 盘点旧 action / 旧 base image 风险
  2. 定义可重复构建策略
  3. 保持现有发布目标不变
- 验收标准：
  - action 版本锁定策略明确
  - tag 策略可重复且可追踪
  - `latest` 不是唯一回滚边界
  - release 触发条件清晰
- 回滚说明：
  - 保留旧 workflow 作为回退基线，必要时按指定版本 tag 回退
- 复杂度 / 风险：中 / 中

#### [x] P4-02 优化容器运行时安全与可维护性（执行记录见上方）
- 依赖：P0-01、P0-02a、P0-02b、P4-01
- 可能文件：
  - `/Users/li/Desktop/GitHub/subweb/Dockerfile`
  - `/Users/li/Desktop/GitHub/subweb/start.sh`
- 实施步骤：
  1. 明确 build / runtime 分层目标
  2. 识别可升级项和不可触碰项
  3. 保持启动行为兼容
- 验收标准：
  - 容器启动可预测
  - env 注入与配置语义不变
  - 镜像来源与版本可追踪
  - 不改变 public API 或 config 语义
- 回滚说明：
  - 恢复现有 Dockerfile 与 `start.sh`
- 复杂度 / 风险：中 / 中

---

## 11. Sequence Recommendation

推荐执行顺序：
1. P0-00
2. P0-01
3. P0-02a
4. P0-02b
5. P0-04
6. P0-03
7. P1-01
8. P1-02a
9. P1-02b
10. P1-03
11. P1-04
12. P2-00
13. P2-01a
14. P2-01b
15. P2-02
16. P2-03a
17. P2-03b
18. P3-01
19. P3-02a
20. P3-02b
21. P4-01
22. P4-01a
23. P4-01b
24. P4-02
25. P4-03
26. P4-04
27. P4-05
28. P4-06
29. P4-07
30. P4-07a
31. P4-08
32. P4-09

理由：
- 先补仓库现状盘点，再冻结基线
- 先把运行时和发布风险压住
- 再建立迁移支架
- 再做可见的 UX 重构
- 再加产品能力
- 最后收敛 CI / 容器 / 发布体系

---

## 12. Necessary Deviations Protocol

任何偏离都必须按以下顺序处理：
1. 停止当前原子任务
2. 在进度日志中标记为 `[!]`
3. 记录偏离原因、影响范围、回滚点
4. 请求用户批准是否扩大 scope 或调整顺序
5. 未获批前不得继续实施偏离内容

补充硬规则：
- 只要任务要求新增文件、依赖升级、新路由、新 API 合约或新构建目标，就必须重新拆分并单独批准
- 规划阶段若发现任务无法在单一风险面内闭合，应退回重新拆解

---

## 13. Checklist Artifact Usage Rule

后续真正执行时，必须遵守：
- 每完成一个原子任务，立即更新进度日志
- 记录状态、验证结果、回滚状态、是否阻塞
- 然后暂停并询问是否继续下一个原子任务
- 进度日志是唯一执行账本，不能依赖口头记忆
- 若任务跨阶段，必须拆成新的原子任务，不得合并跳过验证

本文件即为唯一执行账本；除非用户明确批准，不另建并行计划文件。

---

## 14. Recommended Validation Backbone

由于仓库当前无 test script，后续计划应优先补齐“最小验证骨架”，但需按原子任务拆分推进。建议验证顺序：
- 构建验证：`npm run build`
- 代码质量：`npm run lint`
- 容器验证：`docker build ...`、`docker run ...`
- 配置验证：检查 `conf/config.js` 注入结果
- 主路径手工验证：转换、短链、复制
- 兼容性验证：旧配置、旧路由、旧发布路径

注意：
- 上述命令仅作为后续执行阶段的验证骨架，不代表当前规划阶段已经执行
- 规划阶段只需定义验证方法，不需实际跑通命令

---

### Critical Files for Implementation
- /Users/li/Desktop/GitHub/subweb/package.json
- /Users/li/Desktop/GitHub/subweb/Dockerfile
- /Users/li/Desktop/GitHub/subweb/start.sh
- /Users/li/Desktop/GitHub/subweb/public/conf/config.js
- /Users/li/Desktop/GitHub/subweb/.github/workflows/docker-build-release.yml