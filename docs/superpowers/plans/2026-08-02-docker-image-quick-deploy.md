# Docker 镜像快速部署实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 提供不在服务器本地构建 Gateway、可通过单条脚本命令启动完整多容器栈的 Docker 镜像部署方式。

**架构：** 继续复用权威 `compose.yaml`，由配置脚本持久化 Gateway 镜像引用，由快速部署脚本按“配置、校验、拉取、无构建启动”的顺序执行。Redis、MyUrls 和 SubConverter 仍使用现有 digest 锁定镜像。

**技术栈：** POSIX shell、Docker Compose v2、Vitest、现有配置与文档门禁。

---

### 任务 1：定义镜像配置契约

**文件：**
- 修改：`tests/deploy/configureScript.spec.js`
- 修改：`scripts/lib/config.sh`
- 修改：`scripts/configure.sh`

- [x] 编写镜像写入、保留、重复参数和非法引用的失败测试。
- [x] 运行 `npm test -- tests/deploy/configureScript.spec.js`，确认因 `--subweb-image` 尚不存在而失败。
- [x] 实现最小镜像引用校验与原子写入逻辑。
- [x] 重跑定向测试并确认通过。

### 任务 2：实现无构建快速部署脚本

**文件：**
- 创建：`tests/deploy/dockerImageDeploy.spec.js`
- 创建：`scripts/docker-deploy.sh`

- [x] 用伪 Docker CLI 编写拉取、启动顺序和失败停止测试。
- [x] 运行定向测试，确认脚本缺失导致失败。
- [x] 实现参数转发、依赖检查、Compose 校验、镜像拉取和 `--no-build` 启动。
- [x] 重跑定向测试并确认通过。

### 任务 3：补齐 Compose 与文档契约

**文件：**
- 修改：`tests/deploy/composeStack.spec.js`
- 修改：`tests/project/documentation.spec.js`
- 修改：`README.md`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/configuration.md`
- 修改：`docs/operations.md`

- [x] 先写预构建镜像替换和文档命令失败测试。
- [x] 运行定向测试并确认失败。
- [x] 更新部署、配置、升级和回滚说明，明确 `latest` 与不可变引用的边界。
- [x] 重跑定向测试、文档门禁和 Compose 门禁。

### 任务 4：完整验证

**文件：**
- 修改：`docs/superpowers/plans/2026-08-02-docker-image-quick-deploy.md`

- [x] 运行 `npm test -- tests/deploy/configureScript.spec.js tests/deploy/dockerImageDeploy.spec.js tests/deploy/composeStack.spec.js tests/project/documentation.spec.js`。
- [x] 运行 `npm run verify:compose && npm run verify:docs`。
- [x] 运行 `npm run verify`。
- [x] 检查 `git diff --check` 与 `git status --short`，确认没有 `.env`、容器数据或测试输出被追踪。
- [x] 根据实际执行结果逐项更新本计划复选框。
