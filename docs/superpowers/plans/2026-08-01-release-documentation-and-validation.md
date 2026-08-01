# 发布文档、运维与最终验收实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 使 README、四种部署文档、架构/安全/运维文档、实际命令和发布门禁完全一致，并用可执行证据而不是文字承诺判定是否可宣称“正式支持”。

**架构：** README 只做入口，`docs/deployment.md` 只做四方式索引，每种部署有独立文档。共享配置、架构、安全、运维、来源和界面规范单独维护。`verify-release.sh` 聚合静态、单元、浏览器、容器、本机和平台证据状态。

**技术栈：** Markdown、Vitest 文档契约、POSIX shell、Docker/Redis 运维脚本、GitHub Actions、现有 Vue/Vite/Playwright 验证。

---

## 任务 1：先建立文档与实现一致性契约

**文件：**
- 新建：`tests/project/documentation.spec.js`
- 新建：`scripts/verify-docs.mjs`
- 修改：`package.json`

- [ ] **步骤 1：先写失败的文档结构测试**

  断言以下文件全部存在并从 README 可达：

  ```text
  docs/architecture.md
  docs/configuration.md
  docs/deployment.md
  docs/deployment-local.md
  docs/deployment-docker.md
  docs/deployment-railway.md
  docs/deployment-render.md
  docs/security.md
  docs/operations.md
  docs/third-party-sources.md
  docs/interface-design.md
  docs/remote-config-sources.md
  docs/maintenance.md
  ```

  测试还要解析相对 Markdown 链接，确认目标存在；检查 README 只列出本机源码、Docker、Railway、Render 四个正式入口，不出现 Caddy、Vercel、Cloudflare Pages、Netlify、Fly.io 的支持宣称。

- [ ] **步骤 2：先写变量和命令一致性测试**

  从 `.env.example`、`scripts/configure.sh --help`、Compose 解析结果、Railway 变量契约、Render Blueprint 和文档中提取变量，断言公开核心变量始终是 `APP_DOMAIN` / `API_DOMAIN`，秘密始终是 `MYURLS_API_TOKEN` / Redis 连接秘密，不存在文档自创但代码不读取的别名。

  对以下命令断言文档与文件权限同时存在：

  ```sh
  ./scripts/configure.sh
  ./scripts/validate-compose.sh
  ./scripts/local/bootstrap.sh
  ./scripts/local/start.sh
  ./scripts/local/status.sh
  ./scripts/local/stop.sh
  ./scripts/verify-release.sh
  ```

- [ ] **步骤 3：先写来源、固定和秘密禁止测试**

  断言 README 和 `docs/third-party-sources.md` 同时说明 `stilleshan/subweb` Fork 起点、`keleyaa/MyUrls` 及 `CareyWang/MyUrls` 原始来源、`Aethersailor/SubConverter-Extended` 官方上游、设计参考边界和各许可证。生产命令不使用 `latest`，所有示例 secret 都是明确占位值或平台生成指令。

- [ ] **步骤 4：运行测试并确认红灯**

  ```sh
  npm test -- tests/project/documentation.spec.js
  ```

  预期：因新文档未存在、旧 README 仍宣称独立前端而失败。

- [ ] **步骤 5：实现文档校验器并接入 npm**

  `scripts/verify-docs.mjs` 导出 `verifyDocs({ root })`，一次列出断链、未知变量、不存在命令、未固定生产镜像和秘密模式命中；不打印本地 `.env` 内容。在 `package.json` 增加：

  ```json
  "verify:docs": "node scripts/verify-docs.mjs"
  ```

  此时测试仍应红灯，因为文档尚未重写。

- [ ] **步骤 6：提交文档门禁骨架**

  ```sh
  git add tests/project/documentation.spec.js scripts/verify-docs.mjs package.json
  git commit -m "test: define documentation consistency contracts"
  ```

## 任务 2：重写 README、架构、配置和来源文档

**文件：**
- 修改：`README.md`
- 新建：`docs/architecture.md`
- 修改：`docs/configuration.md`
- 新建：`docs/third-party-sources.md`
- 修改：`docs/remote-config-sources.md`
- 修改：`docs/interface-design.md`

- [ ] **步骤 1：把 README 收缩为真实入口**

  README 顺序固定为：项目定位 → Fork/来源 → 一体化架构摘要 → 默认展示域名与两域名替换 → 四种部署入口 → 开发质量命令 → 文档索引 → 许可证。

  Docker 最短快速开始只使用可重复命令：

  ```sh
  ./scripts/configure.sh --mode behind-proxy \
    --app-domain example.com --api-domain api.example.com
  ./scripts/validate-compose.sh
  docker compose up -d --build --wait
  ```

  Railway/Render 只在对应真实证据文档存在且通过门禁时标记“已验证”，否则标记“设计中，不属于当前正式支持”。

- [ ] **步骤 2：写清仓库/服务/信任边界**

  `docs/architecture.md` 必须包含：

  - Subweb 发行仓库与两个独立上游的责任矩阵；
  - APP/API Host 路由、`/short-api/short` 鉴权注入、短码跳转和前端回退的优先级；
  - Docker/本机/Railway/Render 四种模式的入口、TLS 责任和私网边界；
  - 订阅 URL、MyUrls Token、Redis 秘密和前端公开配置的数据流；
  - Redis 是唯一业务持久数据，其他服务均可重建。

- [ ] **步骤 3：用真实变量重写配置文档**

  `docs/configuration.md` 分开：两个部署者公开域名变量、派生的浏览器 `apiUrl/shortUrl`、内部 upstream、秘密、本机端口、平台变量引用、远程配置预设。对每个字段写类型、默认值、是否公开、由谁生成、重启是否生效和轮换影响。

  明确说明：`ml1.one` / `api.ml1.one` 是维护者展示值，普通部署必须运行 configure 写自己域名，不能无配置复用展示短链创建入口。

- [ ] **步骤 4：完整记录开源来源和变更边界**

  `docs/third-party-sources.md` 从 `deploy/versions.lock.json` 引用当前 tag/commit/digest，对 Subweb Fork、MyUrls Fork/独立维护、SubConverter 官方引用、Redis/Nginx 镜像、远程配置预设分别记录来源 URL、许可证、是否修改源码、更新策略和验证日期。

  `docs/interface-design.md` 更新为已落地 Luminous Focus 规范，明确 Apple Design/MyUrls 是原则和家族一致性参考，不代表复制代码、DOM、图形资产或商标。

- [ ] **步骤 5：运行定向文档检查并提交**

  ```sh
  npm test -- tests/project/documentation.spec.js
  npm run verify:docs
  git add README.md docs/architecture.md docs/configuration.md docs/third-party-sources.md docs/remote-config-sources.md docs/interface-design.md
  git commit -m "docs: explain the integrated architecture and sources"
  ```

  预期：链接/来源部分通过；因部署细分文档尚未全部存在，整体门禁仍可保持红灯。

## 任务 3：交付四种部署的完整操作手册

**文件：**
- 修改：`docs/deployment.md`
- 新建：`docs/deployment-local.md`
- 新建：`docs/deployment-docker.md`
- 新建：`docs/deployment-railway.md`
- 新建：`docs/deployment-render.md`

- [ ] **步骤 1：把总部署文档改为决策索引**

  `docs/deployment.md` 用一张矩阵说清：Docker `behind-proxy` 适合已有宝塔/1Panel/Nginx/OpenResty/Cloudflare Tunnel；Docker `direct-tls` 适合已有合法证书且 80/443 可用；本机源码适合开发/验证；Railway/Render 由平台提供 TLS/私网。明确 Caddy 不是依赖，已有外层代理与默认 loopback 模式不冲突。

- [ ] **步骤 2：写本机源码手册**

  `deployment-local.md` 对 macOS 和 Debian/Ubuntu 分别给出“用户手动执行”的依赖安装命令，说明 WSL2 支持和原生 Windows 不支持。内容必须包含：前置条件、四个最短命令、已有 checkout 变量、缓存/运行目录、默认/自定义端口、状态、日志、停止、重新 bootstrap、数据保留、升级、回滚、验证清单和端口冲突/依赖缺失/健康失败排查。

- [ ] **步骤 3：写 Docker 两模式手册**

  `deployment-docker.md` 分章说明：

  - `behind-proxy` 最短命令、只绑 `127.0.0.1:18080`、通用 Nginx 两 Host 转发示例，以及宝塔/1Panel 面板中两站点指向同一 upstream 的操作字段；
  - `direct-tls` 的 DNS、80/443、SAN 证书、绝对路径、只读挂载、私钥权限、续期后 `nginx -t` + graceful reload，以及项目不申请/续期证书；
  - 通用的变量、状态、日志、停止、更换域名、轮换秘密、备份/恢复、升级/回滚、安全验证和故障排查。

  示例不使用“把端口改为 `0.0.0.0` 直接上公网”作生产快速方案。

- [ ] **步骤 4：写 Railway 和 Render 平台手册**

  两文档都包含：账户/计费前置、四 Service 映射、从锁定 digest 创建、私网变量引用、自动生成/手动输入的变量、先平台域名后双自定义域名、TLS、状态、日志、暂停/删除、备份责任、升级、回滚、验证清单和计费/区域/私网错误。

  Railway 明确 Compose 只映射为 Service，`depends_on` 无平台等价；Render 明确 Blueprint `sync: false` 只在初次创建提示、不支持字符串插值，Key Value 使用 `connectionString` 与 MyUrls `rediss://` 能力。

- [ ] **步骤 5：验证文档结构绿灯并提交**

  ```sh
  npm test -- tests/project/documentation.spec.js
  npm run verify:docs
  git add docs/deployment.md docs/deployment-local.md docs/deployment-docker.md docs/deployment-railway.md docs/deployment-render.md
  git commit -m "docs: add four complete deployment runbooks"
  ```

## 任务 4：实现 Redis 备份、恢复、升级和回滚运维脚本

**文件：**
- 新建：`scripts/operations/backup-redis.sh`
- 新建：`scripts/operations/verify-redis-backup.sh`
- 新建：`scripts/operations/restore-redis.sh`
- 新建：`scripts/operations/preflight-upgrade.sh`
- 新建：`tests/operations/redisOperations.spec.js`
- 新建：`docs/operations.md`
- 新建：`docs/security.md`

- [ ] **步骤 1：先写 fake Docker 运维失败测试**

  覆盖：

  - backup 在 Redis 不 healthy、输出文件已存在、目标目录权限过宽时拒绝；
  - backup 用容器内 `redis-cli` 认证生成 RDB，复制到权限 `0600` 的宿主机文件，不在命令参数/stdout 显示 Redis 密码；
  - verify 在隔离的临时 Redis 容器加载备份并检查 key/TTL 统计，不输出 key 名和 URL 值；
  - restore 要求 `--backup "$backup_file" --confirm-stop-writes`，其中 `$backup_file` 必须是已存在的绝对路径；先停 gateway/myurls，再备份当前数据，验证新 RDB，替换后启动 Redis/MyUrls/gateway 并跑健康；任一步失败恢复原数据并保持创建入口关闭；
  - preflight 解析当前/目标 `deploy/versions.lock.json`，Redis 主版变更时必须有已验证备份和显式确认，不允许新主版写入后盲目用旧主版重用数据目录。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/operations/redisOperations.spec.js
  ```

- [ ] **步骤 3：实现不泄密的运维脚本**

  所有脚本先 `umask 077`，用临时文件和 `trap` 清理，通过 Compose exec 容器环境获得认证而不把密码放进宿主机命令行。只操作当前 Compose project 的 `redis/myurls/gateway-*`，不匹配或删除其他 Docker 资源。

- [ ] **步骤 4：写操作与安全手册**

  `docs/operations.md` 包含状态/日志、备份/校验/恢复演练、域名更换、Token/Redis 密码轮换、证书续期 reload、锁定产物升级、业务/镜像/Redis 回滚、Railway/Render 备份责任和故障排查。每个操作都写前置条件、命令、预期、验证和失败恢复。

  `docs/security.md` 包含威胁边界、端口暴露、鉴权注入、日志脱敏、CSP/HSTS 责任、秘密生命周期、镜像/digest/SBOM/provenance、远程配置信任边界和事故响应。明确 Base64 不是加密。

- [ ] **步骤 5：用临时全栈做真实备份/恢复演练**

  在专用 Compose project 创建一个短链，备份并校验，删除对应 Redis key，恢复备份，再访问旧短码。演练后删除临时 project/备份文件，不操作任何实际部署数据。

- [ ] **步骤 6：绿灯并提交**

  ```sh
  npm test -- tests/operations/redisOperations.spec.js
  npm run verify:docs
  git add scripts/operations tests/operations docs/operations.md docs/security.md
  git commit -m "feat: add redis recovery and upgrade runbooks"
  ```

## 任务 5：实现发布聚合验证和证据状态

**文件：**
- 新建：`scripts/verify-release.sh`
- 新建：`scripts/verify-evidence.mjs`
- 新建：`tests/project/releaseGate.spec.js`
- 修改：`package.json`
- 修改：`.github/workflows/docker-build-release.yml`
- 修改：`docs/maintenance.md`

- [ ] **步骤 1：先写三档发布状态失败测试**

  `verify-evidence.mjs` 必须返回每个部署方式的状态：

  - `verified`：证据包含当前锁定 digest、当前 schema、新建/功能/持久性/日志/升级/回滚全部通过；
  - `designed`：配置和静态契约通过，但缺真实平台证据；
  - `failed`：有证据但 digest 过期、必需项失败或证据格式非法。

  Docker 和本机在正式发布必须 `verified`；Railway/Render 只有 README 标记已验证时才必须 `verified`，标记设计中时允许 `designed` 但不允许 `failed`。

- [ ] **步骤 2：先写聚合命令顺序测试**

  使用 fake PATH 断言 `verify-release.sh` 依次执行：

  ```text
  npm ci
  npm audit --audit-level=moderate
  npm run verify
  npm run test:e2e
  npm run verify:locks
  npm run verify:compose
  npm run verify:railway
  npm run verify:render
  npm run verify:docs
  scripts/verify-container.sh
  scripts/verify-integrated-stack.sh --mode behind-proxy
  scripts/verify-integrated-stack.sh --mode direct-tls
  scripts/verify-evidence.mjs
  ```

  任一命令失败立即非零退出并保留明确阶段名；不继续发布。平台验证不在每次本地发布重新写平台，而是校验已获取的当前 digest 证据。

- [ ] **步骤 3：运行定向测试并确认红灯**

  ```sh
  npm test -- tests/project/releaseGate.spec.js
  ```

- [ ] **步骤 4：实现聚合门禁和 CI 阻断**

  `package.json` 增加：

  ```json
  "verify:release": "./scripts/verify-release.sh"
  ```

  CI 发布 job 在镜像构建推送前执行非重复的所有门禁，并使 quality/integration/evidence job 都成功为 release 的 `needs`。工作流不读取本地 `.env`，使用临时合成域名/秘密。

- [ ] **步骤 5：更新维护文档并提交**

  `docs/maintenance.md` 说明分支/审查/门禁/锁定更新/工作树清理/远端核对/最小推送边界，以及“文档和测试是必需项目文件，运行数据和生成物不是”。

  ```sh
  npm test -- tests/project/releaseGate.spec.js
  npm run verify:docs
  git add scripts/verify-release.sh scripts/verify-evidence.mjs tests/project/releaseGate.spec.js package.json .github/workflows/docker-build-release.yml docs/maintenance.md
  git commit -m "ci: enforce release evidence and documentation gates"
  ```

## 任务 6：最终严格审查、清洁和推送准备

**文件：**
- 可能修改：本计划中任何经验证发现不一致的文件
- 不新建：不为了“显示通过”生成虚假报告

- [ ] **步骤 1：执行全套发布验证**

  ```sh
  npm run verify:release
  ```

  必须保存当次退出码和各阶段摘要。不使用历史上一次通过代替当前工作树验证。

- [ ] **步骤 2：做独立安全/正确性审查**

  审查重点：Host/路径路由优先级、鉴权覆盖、订阅日志脱敏、秘密传播、私网/端口暴露、证书失败路径、停止脚本所有权、Redis 恢复失败原子性、PaaS 证据真实性、UI 剪贴板失败状态和文档命令可复制性。

- [ ] **步骤 3：审查工作树和追踪集合**

  ```sh
  git status --short
  git diff --check
  git ls-files | sort
  git check-ignore -v .env .runtime/local/pids/example.pid dist/index.html test-results/example.txt
  git remote -v
  git branch -vv
  ```

  确认未追踪集合没有需要保留的用户文件，已追踪集合没有 `.env`、`.runtime`、证书/私钥、Redis 数据、构建/测试输出、下载上游源码或平台本地凭据。

- [ ] **步骤 4：检查提交边界和远端**

  ```sh
  git log --oneline --decorate origin/main..HEAD
  git diff --stat origin/main...HEAD
  git diff --name-status origin/main...HEAD
  ```

  确认所有 commit 都属于 Subweb 一体化任务，没有 MyUrls 工作树文件或其他仓库内容；`origin` 仍是 `keleyaa/subweb`。

- [ ] **步骤 5：在用户授权后才推送**

  本计划不自动获得推送授权。用户明确同意后，先 `git fetch --prune origin`，确认远端未出现新分叉，再用显式分支推送：

  ```sh
  git push origin "HEAD:$(git branch --show-current)"
  ```

  推送后比对本地 HEAD 与远端分支 SHA，确保一致。

## 本计划审查门禁

- [ ] README 简洁，细节进独立文档；四种部署都有前置、最短命令、变量、DNS/TLS、启停、日志、升级、备份、恢复、回滚、验证和排错。
- [ ] Fork、原始来源、当前维护仓库、上游引用、设计参考、许可证和修改边界全部可追溯。
- [ ] 备份经过隔离校验，恢复经过真实短链演练，Redis 主版升级有明确不可盲目回用数据目录的边界。
- [ ] 发布状态由当前 digest 证据决定，无真实 Railway/Render 证据时不宣称正式支持。
- [ ] 最终工作树没有秘密、运行数据、构建/测试输出、证书、上游源码副本或平台本地凭据。
- [ ] 推送前明确核对 `origin`、当前分支、提交集和 diff 文件集，推送后本地/远端 SHA 一致。
