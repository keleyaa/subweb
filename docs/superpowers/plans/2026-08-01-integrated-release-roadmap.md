# Subweb 一体化发行总路线实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把当前独立 Subweb 前端扩展为可重复部署的 Subweb + SubConverter-Extended + MyUrls + Redis 一体化发行，同时完成 Luminous Focus 界面精修和四种部署方式。

**架构：** `keleyaa/subweb` 只负责发行编排、Nginx web-gateway、前端、测试和文档；MyUrls 和 SubConverter-Extended 继续独立发布。所有公网流量先进 web-gateway，内部服务只走容器或平台私网。实施按“产物锁定 → 网关与 Docker → 本机源码 → PaaS → UI → 文档与发布”串行通过审查门禁。

**技术栈：** Vue 3.5、Vite 8、Vitest 4、Playwright 1.62、Nginx unprivileged、Docker Compose v2、POSIX shell、Redis、Railway、Render Blueprint。

---

## 规格与执行边界

- 规格来源：`docs/superpowers/specs/2026-08-01-integrated-stack-and-interface-design.md`。
- 不向 Subweb 复制 MyUrls 或 SubConverter-Extended 源码，不增加 Git submodule。
- 生产引用必须是非预发布 tag/commit + 镜像 digest；`latest` 只能出现在“不可重复”的反例说明中。
- 只公开 web-gateway；MyUrls、SubConverter 和 Redis 不发布宿主机或 PaaS 公网端口。
- 秘密只允许在本地 `.env`、平台 Secret/Variable 或进程环境；不写入 Git、前端 `config.js`、构建参数、镜像层或验证报告。
- 展示域名保留 `ml1.one` / `api.ml1.one`；一般部署只输入 `APP_DOMAIN` / `API_DOMAIN`。
- Docker 只支持 `behind-proxy` 与 `direct-tls`；不引入 Caddy 或内置 ACME 客户端。
- Railway 和 Render 未完成真实新建、升级、重启持久性和回滚验证前，README 必须标记为“设计中”而不是“正式支持”。

## 子计划与严格顺序

### 任务 1：建立可回滚基线

**文件：**
- 验证：`package-lock.json`、`compose.yaml`、`.github/workflows/docker-build-release.yml`
- 新建：`docs/validation/integration-baseline.md`

- [ ] **步骤 1：记录当前源码与工作树**

  ```sh
  git status --short --branch
  git log -3 --oneline --decorate
  git remote -v
  ```

  预期：实施分支上只有本计划文档的已知变更，远端仍是 `keleyaa/subweb`。任何其他未知变更先停止并审查归属，不清理用户文件。

- [ ] **步骤 2：执行现有基线验证**

  ```sh
  npm ci
  npm run verify
  npm run test:e2e
  npm audit --audit-level=moderate
  docker compose config --quiet
  ```

  预期：每条命令退出码为 `0`；若 Docker 当时不可用，在 `docs/validation/integration-baseline.md` 记录“未执行及原因”，不写成通过。

- [ ] **步骤 3：保存无敏感信息的基线摘要**

  `docs/validation/integration-baseline.md` 只记录日期、commit SHA、Node/npm/Docker 版本、命令、退出码和失败分类；不粘贴环境变量、域名 DNS 凭据、Token 或订阅 URL。

- [ ] **步骤 4：提交基线**

  ```sh
  git add docs/validation/integration-baseline.md
  git commit -m "test: record integration baseline"
  ```

### 任务 2：执行网关与 Docker 核心计划

**计划：** `docs/superpowers/plans/2026-08-01-core-gateway-and-docker.md`

- [ ] 按计划完成上游产物锁定、域名派生、秘密生成、Nginx Host/路径路由、鉴权注入和脱敏日志。
- [ ] 分别运行 `behind-proxy` 与 `direct-tls` 的 Compose 契约和实例验证。
- [ ] 审查点：确认只有一个 gateway profile 生效，内部服务无 `ports:`，哨兵订阅串未出现在日志。

### 任务 3：执行本机源码运行计划

**计划：** `docs/superpowers/plans/2026-08-01-local-source-runtime.md`

- [ ] 实现 macOS/Linux/WSL2 的依赖检查、固定源码缓存、启动、状态和停止。
- [ ] 用真实进程通过默认端口、自定义端口、端口冲突、中途失败回收和 Redis 持久性验证。
- [ ] 审查点：`stop.sh` 只停止 PID 记录且命令特征匹配的本项目进程，不存在 `pkill`、`killall` 或宽泛端口清理。

### 任务 4：执行 PaaS 计划

**计划：** `docs/superpowers/plans/2026-08-01-paas-deployments.md`

- [ ] 先在独立 MyUrls 工作区完成 Redis URL/TLS 契约并发布固定镜像；未通过则 Railway/Render 保持“设计中”。
- [ ] 完成 Railway 四 Service 映射和 Render Blueprint，只向 gateway 绑定公网域名。
- [ ] 在获得用户对平台写入和 DNS 修改的授权后，执行两个平台的新建、升级、重启、日志脱敏和回滚验证。
- [ ] 审查点：没有真实平台证据时，不放宽文档措辞。

### 任务 5：执行 Luminous Focus UI 计划

**计划：** `docs/superpowers/plans/2026-08-01-luminous-focus-interface.md`

- [ ] 使用测试先行重构信息层级、结果状态、剪贴板失败和短链流程。
- [ ] 在桌面/移动、浅色/深色、减少动态/透明度和增强对比模式下进行浏览器验证。
- [ ] 审查点：页面只有一个主玻璃面，未转换时没有空结果或短链操作。

### 任务 6：执行文档、运维和发布计划

**计划：** `docs/superpowers/plans/2026-08-01-release-documentation-and-validation.md`

- [ ] 用实际命令和变量名更新 README 及全部运维文档，清理与新架构冲突的旧内容。
- [ ] 执行安全、备份/恢复、升级/回滚、平台和仓库清洁门禁。
- [ ] 审查点：文档中每个“支持”声明都有当次发行证据对应。

## 最终完成门禁

- [ ] `npm ci && npm run verify && npm run test:e2e && npm audit --audit-level=moderate` 全部通过。
- [ ] `./scripts/verify-release.sh` 通过并明确列出 Docker、本机、Railway、Render 的证据状态。
- [ ] `git grep -n` 扫描未发现真实 Token、Redis 密码、订阅哨兵值或下载的上游源码。
- [ ] `git status --short` 只显示本计划预期文件，不包含 `.env`、`.runtime/`、`dist/`、证书、日志、数据卷、Playwright 输出或平台本地状态。
- [ ] 独立代码审查确认实现与规格、锁定文件、测试和文档一致。
- [ ] 只在用户明确授权对正确远端推送后，再运行 `git push`。
