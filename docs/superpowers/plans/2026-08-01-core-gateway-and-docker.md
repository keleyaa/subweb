# 统一网关与 Docker 全栈实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 交付锁定上游产物、只公开一个 Nginx web-gateway、两个互斥 Docker 入口模式、Redis 持久化和可重复的全链路验证。

**架构：** 当前 Subweb 生产镜像扩展为 gateway 镜像；一个 Compose 文件定义 `gateway-http` / `gateway-tls` 互斥 profile 和共享的 `subconverter` / `myurls` / `redis`。Nginx 按 Host 区分 APP/API，按精确优先级区分静态资源、短链创建和短码跳转。构建镜像不包含秘密，容器启动时再生成含内部 Token 的 Nginx 配置。

**技术栈：** Docker Compose v2、Nginx unprivileged、POSIX shell、Node.js 验证脚本、Vitest、Redis、MyUrls GHCR 镜像、SubConverter-Extended 官方镜像。

---

## 任务 1：建立上游产物锁和契约基线

**文件：**
- 新建：`deploy/versions.lock.json`
- 新建：`deploy/subconverter/README.md`
- 新建：`scripts/verify-version-locks.mjs`
- 新建：`tests/deploy/versionLocks.spec.js`
- 修改：`package.json`

- [ ] **步骤 1：先写锁文件失败测试**

  `tests/deploy/versionLocks.spec.js` 必须覆盖：

  ```js
  expect(lock.schemaVersion).toBe(1);
  expect(Object.keys(lock.services).sort()).toEqual([
    'gatewayBase', 'myurls', 'redis', 'subconverter',
  ]);
  expect(service.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(service.image.reference).not.toMatch(/:latest(?:@|$)/);
  expect(service.source.prerelease).toBe(false);
  ```

  对 MyUrls 还要断言源仓库为 `keleyaa/MyUrls`，对 SubConverter 断言为 `Aethersailor/SubConverter-Extended`；记录 `tag`、`commit`、多架构 manifest digest 和已验证的容器端口。

- [ ] **步骤 2：运行单测并确认红灯**

  ```sh
  npm test -- tests/deploy/versionLocks.spec.js
  ```

  预期：因 `deploy/versions.lock.json` 和校验脚本尚不存在而失败，不是测试语法错误。

- [ ] **步骤 3：从一手来源解析固定版本**

  按以下顺序获取并交叉检查：GitHub Releases/API 的最新非预发布版、发布 tag 对应 commit、镜像仓库 manifest digest、在 `linux/amd64` 与 `linux/arm64` 上的子 digest。运行时使用：

  ```sh
  gh api repos/keleyaa/MyUrls/releases --paginate
  gh api repos/Aethersailor/SubConverter-Extended/releases --paginate
  docker buildx imagetools inspect "$SELECTED_TAGGED_IMAGE"
  docker pull "$SELECTED_DIGEST_IMAGE"
  docker image inspect "$SELECTED_DIGEST_IMAGE"
  ```

  选定后把具体值写入 `deploy/versions.lock.json`，不在 Compose 里重复手写版本。如上游没有官方可用镜像，本任务停在“不满足发行条件”，不自行复制源码补一个未说明来源的镜像。

- [ ] **步骤 4：实现锁文件校验**

  `scripts/verify-version-locks.mjs` 导出并在 CLI 调用 `validateVersionLocks(lock)`，返回所有错误而不是只报第一个。校验规则包括：完整 HTTPS 源地址、完整 40 位 commit、非预发布、非 `latest`、digest 格式、必需平台列表和内部端口范围。

  在 `package.json` 增加：

  ```json
  "verify:locks": "node scripts/verify-version-locks.mjs"
  ```

- [ ] **步骤 5：验证契约和上游最小运行行为**

  对固定镜像分别验证：MyUrls `/healthz`、`POST /short` 的 Bearer 鉴权和 `{Code: 1, ShortUrl}`；SubConverter 的最小 `/sub?target=...` 请求、健康探测和所需配置文件。只把实际确认过的参数写入 `deploy/subconverter/README.md`。

- [ ] **步骤 6：运行绿灯并提交**

  ```sh
  npm test -- tests/deploy/versionLocks.spec.js
  npm run verify:locks
  git add deploy/versions.lock.json deploy/subconverter/README.md scripts/verify-version-locks.mjs tests/deploy/versionLocks.spec.js package.json
  git commit -m "build: lock integrated service artifacts"
  ```

## 任务 2：实现可重复、不泄密的部署配置

**文件：**
- 新建：`scripts/lib/config.sh`
- 新建：`scripts/configure.sh`
- 新建：`scripts/validate-compose.sh`
- 新建：`tests/deploy/configureScript.spec.js`
- 新建：`tests/deploy/composeProfiles.spec.js`
- 修改：`.env.example`
- 修改：`.gitignore`
- 修改：`package.json`

- [ ] **步骤 1：先写 CLI 和秘密保留失败测试**

  在临时目录调用 `scripts/configure.sh`，覆盖：

  ```sh
  ./scripts/configure.sh --mode behind-proxy \
    --app-domain example.com --api-domain api.example.com
  ./scripts/configure.sh --mode direct-tls \
    --app-domain example.com --api-domain api.example.com \
    --tls-cert /absolute/fullchain.pem --tls-key /absolute/privkey.pem
  ```

  断言：

  - 无模式、两个模式、含 scheme/path/port 的域名、APP/API 相同、TLS 路径不是绝对路径都失败；
  - `behind-proxy` 生成 `COMPOSE_PROFILES=behind-proxy`，`direct-tls` 只生成 `COMPOSE_PROFILES=direct-tls`；
  - 两个模式都派生 `API_URL=https://$API_DOMAIN` 和 `SHORT_URL=https://$APP_DOMAIN/short-api`；
  - 首次生成 64 位 hex `MYURLS_API_TOKEN` 和 `REDIS_PASSWORD`，文件权限为 `0600`；
  - 再次配置新域名不改变秘密，只有 `--rotate-secrets` 才会轮换；
  - stdout/stderr 不包含任何生成的秘密。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/deploy/configureScript.spec.js tests/deploy/composeProfiles.spec.js
  ```

  预期：脚本不存在或现有 `.env.example` 缺少新契约导致失败。

- [ ] **步骤 3：实现原子配置写入**

  `scripts/lib/config.sh` 实现纯函数 `validate_domain`、`validate_mode`、`load_existing_secret`、`generate_hex_secret`、`write_env_atomically`。`configure.sh` 先 `umask 077`，写同目录临时文件，完成所有校验后 `mv` 覆盖 `.env`。异常退出时清理临时文件，不损坏旧 `.env`。

  `.env.example` 只保留无敏感值和明确占位符；`.gitignore` 增加 `.runtime/`、`runtime-config/`、`*.pem`、`*.key`、`redis-data/` 及平台 CLI 本地状态目录。

- [ ] **步骤 4：实现 profile 互斥校验**

  `scripts/validate-compose.sh` 必须在执行 `docker compose config --quiet` 前解析 `COMPOSE_PROFILES`，严格要求值只能是单个 `behind-proxy` 或单个 `direct-tls`。它还应使用 `docker compose config --format json` 断言只有一个 gateway 服务含 `ports`，内部三服务不存在发布端口。

  在 `package.json` 增加：

  ```json
  "verify:compose": "./scripts/validate-compose.sh"
  ```

- [ ] **步骤 5：运行绿灯并提交**

  ```sh
  npm test -- tests/deploy/configureScript.spec.js tests/deploy/composeProfiles.spec.js
  git add .env.example .gitignore package.json scripts/lib/config.sh scripts/configure.sh scripts/validate-compose.sh tests/deploy
  git commit -m "feat: add safe integrated deployment configuration"
  ```

## 任务 3：把现有 Nginx 扩展为脱敏 web-gateway

**文件：**
- 新建：`nginx/templates/http.conf.template`
- 新建：`nginx/templates/direct-tls.conf.template`
- 新建：`nginx/snippets/security-headers.conf`
- 新建：`nginx/snippets/proxy-headers.conf.template`
- 新建：`nginx/snippets/app-routes.conf.template`
- 新建：`nginx/snippets/api-routes.conf.template`
- 新建：`scripts/render-gateway-config.sh`
- 新建：`tests/gateway/configRendering.spec.js`
- 新建：`tests/gateway/routingContract.spec.js`
- 新建：`tests/gateway/logPrivacy.spec.js`
- 修改：`Dockerfile`
- 修改：`start.sh`
- 删除：`nginx/default.conf`

- [ ] **步骤 1：先写网关契约失败测试**

  对渲染后配置断言：

  - APP/API 有独立 `server_name`，平台模式共用 `$PORT`；
  - `location = /short-api/short` 先删除客户端 `Authorization`，再设置为内部 `Bearer` Token，只允许 `POST`，请求体上限与 MyUrls 配置一致；
  - 短码只匹配 `^/[A-Za-z0-9_-]{1,64}$`，`/healthz`、`/assets`、`/conf`、`/short-api`、`/favicon.svg`在它之前有精确或前缀路由；
  - API Host 将原路径和原查询参数透传给 SubConverter；
  - `proxy_set_header X-Forwarded-For $remote_addr` 不盲信客户端传入链，Host 和 Proto 使用网关已校验的公开值；
  - `log_format` 只记录 `$request_method $uri $status`，不含 `$request`、`$args`、`$request_uri`、请求体或 Authorization；
  - 不匹配 APP 或 API 的 Host 返回 `421`，不默认送入任何上游。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/gateway/configRendering.spec.js tests/gateway/routingContract.spec.js tests/gateway/logPrivacy.spec.js
  ```

- [ ] **步骤 3：实现受限模板渲染器**

  `scripts/render-gateway-config.sh` 不对整个环境做任意 `envsubst`；它只接受并校验 `APP_DOMAIN`、`API_DOMAIN`、`PUBLIC_SCHEME`、`GATEWAY_PORT`、`SUBCONVERTER_UPSTREAM`、`MYURLS_UPSTREAM`、`MYURLS_API_TOKEN`、`MYURLS_MAX_BODY_BYTES` 和 TLS 绝对路径。Token 格式限制为 32–256 位 `[A-Za-z0-9._~-]`，防止向 Nginx 指令注入。输出先写 `$rendered_config` 临时文件，`nginx -t -c "$rendered_config"` 成功后原子替换。

- [ ] **步骤 4：实现 HTTP、平台端口和自备证书 TLS**

  - `behind-proxy`：容器监听 `8080`，不设 HSTS；
  - `platform`：监听 `0.0.0.0:$PORT`，不在容器内终止 TLS；
  - `direct-tls`：容器监听 `8080` 做 HTTPS 跳转、`8443 ssl`提供 HTTPS 并设 HSTS，宿主机映射 `80:8080` / `443:8443`。

  `start.sh` 在 `direct-tls` 下用 `openssl x509 -checkhost` 同时校验 APP/API 域名，用公钥指纹校验证书和私钥配对，检查容器用户可读且其他用户不可写。所有错误只说文件类型和域名，不输出私钥内容。

- [ ] **步骤 5：更新镜像运行边界**

  `Dockerfile` 保留 Node 多阶段构建和非 root Nginx，只在最终阶段增加证书校验所需的固定 OpenSSL 包、网关模板和启动脚本。定义 Nginx 需要的 `tmpfs` 路径，使之可在 Compose 的 `read_only: true` 下运行。

- [ ] **步骤 6：运行单测、Nginx 语法并提交**

  ```sh
  npm test -- tests/gateway
  docker build --check .
  docker build -t subweb-gateway:test .
  docker run --rm subweb-gateway:test nginx -t
  git add Dockerfile start.sh nginx scripts/render-gateway-config.sh tests/gateway
  git commit -m "feat: route integrated services through nginx gateway"
  ```

## 任务 4：实现两个互斥 Compose profile 和服务健康

**文件：**
- 修改：`compose.yaml`
- 新建：`deploy/redis/redis.conf.template`
- 新建：`deploy/subconverter/config/`
- 新建：`tests/deploy/composeStack.spec.js`
- 修改：`tests/build/dockerRuntime.spec.js`
- 修改：`scripts/verify-container.sh`

- [ ] **步骤 1：先把旧单容器契约改成全栈失败测试**

  用 `docker compose --env-file "$test_env_file" config --format json` 解析而不是字符串猜测 YAML。断言：

  - 共享服务恰好为 `redis`、`myurls`、`subconverter`；每个都使用 `deploy/versions.lock.json` 解析出的带 digest 镜像；
  - `behind-proxy` 只启用 `gateway-http` 并绑定 `127.0.0.1:18080`；
  - `direct-tls` 只启用 `gateway-tls` 并绑定宿主机 `80/443`；
  - Redis 有持久卷，三个内部服务都没有 `ports`；
  - 依赖使用 `condition: service_healthy`，四个逻辑服务都有有上限的健康检查；
  - 能力默认全部 drop，文件系统只读，只挂载明确数据卷/配置/证书路径和必需 tmpfs。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/deploy/composeStack.spec.js tests/build/dockerRuntime.spec.js
  ```

- [ ] **步骤 3：重写权威 Compose**

  使用 YAML extension `x-gateway-common` 保证两个 gateway 的镜像、环境、依赖、安全和健康契约一致。MyUrls 环境至少包含：

  ```yaml
  MYURLS_PORT: "8080"
  MYURLS_DOMAIN: "${APP_DOMAIN}"
  MYURLS_PROTO: "https"
  MYURLS_REDIS_CONN: "redis:6379"
  MYURLS_REDIS_PASSWORD: "${REDIS_PASSWORD}"
  MYURLS_API_TOKEN: "${MYURLS_API_TOKEN}"
  ```

  Redis 用进程参数或只读生成配置启用密码和 AOF/RDB，健康检查必须认证后 `PING`。SubConverter 只挂载任务 1 已验证的最小覆盖，关闭不必要的上传和管理入口。

- [ ] **步骤 4：更新容器验证脚本**

  `scripts/verify-container.sh` 从“前端镜像烟测”保留为单镜像契约：非 root、只读运行、健康、公开 `config.js` 只含 API/short 公开地址、响应头完整。全栈验证放到下一任务，不把两类失败混在一个脚本。

- [ ] **步骤 5：验证两个 profile 配置并提交**

  ```sh
  ./scripts/configure.sh --mode behind-proxy --app-domain app.test --api-domain api.app.test
  ./scripts/validate-compose.sh
  npm test -- tests/deploy/composeStack.spec.js tests/build/dockerRuntime.spec.js
  git add compose.yaml deploy tests/deploy/composeStack.spec.js tests/build/dockerRuntime.spec.js scripts/verify-container.sh
  git commit -m "feat: orchestrate the pinned integrated docker stack"
  ```

## 任务 5：验证功能、隐私、持久性和 TLS 拒绝路径

**文件：**
- 新建：`scripts/verify-integrated-stack.sh`
- 新建：`scripts/test-support/create-test-certificate.sh`
- 新建：`tests/integration/gatewayStack.spec.js`
- 新建：`tests/integration/privacySentinel.spec.js`
- 新建：`docs/validation/docker-integration.md`

- [ ] **步骤 1：先写可选 Docker 集成契约**

  Vitest 通过 `RUN_DOCKER_INTEGRATION=1` 才运行容器级用例，未设置时明确 skip，不伪造通过。用例必须包含：

  1. APP Host 返回 Subweb，API Host 转发最小 SubConverter 请求；
  2. 客户端伪造 `Authorization` 被覆盖，无内部 Token 也能经 gateway 成功创建；
  3. 创建的 ShortUrl 域名等于 APP 域名，GET 短码返回目标地址；
  4. 重启 `myurls` 和 `redis` 后短码仍可访问；
  5. 宿主机无法连接 MyUrls/SubConverter/Redis 内部端口；
  6. 唯一哨兵串未出现在 gateway/MyUrls/SubConverter/Redis 日志。

- [ ] **步骤 2：实现带清理陷阱的验证脚本**

  `scripts/verify-integrated-stack.sh` 使用独立 Compose project name 和临时 `.env`，注册 `trap` 只执行该 project 的 `docker compose down --volumes`，不删除用户其他容器/卷。它用随机哨兵订阅 URL，执行后只在终端输出“哨兵泄漏数=0”，不回显哨兵值。

- [ ] **步骤 3：验证 `behind-proxy`**

  ```sh
  RUN_DOCKER_INTEGRATION=1 npm test -- tests/integration/gatewayStack.spec.js tests/integration/privacySentinel.spec.js
  ./scripts/verify-integrated-stack.sh --mode behind-proxy
  ```

  预期：四服务 healthy，六项契约全部通过，不占用宿主机 `80/443`。

- [ ] **步骤 4：验证 `direct-tls` 成功与四类失败**

  `create-test-certificate.sh` 只在临时目录为 `app.test` / `api.app.test` 创建 SAN 自签证书。分别断言：正常证书可启动并完成 HTTPS；缺证书、私钥不匹配、证书不覆盖 API 域名、宿主机 `80` 或 `443` 被占用时都在对外服务前失败。

  ```sh
  ./scripts/verify-integrated-stack.sh --mode direct-tls
  ```

- [ ] **步骤 5：写入无秘密证据并提交**

  `docs/validation/docker-integration.md` 记录镜像 digest、两模式、验证日期、命令退出码、平台架构和失败类型，不提交证书、Token、Redis 密码、哨兵 URL 或完整容器日志。

  ```sh
  git add scripts/verify-integrated-stack.sh scripts/test-support tests/integration docs/validation/docker-integration.md
  git commit -m "test: verify integrated docker behavior and privacy"
  ```

## 任务 6：把核心门禁接入 CI

**文件：**
- 修改：`.github/workflows/docker-build-release.yml`
- 修改：`tests/build/dockerRuntime.spec.js`
- 修改：`package.json`

- [ ] **步骤 1：先更新 CI 源码契约测试**

  测试断言 quality job 依次包含 `npm run verify:locks`、`npm run verify:compose`、单镜像验证、两 profile 全栈验证、E2E、npm audit 和 Trivy；release job 仍在 quality 后运行，且产出 digest/SBOM/provenance/回滚清单。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/build/dockerRuntime.spec.js
  ```

- [ ] **步骤 3：更新 CI，避免发布未验证全栈镜像**

  CI 为每次验证生成临时域名和秘密，使用 GitHub 托管 runner 的 Docker；清理只限定 Compose project。不把临时 `.env`、证书和日志上传为 artifact。任何全栈契约失败都阻止镜像发布。

- [ ] **步骤 4：全套验证并提交**

  ```sh
  npm run verify
  npm run verify:locks
  npm run verify:compose
  npm run test:e2e
  ./scripts/verify-container.sh subweb-gateway:verify
  ./scripts/verify-integrated-stack.sh --mode behind-proxy
  ./scripts/verify-integrated-stack.sh --mode direct-tls
  git add .github/workflows/docker-build-release.yml package.json tests/build/dockerRuntime.spec.js
  git commit -m "ci: gate releases on integrated stack verification"
  ```

## 本计划审查门禁

- [ ] 网关访问日志不包含 query/body/Authorization，用真实哨兵请求扫描证明。
- [ ] 前端 bundle 和 `/conf/config.js` 只有公开 APP/API URL，没有 MyUrls Token/Redis 密码。
- [ ] 两个 profile 同时启用在启动容器前失败，没有端口争用才报错的窗口。
- [ ] 只有 gateway 有宿主机端口，`behind-proxy` 只绑定 loopback，`direct-tls` 不使用 root 绑定容器低端口。
- [ ] 所有生产镜像带 digest，锁文件能追溯 tag、commit、源仓库和已验证平台。
- [ ] Redis 重启后短链仍可用，测试结束后无本项目残留容器、网络、卷或敏感临时文件。
