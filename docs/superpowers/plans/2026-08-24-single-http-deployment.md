# Single HTTP Deployment 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans（逐任务实现此计划）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Docker 部署收敛为固定三域名、单一 HTTP Gateway 方案，由外部代理负责反向代理和 TLS。

**架构：** Compose 只运行一个名为 `gateway` 的 HTTP 服务，绑定 `127.0.0.1:${SUBWEB_PORT:-18080}:8080`。配置脚本要求 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN`，Gateway 始终渲染唯一 HTTP 模板；保留 APP 旧短链跳转兼容，不再生成 Legacy 或 Direct-TLS 部署。

**技术栈：** POSIX shell、Docker Compose、Nginx 模板、Node/Vitest、Docker 集成脚本和 Markdown 部署文档。

---

### 任务 1：锁定单一部署契约的失败测试

**文件：**
- 修改：`tests/deploy/configureScript.spec.js`
- 修改：`tests/deploy/dockerImageDeploy.spec.js`
- 修改：`tests/deploy/composeProfiles.spec.js`
- 修改：`tests/deploy/composeStack.spec.js`
- 修改：`tests/build/dockerRuntime.spec.js`
- 修改：`tests/runtime/startScript.spec.js`
- 修改：`tests/gateway/configRendering.spec.js`
- 修改：`tests/integration/gatewayStack.spec.js`

- [ ] **步骤 1：重写配置 CLI 测试输入**

将共享参数改为：

```js
const deploymentArgs = [
  '--app-domain', 'example.com',
  '--api-domain', 'api.example.com',
  '--short-domain', 'short.example.com',
];
```

新增断言：缺少 `--short-domain`、传入 `--mode`、`--tls-cert` 或 `--tls-key` 均在创建 `.env` 前失败；成功 `.env` 不包含 `COMPOSE_PROFILES`、`DOMAIN_MODE`、TLS 路径或 Gateway 模式变量。

- [ ] **步骤 2：重写 Compose 和镜像部署测试**

测试 fixture 只渲染 `gateway` 服务：

```js
expect(Object.keys(config.services).sort()).toEqual(
  ['gateway', 'myurls', 'redis', 'subconverter'].sort(),
);
expect(config.services.gateway.ports).toEqual([
  expect.objectContaining({ host_ip: '127.0.0.1', published: '19080', target: 8080 }),
]);
```

删除两个 profile、TLS 端口、证书挂载和双 Gateway 的断言，并让镜像部署 fixture 只接受不带 `--mode` 的命令行。

- [ ] **步骤 3：重写 Gateway 启动和渲染测试**

固定环境只使用 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN`、MyUrls/SubConverter upstream 和秘密；断言 renderer 使用 HTTP 模板、端口 `8080`，启动前不会调用 OpenSSL，渲染结果包含三个 server 且不包含 `listen 8443`、TLS 证书或 `Strict-Transport-Security`。

- [ ] **步骤 4：运行失败测试确认旧实现被锁定**

运行：

```sh
npx vitest run tests/deploy/configureScript.spec.js tests/deploy/dockerImageDeploy.spec.js tests/deploy/composeProfiles.spec.js tests/deploy/composeStack.spec.js tests/build/dockerRuntime.spec.js tests/runtime/startScript.spec.js tests/gateway/configRendering.spec.js --maxWorkers=1
```

预期：新断言因现有 `--mode`、两个 Compose gateway 和 Direct-TLS 分支仍存在而失败。

---

### 任务 2：实现固定 HTTP 配置、Compose 和部署 CLI

**文件：**
- 修改：`scripts/configure.sh`
- 修改：`scripts/docker-deploy.sh`
- 修改：`scripts/lib/config.sh`
- 修改：`scripts/validate-compose.sh`
- 修改：`compose.yaml`
- 修改：`Dockerfile`
- 修改：`start.sh`
- 修改：`scripts/verify-container.sh`
- 修改：`scripts/verify-redis-operations.sh`
- 修改：`scripts/operations/restore-redis.sh`

- [ ] **步骤 1：简化配置脚本参数和环境文件**

删除 `--mode`、`--tls-cert`、`--tls-key` 解析及 Direct-TLS 分支；三个域名改为必填并验证互不相同。生成环境只写：

```dotenv
APP_DOMAIN=...
API_DOMAIN=...
SHORT_DOMAIN=...
API_URL=https://...
SHORT_URL=https://.../short-api
```

保留秘密、镜像覆盖和轮换逻辑。

- [ ] **步骤 2：合并 Compose Gateway 服务**

将 `gateway-http`/`gateway-tls` 合并为 `gateway`，固定环境和端口：

```yaml
gateway:
  image: "${SUBWEB_IMAGE:-subweb:local}"
  environment:
    APP_DOMAIN: "${APP_DOMAIN:?Set APP_DOMAIN with scripts/configure.sh}"
    API_DOMAIN: "${API_DOMAIN:?Set API_DOMAIN with scripts/configure.sh}"
    SHORT_DOMAIN: "${SHORT_DOMAIN:?Set SHORT_DOMAIN with scripts/configure.sh}"
  ports:
    - "127.0.0.1:${SUBWEB_PORT:-18080}:8080"
```

删除 profiles、TLS 环境、证书 volumes 和宿主机 `80`/`443` 映射；保留健康依赖、loopback 绑定、只读文件系统和内部服务无 ports。

- [ ] **步骤 3：固定 renderer/startup/runtime 契约**

让 `scripts/render-gateway-config.sh` 只加载 `nginx/templates/http.conf.template`，固定 HTTP 监听和 HTTPS 公共 URL；移除 Direct-TLS 模板选择、TLS 文件检查和 `openssl` 启动校验。`start.sh` 只执行配置渲染和 Nginx 启动。Dockerfile 只暴露 `8080`，健康检查固定使用 HTTP `8080/healthz`。

- [ ] **步骤 4：更新内部运维脚本**

将容器名从 `gateway-http`/`gateway-tls` 收敛为 `gateway`，删除 profile 参数和证书环境；Redis 运维恢复、容器验证和 compose 校验只检查一个 Gateway。

- [ ] **步骤 5：运行契约测试确认通过**

运行任务 1 的 Vitest 命令，预期所有配置、Compose、启动和渲染测试通过。

---

### 任务 3：删除 Direct-TLS 分支并统一真实集成验证

**文件：**
- 删除：`nginx/templates/direct-tls.conf.template`
- 修改：`scripts/verify-integrated-stack.sh`
- 修改：`tests/integration/gatewayStack.spec.js`
- 修改：`tests/integration/privacySentinel.spec.js`
- 修改：`scripts/verify-release.sh`
- 修改：`package.json`
- 修改：`tests/project/releaseGate.spec.js`
- 修改：`docs/validation/docker-integration.md`

- [ ] **步骤 1：把集成 verifier 改为单一命令**

将用法从 `--mode behind-proxy|direct-tls` 改为无参数运行：生成三域名环境，启动 `gateway`，验证 APP/API/SHORT、MyUrls UI、multipart `/short`、CORS API、旧 APP 兼容入口、Redis 持久性和内部端口未发布。删除证书 SAN、端口占用和 TLS 拒绝分支。

- [ ] **步骤 2：统一 npm 和发布门禁**

将 package scripts 和 release stages 合并为单个：

```json
"verify:integration": "./scripts/verify-integrated-stack.sh"
```

删除两个旧 integration script 名称及其对应的 release-gate 断言。

- [ ] **步骤 3：运行真实集成失败/通过检查**

先运行：

```sh
sh -n scripts/verify-integrated-stack.sh
npx vitest run tests/integration/gatewayStack.spec.js tests/integration/privacySentinel.spec.js tests/project/releaseGate.spec.js --maxWorkers=1
```

实现后运行：

```sh
npm run verify:integration
```

预期：真实 MyUrls、Redis、SubConverter 和单一 HTTP Gateway 全链路通过，日志无 Token/订阅哨兵泄漏。

---

### 任务 4：收敛文档与公开命令

**文件：**
- 修改：`README.md`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/configuration.md`
- 修改：`docs/architecture.md`
- 修改：`docs/security.md`
- 修改：`docs/operations.md`
- 修改：`docs/maintenance.md`
- 修改：`docs/validation/docker-integration.md`
- 修改：`docs/implementation-status-three-domain.md`
- 修改：`docs/three-domain-documentation-guide.md`
- 修改：`docs/prd-three-domain-separation.md`

- [ ] **步骤 1：统一部署命令和反代说明**

所有用户文档只保留：

```sh
./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com
```

反代说明只保留三个 HTTPS vhost 指向 `http://127.0.0.1:18080`，明确证书和 HTTPS 跳转由用户自己的入口处理。

- [ ] **步骤 2：清理过期模式文案和契约**

用 `rg` 扫描当前文档和脚本，删除正式操作路径中的 `direct-tls`、`behind-proxy`、`COMPOSE_PROFILES`、TLS 路径和 Legacy/双域名部署命令；历史 PRD 若保留，明确标记为已被单一 HTTP 设计取代，不作为当前操作手册。

- [ ] **步骤 3：验证文档契约**

运行：

```sh
npm run verify:docs
git diff --check
```

预期：文档验证通过，用户可从 README 直接复制唯一部署命令。

---

### 任务 5：全量验证和提交

**文件：** 任务 1-4 中列出的文件。

- [ ] **步骤 1：运行质量门禁**

运行：

```sh
npm test
npm run lint
npm run build
npm run verify:compose
npm run verify:docs
```

预期：所有测试、Lint、构建、Compose 和文档检查通过。

- [ ] **步骤 2：检查最终差异和残留模式**

运行：

```sh
git diff --check
git status --short
rg -n "direct-tls|behind-proxy|gateway-tls|gateway-http|TLS_CERT_PATH|TLS_KEY_PATH|COMPOSE_PROFILES" README.md docs scripts tests compose.yaml Dockerfile package.json
```

预期：只剩历史说明中明确标记的迁移背景，不再有可执行的双模式命令、profile 或 Direct-TLS 代码路径。

- [ ] **步骤 3：提交**

```sh
git add Dockerfile README.md compose.yaml docs nginx package.json scripts start.sh tests
git commit -m "refactor(deploy): simplify to single HTTP gateway"
```
