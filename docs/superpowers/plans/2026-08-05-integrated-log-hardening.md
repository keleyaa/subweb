# Subweb 集成日志与时区加固实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不改变业务接口的情况下统一中国时区、隐藏短码、减少健康检查噪音并限制容器日志增长。

**架构：** Nginx 负责公开边界的路径归一化，Compose 负责跨服务时区与日志驱动策略，MyUrls 仓库负责其内部访问日志。已发布镜像继续通过摘要锁定。

**技术栈：** Vite、Vitest、Nginx、Docker、Docker Compose、Shell

---

### 任务 1：Gateway 短码日志脱敏

**文件：**
- 修改：`tests/gateway/logPrivacy.spec.js`
- 修改：`nginx/templates/http.conf.template`
- 修改：`nginx/templates/direct-tls.conf.template`
- 修改：`deploy/local/nginx.conf.template`

- [ ] **步骤 1：编写失败测试**，要求日志使用 `$privacy_route`，存在短码映射，并禁止原始 `$uri` 作为日志字段。
- [ ] **步骤 2：运行 `npm test -- --run tests/gateway/logPrivacy.spec.js`，确认当前模板失败。**
- [ ] **步骤 3：为三套 Nginx 模板添加安全路由 `map` 和 ISO 8601 时间字段。**
- [ ] **步骤 4：重新运行目标测试确认通过。**

### 任务 2：跨服务时区与日志轮转

**文件：**
- 修改：`tests/build/dockerRuntime.spec.js`
- 修改：`compose.yaml`
- 修改：`Dockerfile`

- [ ] **步骤 1：编写失败测试**，要求所有服务继承 `TZ=Asia/Shanghai` 和 `json-file` 轮转锚点。
- [ ] **步骤 2：运行目标测试确认当前 Compose 与镜像缺少契约。**
- [ ] **步骤 3：添加公共环境与日志锚点，Gateway 镜像安装 `tzdata` 并设置 `TZ`。**
- [ ] **步骤 4：运行 Compose 验证与 Gateway 镜像构建。**

### 任务 3：文档和集成隐私契约

**文件：**
- 修改：`docs/security.md`
- 修改：`docs/operations.md`
- 修改：`docs/architecture.md`
- 修改：`tests/project/documentation.spec.js`

- [ ] **步骤 1：编写失败文档契约测试**，要求说明短码敏感性、时区、轮转、健康检查降噪和禁止 verbose。
- [ ] **步骤 2：运行文档测试确认缺少说明。**
- [ ] **步骤 3：更新文档，使说明与实际日志字段完全一致。**
- [ ] **步骤 4：运行 `npm run verify`、`npm run verify:compose`、`npm run verify:docs`。**
