# PRD：前端、转换后端与短链三域名拆分

> 历史设计文档：Docker 当前只支持固定的三域名 + 单一 HTTP Gateway。本文关于 Legacy、direct-tls、Compose profiles 和内部证书管理的内容仅保留作需求演进记录；新的部署说明以 `docs/deployment-docker.md` 为准。

- **状态**：已实施（阶段 0-4 自动门禁通过；阶段 5 staging 待执行）
- **版本**：1.0
- **日期**：2026年08月24日
- **适用仓库**：`keleyaa/subweb`
- **目标读者**：后续负责实现、审查和发布的开发模型与维护者
- **优先级**：高；涉及公网路由、跨域、TLS 和历史短链兼容

> 本文是实施合同，不是立即执行清单。后续模型必须先阅读本文及列出的现有文件，再按阶段实施；每个阶段完成并通过门禁后才能进入下一阶段。

## 1. 背景与目标

当前项目由一个 Gateway 承载两个公网 Host：`APP_DOMAIN` 同时负责前端和短链，`API_DOMAIN` 负责转换接口。现状证据：

- `docs/architecture.md:15-27`
- `README.md:21-37`
- `nginx/templates/http.conf.template:42-84`
- `nginx/templates/direct-tls.conf.template:62-85`

本需求将公网职责拆成三个独立域名，但**不拆分内部服务，不新增 Gateway 容器，不新增 npm 依赖**：

| 职责 | 配置变量 | 示例 | 允许的公网职责 |
| --- | --- | --- | --- |
| 前端 | `APP_DOMAIN` | `sub.example.com` | 静态页面、资源、SPA history fallback、健康检查 |
| 转换后端 | `API_DOMAIN` | `api.example.com` | `/sub` 及转换健康检查 |
| 短链 | `SHORT_DOMAIN` | `s.example.com` | 短链创建、短码跳转、健康检查 |

SHORT Host 的 `/healthz` 必须由 Gateway 本地返回 `200 ok`；`/short-api/short` 处理 `POST` 和 `OPTIONS`，单段短码处理 `GET/HEAD`，catch-all 固定返回 `404`；不得复用包含 `try_files` 的完整 APP 路由。

成功标准是：新部署产生的短链使用 `SHORT_DOMAIN`；浏览器从 `APP_DOMAIN` 调用 `SHORT_DOMAIN` 时可安全创建短链；历史 APP 短链在兼容窗口内继续可用；Redis 数据、MyUrls Token、SubConverter 和现有部署模式不被破坏。

## 2. 非目标

本期不做以下事情：

1. 不把 SubConverter、MyUrls、Redis 发布到宿主机公网端口。
2. 不把一个 Gateway 拆成三个容器或三个 Compose 项目。
3. 不改变 `/sub` 转换协议、短码格式、Redis 数据格式、MyUrls API 鉴权协议或限流基线。
4. 不自动修改外层 Nginx、宝塔、1Panel、Cloudflare、DNS 或证书签发系统。
5. 不在本期删除 APP 旧短链入口；删除必须另立破坏性迁移任务。
6. 不新增“短链创建域名”和“短链跳转域名”两个配置；本期二者统一使用 `SHORT_DOMAIN`。
7. 不把短链域名写入前端 canonical、sitemap 或 robots 的站点身份。

## 3. 现状与不可违反的契约

### 3.1 请求流

当前前端运行时配置由 `/conf/config.js` 提供，Docker 启动脚本渲染 `API_URL` 和 `SHORT_URL`，见：

- `src/runtime/config.js:8-10,46-52,68-83`
- `start.sh:45-86`
- `compose.yaml:30-37`

当前短链调用由前端把 `shortUrl` 传入 `createServiceEndpoint(shortUrl, 'short')`，见：

- `src/views/home/index.js:211-216`
- `src/views/home/SubTable.vue:327-355`

当前 `SHORT_URL=https://APP_DOMAIN/short-api` 会产生 `APP_DOMAIN/short-api/short`。因此本期必须保留 `/short-api` 作为短链创建路径后缀，不得只把域名替换成裸 origin 后误改成 `/short`。

### 3.2 当前 Gateway 安全边界

- 未知 Host 必须返回 `421`，不能落到任意上游：`nginx/templates/http.conf.template:42-46`、`nginx/templates/direct-tls.conf.template:54-60`。
- 短链创建仅接受 `POST`、受 body size 限制、覆盖客户端 `Authorization` 并由 Gateway 注入 Token：`nginx/snippets/app-routes.conf.template:31-47`。
- 短码仅允许单段 `[A-Za-z0-9_-]{1,64}`，不能放宽为任意路径：`nginx/snippets/app-routes.conf.template:55-65`。
- 现有限流 `subweb_short` 为 `20r/m`，MyUrls 业务限流为 `5 RPS / 10 burst`，不能移除：`nginx/templates/http.conf.template:36-38`、`compose.yaml:111-113`。
- Token、Redis 密码和完整订阅 URL 不得进入前端配置或访问日志：`docs/architecture.md:27-40`、`docs/security.md`。

## 4. 目标行为合同

### 4.1 新部署

配置三个不同的纯 hostname：

```text
APP_DOMAIN=sub.example.com
API_DOMAIN=api.example.com
SHORT_DOMAIN=s.example.com
API_URL=https://api.example.com
SHORT_URL=https://s.example.com/short-api
```

`SHORT_URL` 的语义固定为“短链创建 API 的公共 base URL”，前端继续追加 `/short`；因此创建请求为：

```text
POST https://s.example.com/short-api/short
```

MyUrls 的 `MYURLS_DOMAIN` 必须使用 `SHORT_DOMAIN`，使 MyUrls 返回的新 `ShortUrl` 指向短链域名。实施模型必须用当前锁定 MyUrls 镜像在真实集成环境验证这一点；不能仅靠字符串替换假定行为。

短码跳转为：

```text
GET|HEAD https://s.example.com/<short-code>
```

### 4.2 APP 兼容入口

为保护已有链接，短期保留：

```text
POST https://APP_DOMAIN/short-api/short
GET|HEAD https://APP_DOMAIN/<short-code>
```

兼容入口仍然使用同一个 MyUrls 和 Redis。新前端不得继续使用 APP 入口；新建短链的返回 URL 必须是 `SHORT_DOMAIN`。

兼容入口的 CORS、限流、Token 覆盖和日志隐私必须与 SHORT 入口一致。实现完成后，文档必须明确它是迁移期兼容能力，而不是 APP 的长期职责。

### 4.3 域名职责隔离

以下矩阵仅适用于 **Three-domain mode**；Legacy mode 的 `SHORT_DOMAIN=APP_DOMAIN` 不可能同时满足 APP 和 SHORT 的不同 catch-all 行为，只验证旧双域兼容合同。

| 请求 | APP | API | SHORT | 未知 Host |
| --- | --- | --- | --- | --- |
| `/`、静态资源、history fallback | 200 | 421 | 404 | 421 |
| `/sub?...` | 421 | 转发 SubConverter | 421 | 421 |
| `/healthz` | Gateway 本地 200 | Gateway 本地 200 | Gateway 本地 200 | 421 |
| `/short-api/short` | 兼容转发 | 421 | 正式转发 | 421 |
| `/<short-code>` | 兼容跳转 | 421 | 正式跳转 | 421 |
| 其他短链路径 | 404 | 421 | 404 | 421 |

Three-domain mode 的 SHORT Host 必须固定拒绝 `/`、`/assets/*`、`/conf/*`、`/sub` 和其他非短链路径，不能返回前端或访问内部上游。API 只允许 `/sub` 和 `/healthz`；APP 保留迁移期短链兼容入口。

## 5. 配置与兼容策略

### 5.1 配置变量

新增 `SHORT_DOMAIN`，其校验规则必须与 `APP_DOMAIN`、`API_DOMAIN` 使用同一个共享校验函数：纯 hostname、至少包含一个点、无 scheme、path、port、控制字符，长度和 label 合法。`configure.sh`、Gateway renderer 和本机配置不得各自实现不同规则；三域名比较必须统一先做 ASCII 小写归一化。

推荐兼容策略：

- `SHORT_DOMAIN` 是**可选兼容配置**，但配置行为分为两种明确模式。
- **Legacy compatibility mode**：旧 `.env` 没有 `SHORT_DOMAIN` 时，`SHORT_DOMAIN` 回退为 `APP_DOMAIN`，`SHORT_URL` 回退为 `https://APP_DOMAIN/short-api`；只保证原有双域行为，不适用第 4.3 节三域隔离矩阵。
- **Three-domain mode**：新部署必须显式传入 `--short-domain` 并写入 `SHORT_DOMAIN`；归一化后必须与 APP/API 均不同，才适用第 4.3 节矩阵。无 `.env` 且未传 `--short-domain` 的新部署必须失败并提示参数，而不是静默回退。
- 重新配置 Legacy 实例但未提供 `--short-domain` 时，不得生成空值，不得改变旧短链行为。
- 重新配置 Three-domain 实例时必须保留既有 Token、Redis 密码和镜像覆盖，除非显式指定 `--rotate-secrets`。
- 所有自动测试和 staging smoke 必须标明运行模式；Legacy 只验证兼容行为，Three-domain 才验证三 Host 隔离。

涉及文件至少包括：

- `scripts/configure.sh`
- `scripts/lib/config.sh`
- `compose.yaml`
- `start.sh`
- `scripts/render-gateway-config.sh`
- `scripts/local/render-config.mjs`
- `scripts/local/start.sh`
- `scripts/local/status.sh`
- `scripts/local/stop.sh`
- `scripts/verify-integrated-stack.sh`
- `scripts/verify-redis-operations.sh`
- `scripts/test-support/create-test-certificate.sh`
- `.env.example`
- `nginx/templates/http.conf.template`
- `nginx/templates/direct-tls.conf.template`
- `nginx/snippets/api-routes.conf.template`
- `nginx/snippets/app-routes.conf.template`
- `nginx/snippets/proxy-headers.conf.template`
- 新增 `nginx/snippets/short-routes.conf.template`
- `tests/deploy/configureScript.spec.js`
- `tests/deploy/composeStack.spec.js`
- `tests/gateway/configRendering.spec.js`
- `tests/gateway/routingContract.spec.js`
- `tests/integration/gatewayStack.spec.js`
- `tests/local/configDerivation.spec.js`
- `tests/local/ports.spec.js`
- `tests/local/start.spec.js`
- `tests/local/status.spec.js`
- `tests/local/stop.spec.js`

### 5.2 Compose 与 MyUrls

在 `compose.yaml` 中：

- Gateway 环境增加 `SHORT_DOMAIN`。
- MyUrls 的 `MYURLS_DOMAIN` 使用 `SHORT_DOMAIN`，旧配置回退已在配置生成阶段完成。
- `API_URL` 继续传给 SubConverter 的 managed config prefix。
- 所有内部服务仍无 `ports` 发布。

不要把三个公网域名误写成三个上游地址；上游仍为 `subconverter:25500` 和 `myurls:8080`。

## 6. Gateway 实施要求

### 6.1 路由文件拆分

将当前短链路由从 APP 路由中提取为共享短链片段，或建立独立的短链模板；选择改动较小且能让“正式 SHORT 路由”和“APP 兼容路由”共用安全规则的方案。不得复制两份长期会漂移的完整实现。

最小目标结构：

- `app-routes.conf.template`：前端路由，以及迁移期 APP 短链兼容路由。
- `api-routes.conf.template`：SubConverter 路由。
- 新增 `short-routes.conf.template`：SHORT Host 正式短链创建和跳转路由。

APP 兼容路由必须显式标注迁移用途；SHORT 正式路由不得包含 `try_files` 或前端 fallback。

### 6.2 CORS

因为前端在 APP、短链 API 在 SHORT，必须在 Gateway 对短链创建实现**来源校验 + CORS**：

- 正式 SHORT 创建入口的 `POST` 必须校验 `Origin` 精确等于 `PUBLIC_SCHEME://APP_DOMAIN`；缺失或不匹配的 `Origin` 必须在 Gateway 拒绝，不能到达 MyUrls。CORS 响应头不能替代这项校验：当前前端的 `application/x-www-form-urlencoded` 请求属于浏览器可直接发送的 simple request，恶意站点即使读不到响应也可能触发写入。
- `OPTIONS` 必须由 Gateway 终止并返回 `204`，不访问 MyUrls、不设置 Bearer Token；仅对精确 APP origin 返回 `Access-Control-Allow-Origin`，并返回 `Access-Control-Allow-Methods: POST, OPTIONS`、`Access-Control-Allow-Headers: Content-Type`、`Vary: Origin`，不返回 `Access-Control-Allow-Credentials`。不允许的 Origin 必须被拒绝或返回不含允许头的响应。
- 如部署环境确实存在不发送 `Origin` 的受控客户端，必须另行定义、限制并测试明确的例外；不能默认放行缺失 `Origin` 的请求。
- 可同时使用 `Sec-Fetch-Site` 作为纵深防御，但不能用它替代 `Origin`，也不能把 `Referer` 当作唯一认证。
- `Access-Control-Allow-Origin` 只允许配置的 APP origin，不允许 `*`。
- `Access-Control-Allow-Methods` 只允许实际需要的 `POST, OPTIONS`。
- `Access-Control-Allow-Headers` 至少覆盖前端实际发送的 `Content-Type`，不要允许任意凭据头。
- 不允许把客户端 `Authorization` 或 `Proxy-Authorization` 转发给 MyUrls；正式 POST 仍先清空再注入服务端 Bearer Token。
- 即使预检成功，实际 POST 仍必须执行 `Origin` 校验。
- APP 兼容入口若没有跨域需求可以不附加 CORS；若返回 CORS，仅允许配置的 APP origin，不能接受 API/SHORT 或任意其他 Origin。

CORS 和来源拒绝必须用真实浏览器或等效带 `Origin` 的请求验证，不能把 CSP 当成 CORS。`nginx/snippets/security-headers.conf` 的 `connect-src` 只属于浏览器内容安全策略，不替代响应头。验证必须证明：允许的 APP origin 可以创建；恶意 origin、缺失 origin 和伪造不匹配 origin 的 POST 均不会到达 MyUrls。

### 6.3 Host 与 TLS

direct-tls 的 HTTP 行为必须明确为：`APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 均 `308` 到对应 HTTPS URL；未知 Host 返回 `421`。测试证书辅助脚本 `scripts/test-support/create-test-certificate.sh`、其调用方 `scripts/verify-integrated-stack.sh` 和错误 SAN 测试必须同步支持三个 SAN，并分别验证缺失 APP/API/SHORT 任一 SAN 时启动失败。

外层反向代理配置文档必须给出三个 vhost，三者都转发到同一个 loopback Gateway，并保留原始 `Host`。`X-Forwarded-*` 只能由受信任的外层代理设置；Gateway 不得直接信任客户端传入的 `X-Forwarded-For`、`X-Forwarded-Proto` 或其他同名头。若未来需要真实客户端 IP 限流，必须配置受信任代理网段和 Nginx `real_ip`，不能简单透传客户端头。仓库无法自动修改部署者的外层代理，必须把该步骤作为部署验收项。

## 7. 前端与本机模式

### 7.1 前端运行时配置

Docker `start.sh`、`src/runtime/config.js` 和 `public/conf/config.js` 的默认值必须同步：

- `apiUrl`：`https://API_DOMAIN`
- `shortUrl`：`https://SHORT_DOMAIN/short-api`

默认配置不得继续把未配置的本机开发请求发送到维护者的真实公网短链服务；可使用空值或明确的本地示例，且现有 `normalizeRuntimeConfig` 的安全校验必须保持。

前端只读取以上两个公开 URL；Token、Redis 密码和其他秘密不得进入浏览器。

`src/runtime/config.js` 的 URL 安全校验必须继续拒绝 `javascript:`、非法 URL 和不可信结构；不要为了跨域而放宽校验。

### 7.2 本机源码

本 PRD 选择**新增 `LOCAL_SHORT_PORT`** 的确定方案，不采用隐式 Host 模拟。默认端口为 `18083`；本机职责固定为：`LOCAL_APP_PORT` 前端、`LOCAL_API_PORT` 转换、`LOCAL_SHORT_PORT` 短链。必须同步纳入配置生成、启动、状态、停止、端口唯一性和本机生命周期测试；本机 MyUrls 的 `MYURLS_DOMAIN` 必须对应短链入口，返回的 `ShortUrl` 必须使用短链 base URL。Legacy mode 可继续使用旧 APP 入口，但 Three-domain mode 必须实际请求 `LOCAL_SHORT_PORT` 验证隔离。

涉及文件至少包括：

- `scripts/local/render-config.mjs`
- `scripts/local/start.sh`
- `scripts/local/status.sh`
- `scripts/local/stop.sh`
- `scripts/local/lib/common.sh`
- `tests/local/configDerivation.spec.js`
- `tests/local/ports.spec.js`
- `tests/local/start.spec.js`
- `tests/local/status.spec.js`
- `tests/local/stop.spec.js`
- `docs/deployment-local.md`

## 8. 实施顺序与完成标准

### 阶段 0：基线冻结

记录当前 Git commit、镜像引用、Compose 配置和 Redis 备份；先运行不依赖 `.env` 的基线：

```sh
npm test
npm run lint
npm run build
npm run verify:docs
```

`npm run verify:compose` 依赖当前工作目录的 `.env`（`scripts/validate-compose.sh:9-18`），不能在干净仓库直接作为必成功命令。需要验证 Compose 时，在隔离临时目录生成脱敏测试 `.env`，执行 `docker compose --env-file <temporary-env> config` 或项目现有等价验证，完成后删除临时文件；不要读取、打印或覆盖生产 `.env`。本项目没有 `npm run typecheck`，不应把它列为门禁。

**完成标准**：上述无状态基线命令全部成功；Compose 验证在隔离测试 `.env` 上成功或明确记录 Docker/环境阻塞；工作树除本 PRD 外无改动；没有修改 Redis 数据。

### 阶段 1：配置传播

先实现 `SHORT_DOMAIN` 的解析、校验、旧配置回退和 `SHORT_URL` 派生，再修改 Gateway 模板。

**完成标准**：新三域名 `.env` 值完整；旧双域名 `.env` 重新生成后行为不变；秘密和镜像覆盖保持；非法/重复/控制字符输入在写文件前失败。

### 阶段 2：Gateway 三 Host

增加 SHORT server 和共享短链路由，保留 APP 兼容路由；完成 CORS、Host 拒绝、三域名 TLS 校验。

**完成标准**：两个 Docker 模式生成的 Nginx 配置通过 `nginx -t`；APP/API/SHORT/未知 Host 的路由矩阵与第 4.3 节一致；SHORT 不返回前端页面。

### 阶段 3：MyUrls 与前端

将 MyUrls `MYURLS_DOMAIN` 和前端 `shortUrl` 切换到 SHORT 域名，验证返回 `ShortUrl` 的实际格式；前端跨域创建成功。

**完成标准**：新创建短链返回 `https://SHORT_DOMAIN/...`，浏览器请求不携带服务端 Token；转换和短链功能同时正常。

### 阶段 4：本机模式与测试

完成 `LOCAL_SHORT_PORT=18083` 的本机第三入口，更新单测、静态契约、Docker 集成验证和文档。

**完成标准**：Legacy mode、本机 Three-domain mode、behind-proxy、direct-tls 均有可执行覆盖；测试能在实现回归时失败，而不是只检查字符串存在。

### 阶段 5：Staging 发布与观察

先部署三域名 staging，不删除 APP 兼容入口。验证 DNS、TLS、外层代理 Host 保留、CORS、短链创建、短码跳转、Redis 重启和日志隐私。

**完成标准**：连续完成一次完整转换→创建短链→跳转→Redis 重启→再次跳转流程；旧 APP 短链仍成功；所有失败路径均有证据；才允许生产切换。

## 9. 验收矩阵

### 9.1 自动验证

至少新增或更新以下覆盖：

1. `configure.sh`：三个域名写入、旧配置回退、三域名不能重复、非法 hostname 拒绝、秘密保留；`configure.sh` 与 Gateway renderer 对同一组域名必须给出一致结果。
2. Compose：`SHORT_DOMAIN` 传给 Gateway 和 MyUrls，内部服务没有宿主端口。
3. Gateway 模板：三 Host server、未知 Host `421`、API 仅允许 `/sub` 和 `/healthz`、SHORT 不含前端 fallback、短链路由安全规则不漂移；验证 API `/`、任意短码、`/short-api/short` 不到达 SubConverter，验证 SHORT `/`、静态资源、多段短码和其他路径不访问前端或上游。
4. CORS/来源防护：SHORT `OPTIONS` 返回 `204` 且不访问 MyUrls；只允许 APP origin、包含 `Vary: Origin`、不允许 `*` 或 credentials；实际 POST 对允许、恶意、缺失 Origin 均分别验证；兼容 APP 入口不允许任意跨域写入。
5. `start.sh`：`SHORT_URL` 正确渲染且含 `/short-api`，特殊字符不会破坏 `config.js`；Docker、本机和源码默认配置的路径语义一致。
6. direct-tls：证书覆盖三个域名；APP/API/SHORT 任一 SAN 缺失时启动前拒绝，HTTP redirect 也覆盖三个域名。
7. `scripts/verify-integrated-stack.sh`：必须生成 `app.test`、`api.app.test`、`short.app.test`，使用 `MYURLS_DOMAIN=short.app.test`；正式创建走 SHORT，APP 旧入口单独验证，API/未知 Host 误路由拒绝，返回 `ShortUrl` 使用 SHORT origin。
8. 本机：Three-domain mode 必须实际使用 `LOCAL_SHORT_PORT=18083`，并覆盖三入口、端口唯一性、启动/状态/停止回滚和短链持久性；Legacy mode 单独验证旧 APP 入口。
9. Redis：隔离测试项目完成备份校验和恢复后短码访问；生产回滚不得删除 `redis-data`，测试脚本的卷删除只能发生在临时 Compose 项目。
10. `scripts/test-support/create-test-certificate.sh`：支持三个 SAN，并覆盖缺失任一域名和证书/私钥不匹配的拒绝测试。
11. 现有测试必须同步更新双域硬编码断言：`tests/deploy/configureScript.spec.js`、`tests/deploy/composeStack.spec.js`、`tests/gateway/configRendering.spec.js`、`tests/gateway/routingContract.spec.js`、`tests/integration/gatewayStack.spec.js`、`tests/local/configDerivation.spec.js`、`tests/local/ports.spec.js`、`tests/local/start.spec.js`、`tests/local/status.spec.js`、`tests/local/stop.spec.js`。重点包括 `SHORT_URL=https://app.example.com/short-api`、`MYURLS_DOMAIN=app.example.com`、短链只走 APP、双 SAN、`LOCAL_APP_PORT` 短链等旧断言，必须按 Legacy/Three-domain mode 分层保留或改写。
11. Compose 集成验收必须复用运行时端口检查，确认 `redis`、`myurls`、`subconverter` 没有宿主端口；不能只检查 YAML 文本。

### 9.2 三域名 staging smoke

使用真实 DNS 和证书，逐项保存状态码和必要响应头，但不得保存真实订阅 URL、短码、Token 或 Redis 密码：

```text
GET  https://APP_DOMAIN/                         => 200
GET  https://API_DOMAIN/healthz                  => Gateway 200
GET  https://SHORT_DOMAIN/healthz                => Gateway 200
POST https://API_DOMAIN/sub?...                  => 转换成功
OPTIONS https://SHORT_DOMAIN/short-api/short     => 204，仅允许 APP origin，不上游
POST https://SHORT_DOMAIN/short-api/short        => 创建成功，返回 SHORT_DOMAIN
GET  https://SHORT_DOMAIN/<short-code>           => redirect
GET  https://APP_DOMAIN/<old-short-code>         => 旧短链仍 redirect
GET  https://SHORT_DOMAIN/                       => 404，不能返回前端
GET  https://API_DOMAIN/<short-code>             => 421
GET  https://unknown.example/<short-code>        => 421
```

将 `Origin` 设置为 APP origin，验证响应的 `Access-Control-Allow-Origin` 精确匹配、`Vary: Origin` 存在且不返回 credentials；用恶意、缺失和不匹配 Origin 验证 OPTIONS 与实际 POST 均不会到达 MyUrls。用客户端伪造 `Authorization`、`Proxy-Authorization` 和错误 Token 验证 MyUrls 仍只看到 Gateway 注入的 Token。

### 9.3 完整门禁

实现后至少运行并记录结果：

```sh
npm test
npm run lint
npm run build
npm run verify:docs
npm run verify:evidence
npm run verify:compose
npm run verify:integration
npm run verify:operations
npm run test:e2e
```

Docker 或真实环境不可用时，不得把跳过写成成功；应标记未验证项目，并提供阻塞原因和下一步。

## 10. 回滚与数据安全

配置回滚只回滚 Gateway、前端运行时配置和 MyUrls 域名配置；不得删除或重建 `redis-data`。回滚前后使用同一 Redis 数据卷验证历史短链。

回滚只允许在两种明确路径中选择：

- **回滚到支持三域名的版本**：恢复该版本的 Gateway、前端和配置，保留 DNS、SHORT Host 和 Redis 数据，验证三个入口。
- **回滚到旧双域版本**：接受 SHORT Host 暂时不可用；只验收 APP 历史短链、APP 前端和 API 转换。不得宣称新 SHORT 入口仍由旧 Gateway 提供，也不得删除 Redis 数据。

不得把“恢复旧 Gateway”与“继续验证新 SHORT 入口”写成同一路径。任何临时由外层代理将 SHORT 转发到 APP 的做法都必须明确标记为兼容回退态，而不是三域隔离状态。

推荐生产回滚顺序：

1. 保留 DNS、Redis 数据和秘密，先选择上述唯一一种回滚路径。
2. 恢复对应版本的 `.env`、Gateway/前端镜像和 MyUrls 配置；不同时轮换秘密。
3. 重启 Gateway 和 MyUrls，确认 Token 一致。
4. 用已存在短码验证该回滚态允许的入口。
5. 只有确认失败原因与数据安全无关时，才进行镜像回滚；生产禁止 `docker compose down -v`。

不要在域名切换同时轮换秘密。秘密轮换必须按现有运维流程停写、备份并同步更新 Gateway/MyUrls：`docs/operations.md`。

## 11. 关键风险与实施前必须确认的未知

1. **MyUrls 行为**：当前锁定版本是否依据 `MYURLS_DOMAIN` 生成绝对 `ShortUrl`，必须通过真实容器验证。
2. **短链路径**：前端当前追加 `short`，因此不能把 `SHORT_URL` 写成裸 origin；若实现模型要改变路径，必须同时更新 `createServiceEndpoint`、MyUrls 上游路径、旧兼容入口和全部断言。
3. **CORS 细节**：必须确认当前 MyUrls 版本对 OPTIONS 的行为；优先由 Gateway 处理预检。
4. **外层代理**：三个域名是否保留原始 Host、是否透传 CORS 响应头、是否使用 Cloudflare cache，需部署者在 staging 确认。
5. **旧入口生命周期**：本 PRD 不授权删除 APP 兼容路由。删除前应有访问统计、公告、完整 TTL 加观察窗口和新的迁移 PRD。
6. **证书供应**：direct-tls 必须覆盖三个 SAN；behind-proxy 由外层代理负责三个证书/vhost。

## 12. 代码审查硬性规则

审查时发现以下任一项，视为未完成：

- 只改 `SHORT_URL`，未改 Host 路由或 `MYURLS_DOMAIN`。
- 让 SHORT Host 返回前端页面，或让 API Host代理短链。
- 删除 APP 旧短链路由而没有单独获批的破坏性迁移。
- CORS 使用 `*`、把 Token 放入浏览器、或把客户端 Authorization 透传给 MyUrls。
- 放宽短码匹配器、移除限流、取消未知 Host 的 `421`。
- direct-tls 只校验两个域名。
- 用测试字符串断言代替真实三 Host/三域名集成验证。
- 修改 Redis 卷、执行 `down -v` 或以删除数据解决迁移问题。
- 新增不必要的服务、依赖、Gateway 容器或抽象层。

## 13. 交付物

实现 PR 必须同时包含：

1. 最小代码变更及对应测试；
2. 更新后的 `README.md`、`docs/architecture.md`、`docs/configuration.md`、`docs/deployment-docker.md`、`docs/deployment-local.md`、`docs/security.md`；
3. 三域名配置示例和旧双域名兼容说明；
4. 自动验证命令输出摘要；
5. staging 三域名 smoke 证据摘要，已脱敏；
6. 未验证项、环境阻塞和回滚方式；
7. 明确说明 APP 旧短链兼容入口仍存在。

**最终判定**：只有当新短链确实返回并可访问 `SHORT_DOMAIN`、前端跨域创建通过、API/APP/SHORT 职责隔离、历史短链可跳转、Redis 重启后数据仍在，并且所有可执行门禁通过时，才可标记为完成。
