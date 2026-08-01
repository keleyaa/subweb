# Railway 与 Render 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不公开内部服务、不把秘密放入构建或 Git 的前提下，交付经真实新建、升级、持久性和回滚验证的 Railway 与 Render 部署。

**架构：** 两个平台都映射为 gateway、subconverter、myurls、Redis/Key Value 四个 Service；只有 gateway 获得公网域名，平台终止 TLS，gateway 在 `$PORT` 接收 HTTP 并经私网访问三个依赖。Railway 不直接运行 Compose；Render 使用 `render.yaml` Blueprint。

**技术栈：** MyUrls Go/go-redis、Railway Services/Variables/Private Networking、Render Blueprint/Private Services/Key Value、Nginx platform 模式、Vitest 配置契约、curl 哨兵验证。

---

## 强制前置门禁：MyUrls Redis URL 与 TLS

当前 MyUrls 只接收 `host:port` + 独立密码，Railway 托管 Redis 和 Render Key Value 均优先提供包含凭据且可能使用 TLS 的 URI。因此任务 1 是两个平台的共同阻断门禁，不能用 shell 拆 URI 规避。

## 任务 1：在独立 MyUrls 仓库发布 Redis URL/TLS 能力

**工作区边界：** 先停止 Subweb 代码修改，切换到独立 `/Users/li/Desktop/GitHub/MyUrls`，在独立 `codex/myurls-redis-url` 分支执行。不在 Subweb 目录复制 MyUrls 文件，不把两仓库一起 stage/commit。

**MyUrls 文件：**
- 修改：`config.go`
- 修改：`config_test.go`
- 新建：`redis_options.go`
- 新建：`redis_options_test.go`
- 修改：`main.go`
- 修改：`runtime_test.go`
- 修改：`.env.example`
- 修改：`README.md`
- 修改：`Dockerfile`、`.github/workflows/*` 中的发布验证（仅在现有流程需要时）

- [ ] **步骤 1：先写 Redis URI 失败测试**

  测试要求：

  ```go
  // 无 URL 时保留旧 host/password 契约。
  require.Equal(t, "redis.internal:6379", options.Addr)
  require.Equal(t, "legacy-secret", options.Password)

  // redis:// 解析用户、密码、主机、DB。
  // rediss:// 必须得到非空 TLSConfig。
  // 未知 scheme、缺 host、超出允许 DB 都失败。
  ```

  `LoadConfig` 还要覆盖 `MYURLS_REDIS_URL`。它存在时明确优先于 `MYURLS_REDIS_CONN` / `MYURLS_REDIS_PASSWORD`；旧变量仍完整兼容。错误和日志不包含 URI 中的用户名/密码。

- [ ] **步骤 2：运行定向测试并确认红灯**

  ```sh
  go test ./... -run 'Test.*(RedisURL|RedisOptions|Runtime)'
  ```

- [ ] **步骤 3：用 go-redis 官方解析器实现**

  `Config` 增加 `RedisURL string`；`BuildRedisOptions(cfg Config) (*redis.Options, error)` 在 URL 非空时调用 `redis.ParseURL`，仅接受 `redis` / `rediss`，对错误返回稳定的“invalid Redis URL”包装，不包装原 URI。无 URL 时返回现有 `Addr/Password/DB:0` 配置。`productionRuntimeDependencies` 通过该函数创建 client，不在 `main.go` 手写第二套解析。

- [ ] **步骤 4：使用真 Redis 验证 `redis://` 和 `rediss://`**

  在临时 Docker network 启动带密码 Redis，再启动一个有 TLS 终止的临时 Redis 实例，分别运行 MyUrls `/healthz`、创建和跳转。清理只删除该测试网络/容器/证书。

- [ ] **步骤 5：全套验证、代码审查和 MyUrls 提交**

  ```sh
  gofmt -w config.go config_test.go redis_options.go redis_options_test.go main.go runtime_test.go
  go test -race ./...
  go vet ./...
  govulncheck ./...
  git status --short
  git add config.go config_test.go redis_options.go redis_options_test.go main.go runtime_test.go .env.example README.md
  git commit -m "feat(config): support redis urls with tls"
  ```

  在 MyUrls 审查通过后按其发布流程创建非预发布 tag 和 GHCR 多架构镜像，记录 tag、commit、manifest digest 与测试结果。未获用户推送/发布授权时，停在本地已验证 commit，不擅自写远端。

- [ ] **步骤 6：回到 Subweb 更新锁定产物**

  切回 `/Users/li/Desktop/GitHub/subweb`，只更新 `deploy/versions.lock.json` 中 MyUrls tag/commit/digest 以及已验证能力 `redisUrlTls: true`，再运行：

  ```sh
  npm run verify:locks
  npm test -- tests/deploy/versionLocks.spec.js
  git add deploy/versions.lock.json
  git commit -m "build: pin myurls redis url release"
  ```

## 任务 2：实现 gateway 的通用 PaaS 运行模式

**文件：**
- 修改：`start.sh`
- 修改：`scripts/render-gateway-config.sh`
- 新建：`tests/gateway/platformRuntime.spec.js`
- 修改：`Dockerfile`

- [ ] **步骤 1：先写 `$PORT` 和私网上游失败测试**

  断言 `GATEWAY_MODE=platform` 时：`PORT` 必须是 1024–65535；`MYURLS_UPSTREAM` / `SUBCONVERTER_UPSTREAM` 可以是已校验的 `http://host:port` 或平台 `host:port`，后者由脚本仅加 `http://`；禁止用户信息、path、query、fragment 和非 HTTP scheme。缺任一值时容器在 Nginx 启动前非零退出。

- [ ] **步骤 2：实现平台渲染和信号传递**

  `start.sh` 在 platform 模式设置公开 scheme 为 `https`，使用 `$PORT`，经 `exec nginx -g 'daemon off;'` 保证 SIGTERM 直达 Nginx。不从 `RAILWAY_*` 或 `RENDER_*` 猜测业务变量，两平台都显式提供相同的 APP/API/upstream/token 契约。

- [ ] **步骤 3：定向验证并提交**

  ```sh
  npm test -- tests/gateway/platformRuntime.spec.js
  docker build -t subweb-gateway:platform-test .
  git add Dockerfile start.sh scripts/render-gateway-config.sh tests/gateway/platformRuntime.spec.js
  git commit -m "feat: run the gateway on paas platform ports"
  ```

## 任务 3：实现可审查的 Railway 服务映射

**文件：**
- 新建：`railway.toml`
- 新建：`deploy/railway/topology.json`
- 新建：`deploy/railway/variables.example`
- 新建：`scripts/verify-railway-topology.mjs`
- 新建：`tests/deploy/railway.spec.js`
- 修改：`package.json`

- [ ] **步骤 1：先写 Railway 拓扑失败测试**

  解析 `topology.json` 并断言恰好四个 Service：`gateway`、`subconverter`、`myurls`、`Redis`。只有 gateway 的 `publicNetworking` 为 `true`，只有 Redis 为 managed database，MyUrls/SubConverter 使用锁文件中的 digest，服务之间只使用 Railway reference variables 和 `*.railway.internal`。

  `variables.example` 必须分为：

  - gateway：`GATEWAY_MODE=platform`、`APP_DOMAIN`、`API_DOMAIN`、两个内部 upstream、生成的 `MYURLS_API_TOKEN`；
  - myurls：`MYURLS_PORT=8080`、`MYURLS_DOMAIN=${{gateway.APP_DOMAIN}}`、`MYURLS_PROTO=https`、`MYURLS_REDIS_URL=${{Redis.REDIS_URL}}`、`MYURLS_API_TOKEN=${{gateway.MYURLS_API_TOKEN}}`；
  - gateway 不保存 Redis URL，SubConverter 不保存 MyUrls Token。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/deploy/railway.spec.js
  ```

- [ ] **步骤 3：实现 Railway 定义和本地校验**

  `railway.toml` 只定义从根 `Dockerfile` 构建 gateway、`/healthz` 健康路径、有界重启和优雅停止；不假装一个文件可以创建整个 Railway project。`topology.json` 是项目自有可审查契约，文档按它在 Dashboard/Compose Import 中创建对应 Service。

  `scripts/verify-railway-topology.mjs` 验证服务集合、公网边界、变量所有者、reference variable 和锁定 digest。`package.json` 增加：

  ```json
  "verify:railway": "node scripts/verify-railway-topology.mjs"
  ```

- [ ] **步骤 4：校验并提交**

  ```sh
  npm test -- tests/deploy/railway.spec.js
  npm run verify:railway
  git add railway.toml deploy/railway scripts/verify-railway-topology.mjs tests/deploy/railway.spec.js package.json
  git commit -m "feat: define the railway private-service topology"
  ```

## 任务 4：实现 Render Blueprint

**文件：**
- 新建：`render.yaml`
- 新建：`scripts/verify-render-blueprint.mjs`
- 新建：`tests/deploy/renderBlueprint.spec.js`
- 修改：`package.json`

- [ ] **步骤 1：先写 Blueprint 失败测试**

  使用 YAML 解析后断言：

  - `gateway` 为唯一 `type: web`、`runtime: docker`的 Service，健康路径 `/healthz`；
  - `myurls` 和 `subconverter` 为 `type: pserv`、`runtime: image`，镜像 URL 包含锁定 digest；
  - `redis` 为 `type: keyvalue`，`ipAllowList: []`，三个数据相关服务在同一 region；
  - gateway 的 `APP_DOMAIN` / `API_DOMAIN` 使用 `sync: false`，MyUrls Token 在 myurls 使用 `generateValue: true` 生成后，gateway 用 `fromService.envVarKey` 引用同一值；
  - MyUrls 的 `MYURLS_REDIS_URL` 用 Key Value `connectionString`，`MYURLS_DOMAIN` 引用 gateway 的 `APP_DOMAIN`；
  - gateway 的两个 upstream 使用 private service `hostport`，不出现公网 URL；
  - 不存在明文 secret 值、`latest` 或 Blueprint 变量插值假设。

- [ ] **步骤 2：添加 YAML 解析器并确认红灯**

  使用锁定 npm 开发依赖 `yaml`，不用正则表达式解析 Blueprint。

  ```sh
  npm install --save-dev --save-exact yaml
  npm test -- tests/deploy/renderBlueprint.spec.js
  ```

  预期：测试因 `render.yaml` 不存在而失败。

- [ ] **步骤 3：实现 Blueprint 与语义校验**

  按 Render 当时官方 Blueprint schema 使用 `type: web/pserv/keyvalue`、`runtime: docker/image`、`fromService`、`connectionString`、`sync: false` 与 `generateValue: true`。由于 Render 不支持 Blueprint 字符串插值，不构造 `https://${APP_DOMAIN}`；gateway 自己从已校验 domain 派生公开 URL。

  `scripts/verify-render-blueprint.mjs` 同时读取 `render.yaml` 和 `deploy/versions.lock.json`，对 service name/type/region、secret 引用、私网引用、digest 和公网边界进行语义校验。在 `package.json` 增加：

  ```json
  "verify:render": "node scripts/verify-render-blueprint.mjs"
  ```

- [ ] **步骤 4：校验并提交**

  ```sh
  npm test -- tests/deploy/renderBlueprint.spec.js
  npm run verify:render
  git add render.yaml scripts/verify-render-blueprint.mjs tests/deploy/renderBlueprint.spec.js package.json package-lock.json
  git commit -m "feat: define the render private-service blueprint"
  ```

## 任务 5：执行 Railway 真实新建、升级和回滚

**外部写入边界：** 本任务会创建付费或可计费资源、写平台变量并绑定 DNS，必须在执行前再获得用户对 Railway 项目和展示域名的明确授权。

**文件：**
- 新建：`scripts/verify-paas-deployment.mjs`
- 新建：`docs/validation/railway.md`

- [ ] **步骤 1：创建全新 Railway project 并映射四服务**

  按 `deploy/railway/topology.json` 创建空项目，加入 gateway GitHub repo Service、两个带 digest 镜像 Service 和托管 Redis。不给三个内部 Service 生成 public domain。设置 reference variables，在 gateway 上绑定一个 Railway 默认域名，健康后再绑 APP/API 两个自定义域名。

- [ ] **步骤 2：执行功能、私网、持久性和日志验证**

  运行 `scripts/verify-paas-deployment.mjs --platform railway`，使用随机哨兵订阅 URL 验证：两域名 HTTPS/Host 路由、转换请求、创建短链、短码跳转、内部 Service 无公网入口、重启 Redis/MyUrls 后旧短码存在、四服务日志无哨兵值。

- [ ] **步骤 3：升级和回滚演练**

  记录当前四个镜像 digest，将 gateway 升级到一个不同的已验证 commit 镜像，重跑功能验证，再回滚到原 digest 并确认旧短码仍存在。不用只改文案的“假升级”替代镜像切换。

- [ ] **步骤 4：保存可公开证据**

  `docs/validation/railway.md` 记录日期、region、公开健康 URL、四个 digest、验证项和平台部署 ID 的非敏感部分；不记录 project token、变量值、Redis URL 或哨兵 URL。

  ```sh
  git add scripts/verify-paas-deployment.mjs docs/validation/railway.md
  git commit -m "test: record railway deployment validation"
  ```

## 任务 6：执行 Render 真实 Blueprint、升级和回滚

**外部写入边界：** 与 Railway 相同，必须在执行前获得用户对 Render Workspace、计费资源和 DNS 的明确授权。

**文件：**
- 新建：`docs/validation/render.md`

- [ ] **步骤 1：从全新 Workspace/Environment 同步 Blueprint**

  在 Dashboard 初次创建流程输入 `APP_DOMAIN` / `API_DOMAIN`，确认生成的 MyUrls Token 被 gateway 引用而不是重新生成第二个值。确认两个 Private Service 和 Key Value 无公网入口，在 gateway healthy 后绑定两个自定义域名。

- [ ] **步骤 2：执行与 Railway 同等的全链路验证**

  ```sh
  node scripts/verify-paas-deployment.mjs --platform render
  ```

  另外检查：Blueprint 从空环境完成、构建日志不包含 MyUrls Token/Key Value URL、所有服务在同一 region、Key Value 重启后数据持久。

- [ ] **步骤 3：执行 digest 升级和回滚**

  通过 Blueprint sync 切换一个已验证镜像 digest，验证后回滚原 digest；确认平台未因回滚重建 Key Value，旧短码仍可访问。

- [ ] **步骤 4：保存可公开证据并提交**

  `docs/validation/render.md` 使用与 Railway 相同的脱敏字段，另外记录 Blueprint sync ID 的非敏感部分和 Key Value 持久性结果。

  ```sh
  git add docs/validation/render.md
  git commit -m "test: record render deployment validation"
  ```

## 本计划审查门禁

- [ ] MyUrls Redis URL/TLS 在独立仓库测试和发布，Subweb 只消费带 digest 镜像。
- [ ] Railway 文档不宣称平台直接运行 Compose；每个 Compose service 显式映射为 Railway Service/Database。
- [ ] Render Blueprint 不使用平台不支持的字符串插值，秘密使用 `generateValue` / `sync: false` / `fromService`。
- [ ] 两平台只有 gateway 公开，内部地址只在私网变量中，前端只看到 APP/API 公开 URL。
- [ ] 两平台都通过新建、双域名 TLS、功能、重启持久性、日志哨兵、升级和回滚；否则 README 继续标记“设计中”。
- [ ] 证据文档不包含平台令牌、Redis URL、秘密、订阅哨兵或完整内部服务 ID。
