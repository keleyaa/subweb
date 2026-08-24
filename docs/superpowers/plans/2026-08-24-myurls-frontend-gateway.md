# MyUrls Frontend Gateway Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（逐任务实现此计划）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 通过 Subweb Gateway 在 `SHORT_DOMAIN` 暴露 MyUrls 前端，并安全代理其短链创建请求。

**架构：** 保持 Docker 只发布 Gateway 端口。短链域名的 HTML、静态资源和 `POST /short` 都由 Gateway 根据 Host 路由到私有 `myurls:8080`；Gateway 注入 Token、限制 Origin 和请求体，`/<shortKey>` 继续作为只读跳转入口。

**技术栈：** Nginx 模板、POSIX shell 配置渲染、Docker Compose、Vitest、真实 Nginx Docker 集成测试。

---

### 任务 1：锁定 Gateway 路由行为

**文件：**
- 修改：`tests/gateway/routingContract.spec.js`
- 修改：`tests/gateway/configRendering.spec.js`
- 修改：`tests/gateway/contentTypeNginx.spec.js`

- [ ] **步骤 1：编写失败测试**

增加静态契约断言，要求 `short-routes.conf.template` 包含精确 `/`、`/app.js`、`/styles.css`、`/fonts/...` 和 `POST /short` 路由；要求 `POST /short` 包含短域 Origin 校验、multipart Content-Type 校验、Token 覆盖和 `/short` upstream；同时要求 fallback 仍为 404。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx vitest run tests/gateway/routingContract.spec.js tests/gateway/configRendering.spec.js tests/gateway/contentTypeNginx.spec.js --maxWorkers=1`

预期：新断言失败，因为当前短域名根路由直接 `return 404`，且没有 `/short` UI 代理契约。

- [ ] **步骤 3：记录真实 Nginx 集成请求**

在 `contentTypeNginx.spec.js` 的已有 Gateway fixture 中增加 MyUrls UI fixture 响应和请求断言：允许 `Origin: https://short.example.test` 的 multipart `POST /short`，拒绝 `Origin: https://evil.example.test`，拒绝 `application/json`（该新 UI 路由只接受 multipart/form-data），并确认上游只收到单个 `Authorization: Bearer <token>`。

- [ ] **步骤 4：运行测试确认仍失败**

运行同一 Vitest 命令；预期静态和集成断言仍因生产模板未修改而失败。

### 任务 2：实现短链域名 MyUrls UI 代理

**文件：**
- 修改：`nginx/snippets/short-routes.conf.template`
- 修改：`nginx/snippets/content-type-map.conf`
- 修改：`nginx/templates/http.conf.template`
- 修改：`nginx/templates/direct-tls.conf.template`
- 修改：`scripts/render-gateway-config.sh`

- [ ] **步骤 1：增加 Origin 与请求体映射**

在 Gateway `http` 配置中增加短域 UI Origin map；保留现有 APP-domain map 给 `/short-api/short`，不要用一个 map 放宽两个接口的策略。

在 Content-Type map 中增加仅供 UI `/short` 使用的 multipart/form-data 匹配，允许 boundary 参数；不改变 `$short_content_type_allowed` 的既有 JSON/form-urlencoded 白名单。

- [ ] **步骤 2：增加 MyUrls UI 路由**

在短域路由模板中加入：

```nginx
location = / {
  proxy_set_header Authorization "";
  proxy_pass $myurls_upstream$request_uri;
}

location = /app.js { ... }
location = /styles.css { ... }
location ^~ /fonts/ { ... }

location = /short {
  if ($myurls_ui_origin_allowed = 0) { return 403; }
  if ($request_method != POST) { return 405; }
  if ($myurls_ui_content_type_allowed = 0) { return 415; }
  client_max_body_size @@MYURLS_MAX_BODY_BYTES@@;
  proxy_set_header Authorization "";
  proxy_set_header Proxy-Authorization "";
  proxy_set_header Authorization "Bearer @@MYURLS_API_TOKEN@@";
  proxy_pass $myurls_upstream/short$is_args$args;
}
```

所有 UI/static proxy 路由都使用现有短域 proxy headers；`/short` 只代理到 MyUrls 的精确 `/short` 路径。

- [ ] **步骤 3：只在三域名模式生成短域 UI server**

保留 `scripts/render-gateway-config.sh` 的 `DOMAIN_MODE` 分支：短域 server 只在 `three-domain` 生成，legacy 模式继续使用 APP server 的原有 UI/兼容路由。将短域 Origin map 的 `SHORT_DOMAIN` 值通过现有安全替换流程渲染到两种 Nginx 模板。

- [ ] **步骤 4：运行定向测试确认通过**

运行：`npx vitest run tests/gateway/routingContract.spec.js tests/gateway/configRendering.spec.js tests/gateway/contentTypeNginx.spec.js --maxWorkers=1`

预期：所有定向路由、渲染和真实 Nginx 请求测试通过。

### 任务 3：验证 Compose 与真实浏览器路径

**文件：**
- 修改：`tests/integration/gatewayStack.spec.js`
- 修改：`docs/deployment-docker.md`
- 修改：`README.md`

- [ ] **步骤 1：增加三域名集成哨兵**

在现有三域名集成验证中加入短域 `GET /`、`GET /app.js`、允许 Origin 的 `POST /short` 和恶意 Origin 403；保留现有短码创建、跳转、APP 兼容入口和内部端口拒绝检查。

- [ ] **步骤 2：更新部署文档**

说明三域名 Docker 部署需要将 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 三个外层站点都反代到同一个 `127.0.0.1:${SUBWEB_PORT:-18080}`；补充短域根页是 MyUrls 前端、短码是跳转入口、未知路径返回 404。

- [ ] **步骤 3：运行完整验证**

运行：`npm test -- --maxWorkers=1`

运行：`npm run lint && npm run build`

运行：`RUN_DOCKER_INTEGRATION=1 npx vitest run tests/gateway/contentTypeNginx.spec.js tests/integration/gatewayStack.spec.js --maxWorkers=1`

预期：退出码为 0，所有测试通过，构建成功。

- [ ] **步骤 4：检查敏感信息与差异**

运行：`git diff --check && git diff --stat && rg -n 'MYURLS_API_TOKEN|Authorization' nginx tests docs | head -80`

确认 Token 只存在模板占位符/测试环境变量中，不出现在文档、静态资源或测试输出中。

### 任务 4：提交实现

**文件：** 任务 1-3 中列出的文件。

- [ ] **步骤 1：查看最终差异**

运行：`git status --short && git diff --check && git diff --stat`

- [ ] **步骤 2：提交**

```sh
git add nginx scripts tests docs README.md
git commit -m "feat(gateway): expose MyUrls frontend on short domain"
```
