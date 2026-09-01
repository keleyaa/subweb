# 统一 Go Gateway 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）来跟踪进度。

**目标：** 将 Subweb 的项目自有 Gateway 与 Request Policy 收敛为 Go 1.25 单二进制，并以一个正式的公网生产 Compose 拓扑承载 Vue、SubConverter、可选 MyUrls 和 Redis。

**架构：** Go 服务负责 Host 路由、静态资源、短链适配、转换策略、匿名限流和受控 HTTPS CONNECT egress；SubConverter、MyUrls 与 Redis 保持独立容器。`SHORT_LINKS_ENABLED` 和 `CUSTOM_BACKEND_ENABLED` 是业务开关，SSRF、DNS 校验、限流、超时、网络隔离和容器收紧控制不可关闭。

**技术栈：** Go 1.25、`net/http`、`net/http/httputil`、`net/netip`、`log/slog`、`github.com/redis/go-redis/v9`、Vue 3、Vite、Vitest、Playwright、Docker Compose。

---

## 0. 执行规则和基线

### 任务 0：建立隔离工作区并冻结基线

**文件：**
- 读取：`docs/architecture-prd.md`
- 读取：`compose.hardened.yaml`
- 读取：`services/request-policy/src/`
- 读取：`tests/gateway/`
- 读取：`tests/deploy/`
- 不修改：用户已有的 `.pi/`、`.runtime/` 和未相关文件

- [ ] **步骤 1：创建功能 worktree**

运行：

```sh
git worktree add .worktrees/unified-go-gateway -b feat/unified-go-gateway
cd .worktrees/unified-go-gateway
```

预期：当前 `main` 工作区保持不变，新的实现分支从提交 `ff29c11` 开始。

- [ ] **步骤 2：运行迁移前基线验证**

运行：

```sh
npm test
npm run lint
npm run build
npm run verify:compose
npm run verify:docs
```

预期：每个命令退出码为 `0`。任何失败先记录为基线问题，不将其归因于 Go 迁移。

- [ ] **步骤 3：保存基线结果并提交计划分支起点**

运行：

```sh
git status --short
git log -1 --oneline
```

预期：只有计划执行工作区自身允许出现的文件变化；提交信息使用：

```text
chore: freeze unified gateway migration baseline
```

---

## 1. 定义 Go 服务合同

### 任务 1：创建 Go module 和目录边界

**文件：**
- 创建：`services/gateway/go.mod`
- 创建：`services/gateway/cmd/gateway/main.go`
- 创建：`services/gateway/internal/config/config.go`
- 创建：`services/gateway/internal/config/config_test.go`
- 创建：`services/gateway/internal/httpapi/errors.go`
- 创建：`services/gateway/internal/httpapi/errors_test.go`

- [ ] **步骤 1：先写配置失败测试**

`config_test.go` 至少覆盖：

```go
func TestLoadRejectsMissingRequiredDomain(t *testing.T) {}
func TestLoadRejectsInvalidURL(t *testing.T) {}
func TestLoadRequiresShortLinkSecretsWhenEnabled(t *testing.T) {}
func TestLoadDoesNotRequireShortLinkSecretsWhenDisabled(t *testing.T) {}
func TestLoadRejectsUnsafeTrustedProxyCIDR(t *testing.T) {}
func TestLoadRejectsUnboundedPolicyValues(t *testing.T) {}
```

测试必须构造独立环境映射，不读取开发机真实 `.env`。

- [ ] **步骤 2：运行配置测试确认失败**

运行：

```sh
cd services/gateway
go test ./internal/config -run 'TestLoad' -count=1
```

预期：因 `go.mod`、配置类型和 `Load` 尚未存在而失败。

- [ ] **步骤 3：定义配置类型和加载函数**

`config.go` 定义稳定类型：

```go
type Config struct {
    ListenAddr                 string
    AppDomain                  string
    APIDomain                  string
    ShortDomain                string
    APIURL                     *url.URL
    ShortLinksEnabled          bool
    CustomBackendEnabled       bool
    TrustedProxyCIDR            *net.IPNet
    RedisURL                    string
    RedisPassword               string
    IPHashSecret                []byte
    TurnstileSiteKey            string
    TurnstileSecretKey          string
    SubConverterUpstream        *url.URL
    MyURLsUpstream              *url.URL
    ConversionRateLimit         int
    ConversionRateWindow        time.Duration
    ConversionMaxRequestBytes  int64
    ConversionMaxResponseBytes int64
    ConversionRequestTimeout    time.Duration
    ConversionDNSTimeout        time.Duration
    EgressConnectTimeout        time.Duration
    ConversionMaxConcurrency    int
}

func Load(getenv func(string) string) (Config, error)
```

实现要求：

- 默认 `ListenAddr` 为 `0.0.0.0:8080`。
- `SHORT_LINKS_ENABLED`、`CUSTOM_BACKEND_ENABLED` 只接受 `true` 和 `false`。
- IP hash secret 必须是 64 字符十六进制。
- URL 禁止 userinfo；API URL 只允许 HTTPS 或 loopback HTTP。
- 所有请求大小、超时和并发参数使用有限实践上限。
- 短链关闭时不读取或要求 MyUrls、Redis、Turnstile 秘密。
- 安全策略不存在 `DISABLE_*`、`ALLOW_PRIVATE_IP` 或等价绕过字段。

- [ ] **步骤 4：定义统一 problem details 错误**

`errors.go` 定义：

```go
type Problem struct {
    Type               string `json:"type"`
    Title              string `json:"title"`
    Status             int    `json:"status"`
    Code               string `json:"code"`
    RequestID          string `json:"requestId"`
    RetryAfterSeconds  int    `json:"retryAfterSeconds,omitempty"`
    Challenge          any    `json:"challenge,omitempty"`
}

func WriteProblem(w http.ResponseWriter, requestID string, err error)
```

Content-Type 固定为 `application/problem+json`。禁止把内部错误文本、URL、解析地址和秘密写入响应。

- [ ] **步骤 5：运行测试并提交**

运行：

```sh
cd services/gateway
gofmt -w cmd internal
go test ./...
go vet ./...
git add services/gateway
git commit -m "feat: define Go gateway configuration contract"
```

预期：Go 测试和 `go vet` 通过。

### 任务 2：建立 HTTP 服务骨架

**文件：**
- 创建：`services/gateway/internal/httpapi/server.go`
- 创建：`services/gateway/internal/httpapi/server_test.go`
- 修改：`services/gateway/cmd/gateway/main.go`

- [ ] **步骤 1：写路由骨架测试**

测试覆盖：

```go
func TestHealthzDoesNotRequireDependencies(t *testing.T) {}
func TestUnknownHostReturns421(t *testing.T) {}
func TestUnknownRouteReturns404(t *testing.T) {}
func TestReadinessFailsWhenEnabledDependencyIsDown(t *testing.T) {}
func TestRequestIDIsGeneratedAndReturned(t *testing.T) {}
```

- [ ] **步骤 2：实现服务构造器**

定义：

```go
type Dependencies struct {
    Converter  http.Handler
    ShortLinks http.Handler
    Readiness  func(context.Context) error
    Logger     *slog.Logger
}

func NewServer(cfg config.Config, deps Dependencies) *http.Server
```

实现 `/healthz`、`/readyz`、Host 选择、request ID、统一错误恢复和方法拒绝。

- [ ] **步骤 3：运行骨架测试**

运行：

```sh
cd services/gateway
go test ./internal/httpapi -count=1
```

预期：所有骨架测试通过。

- [ ] **步骤 4：提交**

```sh
git add services/gateway
git commit -m "feat: add Go gateway HTTP server skeleton"
```

---

## 2. 迁移并验证 Conversion Policy

### 任务 3：迁移地址分类和 DNS 校验

**文件：**
- 创建：`services/gateway/internal/policy/address.go`
- 创建：`services/gateway/internal/policy/address_test.go`
- 创建：`services/gateway/internal/policy/url.go`
- 创建：`services/gateway/internal/policy/url_test.go`
- 参考：`services/request-policy/src/url-policy.mjs`
- 修改：`services/gateway/internal/config/config.go`

- [ ] **步骤 1：从现有 Node 测试提取输入矩阵**

先读取并复用现有 `tests` 中关于 URL、DNS、IPv4、IPv6、端口、重定向和大小的输入。不要凭记忆重写规则。

矩阵必须包含：

- HTTPS 公网 hostname。
- loopback IPv4/IPv6。
- RFC 1918 私网地址。
- link-local、multicast、unspecified 和保留地址。
- IPv4-mapped IPv6。
- 带 userinfo、fragment、非 443 端口和错误 scheme 的 URL。
- 无 DNS 结果和 DNS 超时。
- 一个 hostname 返回公网与私网混合地址。

- [ ] **步骤 2：写失败测试**

定义接口：

```go
type Resolver interface {
    LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type DialTarget struct {
    URL       *url.URL
    Addresses []netip.Addr
}

func ValidateRemoteURL(ctx context.Context, value string, resolver Resolver, opts Options) (DialTarget, error)
```

- [ ] **步骤 3：实现最小策略**

要求：

- 只接受 `https`。
- 默认只接受空端口或 `443`。
- 拒绝 hostname 为空、userinfo、fragment 和过长 URL。
- 所有解析地址都必须是可路由公网单播地址。
- 返回解析后的地址集合，供后续 Dialer 使用。
- 不把 hostname 重新解析作为授权后的连接方式。

- [ ] **步骤 4：运行策略测试**

运行：

```sh
cd services/gateway
go test ./internal/policy -run 'TestValidate|TestAddress' -count=1
```

预期：全部通过，且测试使用 fake resolver，不依赖公网 DNS。

- [ ] **步骤 5：提交**

```sh
git add services/gateway/internal/policy services/gateway/internal/config/config.go
git commit -m "feat: add public URL and address policy"
```

### 任务 4：迁移限流、并发、大小和超时策略

**文件：**
- 创建：`services/gateway/internal/policy/limits.go`
- 创建：`services/gateway/internal/policy/limits_test.go`
- 创建：`services/gateway/internal/ratelimit/store.go`
- 创建：`services/gateway/internal/ratelimit/memory.go`
- 创建：`services/gateway/internal/ratelimit/memory_test.go`
- 参考：`services/request-policy/src/concurrency.mjs`
- 参考：`services/request-policy/src/rate-limiter.mjs`

- [ ] **步骤 1：写失败测试**

覆盖：

```go
func TestRateLimiterRejectsAfterLimit(t *testing.T) {}
func TestRateLimiterExpiresWindow(t *testing.T) {}
func TestSemaphoreReleasesAfterHandlerError(t *testing.T) {}
func TestResponseReaderStopsAtMaximum(t *testing.T) {}
func TestRequestContextExpiresAtTotalTimeout(t *testing.T) {}
func TestDisabledShortLinksUsesMemoryStoreOnly(t *testing.T) {}
```

- [ ] **步骤 2：定义存储接口**

```go
type CounterStore interface {
    Increment(ctx context.Context, key string, window time.Duration) (int64, error)
}
```

内存实现只用于 `SHORT_LINKS_ENABLED=false` 的精简部署，必须有明确单 Gateway 限制；Redis 实现留给任务 5。

- [ ] **步骤 3：实现有限资源控制**

要求：

- 使用 Context 控制所有等待。
- semaphore 必须在 `defer` 中释放。
- 响应流读取到 `maxResponseBytes+1` 即停止并返回 `response_too_large`。
- 总请求超时覆盖 DNS、连接、上游响应和响应读取。
- 客户端取消后不得继续消耗并发额度。
- 不接受 `math.MaxInt`、超大 duration 或无限 buffer。

- [ ] **步骤 4：运行测试和竞态测试**

运行：

```sh
cd services/gateway
go test -race ./internal/policy ./internal/ratelimit -count=1
```

预期：通过，且无 race detector 报告。

- [ ] **步骤 5：提交**

```sh
git add services/gateway/internal/policy services/gateway/internal/ratelimit
git commit -m "feat: enforce conversion resource limits"
```

### 任务 5：接入 Redis DB `1` 和客户端 IP 哈希

**文件：**
- 修改：`services/gateway/go.mod`
- 创建：`services/gateway/internal/ratelimit/redis.go`
- 创建：`services/gateway/internal/ratelimit/redis_test.go`
- 创建：`services/gateway/internal/privacy/hash.go`
- 创建：`services/gateway/internal/privacy/hash_test.go`
- 创建：`tests/integration/gatewayRedis.spec.js`

- [ ] **步骤 1：加入固定 Redis 客户端依赖**

在 `services/gateway` 执行：

```sh
go get github.com/redis/go-redis/v9
go mod tidy
```

配置客户端使用 `REDIS_URL`、密码和 DB `1`，不得复用 MyUrls DB `0` 的连接对象。

- [ ] **步骤 2：写 Redis 合同测试**

测试必须验证：

- `Increment` 使用 `INCR` 加 TTL 语义。
- Redis 错误使请求 fail closed，而不是无限放行。
- 不将原始 IP 作为 Redis key。
- 同一 secret 和 IP 得到稳定 hash。
- 不同 secret 得到不同 hash。
- 日志不打印 key。

- [ ] **步骤 3：实现 Redis store 和哈希**

使用 HMAC-SHA256 或同等标准 keyed hash，将客户端 IP 转换为固定长度不可逆标识。Redis key 固定前缀为：

```text
subweb:rate:convert:<hash>
```

- [ ] **步骤 4：运行单元与容器测试**

运行：

```sh
cd services/gateway
go test -race ./...
cd ../..
npm test -- tests/integration/gatewayRedis.spec.js
```

预期：Go 和 Node 测试均通过；需要 Redis 的测试使用临时 Compose 服务，不连接生产数据卷。

- [ ] **步骤 5：提交**

```sh
git add services/gateway/go.mod services/gateway/go.sum services/gateway/internal tests/integration/gatewayRedis.spec.js
git commit -m "feat: add Redis-backed conversion rate limiting"
```

---

## 3. 实现受控 HTTPS CONNECT egress

### 任务 6：实现已授权目标与固定 IP Dialer

**文件：**
- 创建：`services/gateway/internal/egress/authorization.go`
- 创建：`services/gateway/internal/egress/authorization_test.go`
- 创建：`services/gateway/internal/egress/dialer.go`
- 创建：`services/gateway/internal/egress/dialer_test.go`

- [ ] **步骤 1：写失败测试**

覆盖：

```go
func TestAuthorizeConnectRequires443(t *testing.T) {}
func TestAuthorizeConnectRejectsPrivateResolution(t *testing.T) {}
func TestDialerUsesVerifiedAddressNotHostname(t *testing.T) {}
func TestDialerHonorsContextCancellation(t *testing.T) {}
func TestConnectCannotReplayExpiredAuthorization(t *testing.T) {}
```

- [ ] **步骤 2：定义授权合同**

```go
type Authorization struct {
    Token      string
    Hostname   string
    Port       uint16
    Addresses  []netip.Addr
    ExpiresAt  time.Time
}

type Authorizer interface {
    Authorize(ctx context.Context, authority string) (Authorization, error)
    Consume(token string, authority string) (Authorization, error)
}
```

授权必须是短 TTL、一次性或绑定请求生命周期的凭据。不能仅由 CONNECT 请求的 hostname 再次 DNS 解析决定授权。

- [ ] **步骤 3：实现 CONNECT 服务**

要求：

- 非 CONNECT 方法返回 405。
- authority 只允许 hostname/IP 加 `:443`。
- CONNECT 前校验授权凭据和目标一致性。
- Dialer 只连接授权返回的地址。
- 连接超时和请求取消关闭两侧 socket。
- 错误响应使用统一状态和错误码。
- 日志只记录 `requestId`、状态和错误码。

- [ ] **步骤 4：运行 egress 测试**

运行：

```sh
cd services/gateway
go test -race ./internal/egress -count=1
```

预期：全部通过；测试使用本地 fake listener，不访问公网。

- [ ] **步骤 5：提交**

```sh
git add services/gateway/internal/egress
git commit -m "feat: add authorized HTTPS egress proxy"
```

### 任务 7：把 egress 接入 SubConverter 转换链路

**文件：**
- 修改：`services/gateway/internal/httpapi/server.go`
- 创建：`services/gateway/internal/conversion/service.go`
- 创建：`services/gateway/internal/conversion/service_test.go`
- 创建：`tests/integration/conversionPolicy.spec.js`

- [ ] **步骤 1：写转换链路测试**

覆盖：

- 合法公网订阅成功。
- 私网地址返回 403/策略错误。
- DNS timeout 返回有限错误。
- 上游 5xx 被映射为 `upstream_error`。
- 上游响应超过 8 MiB 被中止。
- 同时超过 2 个转换请求时返回 `concurrency_limited`。
- 客户端断开后上游收到取消。
- `/sub` 只接受 GET。

- [ ] **步骤 2：实现 ConversionService**

```go
type Service struct {
    Policy       policy.ConversionPolicy
    RateStore    ratelimit.CounterStore
    Semaphore    *policy.Semaphore
    Upstream     *url.URL
    Transport    http.RoundTripper
    MaxResponse  int64
    Timeout      time.Duration
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request)
```

只转发已允许的 SubConverter 查询参数；不透传 Authorization、Cookie、Origin、Forwarded 或客户端自定义代理头。

- [ ] **步骤 3：运行测试**

运行：

```sh
cd services/gateway
go test -race ./internal/conversion ./internal/httpapi
cd ../..
npm test -- tests/integration/conversionPolicy.spec.js
```

预期：全部通过。

- [ ] **步骤 4：提交**

```sh
git add services/gateway/internal tests/integration/conversionPolicy.spec.js
git commit -m "feat: route conversions through Go policy"
```

---

## 4. 实现静态 Gateway 与短链适配

### 任务 8：迁移静态资源、Host 路由和运行时配置

**文件：**
- 创建：`services/gateway/internal/staticfiles/handler.go`
- 创建：`services/gateway/internal/staticfiles/handler_test.go`
- 创建：`services/gateway/internal/runtimeconfig/config.js`
- 修改：`services/gateway/internal/httpapi/server.go`
- 修改：`vite.config.mjs`
- 修改：`tests/gateway/routingContract.spec.js`
- 修改：`tests/gateway/contentTypeNginx.spec.js` 或重命名为 `tests/gateway/contentType.spec.js`

- [ ] **步骤 1：写静态资源测试**

覆盖：

- `/assets/*` 使用缓存策略。
- `/conf/config.js` 不含秘密。
- `apple-touch-icon.png`、`icon-192.png`、`icon-512.png` 返回 `image/png`。
- `site.webmanifest` 返回 `application/manifest+json`。
- `robots.txt` 和 `sitemap.xml` 返回正确 MIME。
- 缺失资源返回 404，不进入 SPA fallback。
- APP、API、SHORT 三个 Host 行为不同。
- 未知 Host 返回 421。

- [ ] **步骤 2：实现静态 handler**

使用 `http.FileServer` 前先处理显式资源路由和 MIME，随后对允许的页面路径执行 SPA fallback。静态目录由 CLI 参数或构造器传入，不在 handler 内硬编码工作目录。

- [ ] **步骤 3：迁移 Vite 开发代理**

`vite.config.mjs` 的开发模式改为：

- `/short-api` 代理到本地 Gateway。
- 不再让浏览器开发服务器直接连接 MyUrls。
- 保留敏感头清理测试。
- 保留 `LOCAL_SUBWEB_PORT` 范围校验。

- [ ] **步骤 4：运行前端和 Gateway 测试**

运行：

```sh
npm test -- tests/gateway tests/project
npm run build
```

预期：前端构建成功，静态资源合同全部通过。

- [ ] **步骤 5：提交**

```sh
git add services/gateway/internal/staticfiles services/gateway/internal/runtimeconfig services/gateway/internal/httpapi vite.config.mjs tests/gateway
git commit -m "feat: serve Vue assets from Go gateway"
```

### 任务 9：实现 MyUrls Rust v2 适配器

**文件：**
- 创建：`services/gateway/internal/myurls/client.go`
- 创建：`services/gateway/internal/myurls/client_test.go`
- 创建：`services/gateway/internal/myurls/handler.go`
- 创建：`services/gateway/internal/myurls/handler_test.go`
- 修改：`src/features/short-link/` 下现有短链模块
- 修改：`tests/integration/shortLink.spec.js`
- 修改：`tests/gateway/routingContract.spec.js`

- [ ] **步骤 1：写 MyUrls 合同测试**

覆盖：

- APP 域只允许 `POST /short-api/links`。
- JSON Content-Type 必须正确。
- 查询参数为空。
- 请求体不超过 16 KiB。
- 内部请求目标为 `/api/links`。
- 清除 Authorization、Proxy-Authorization、Cookie、Origin。
- Rust problem details 映射到前端稳定错误。
- `challenge` 和 `retryAfterSeconds` 保留。
- SHORT 域只允许短码跳转。
- MyUrls 管理 API、UI 和 health 路径不公开。

- [ ] **步骤 2：定义上游客户端接口**

```go
type Client interface {
    Create(ctx context.Context, body []byte, headers http.Header) (*http.Response, error)
    Resolve(ctx context.Context, code string) (*http.Response, error)
    Health(ctx context.Context) error
}
```

Gateway 只依赖此接口，不直接拼接 MyUrls 路径。

- [ ] **步骤 3：实现适配器**

要求：

- `Create` 只转发 JSON body。
- `Resolve` 只接收符合短码正则和长度限制的 code。
- 每次请求生成或传播安全 request ID。
- 不把旧 Node `/api/v1/links` 作为隐式 fallback。
- 上游 Redis、Token 和连接错误不外泄。

- [ ] **步骤 4：更新前端短链模块**

保持现有 `ShortLinkClient` 与 `ShortLinkWorkflow` 的公共行为：

- challenge。
- retry。
- stale-result。
- UTF-8 长度预检。
- 复制。
- 错误码到用户提示的映射。

前端只访问同源 `/short-api/links`。

- [ ] **步骤 5：运行测试并提交**

运行：

```sh
npm test -- tests/integration/shortLink.spec.js tests/gateway/routingContract.spec.js
npm run build
cd services/gateway
go test -race ./internal/myurls
```

预期：全部通过。

```sh
git add services/gateway/internal/myurls src tests/integration tests/gateway
git commit -m "feat: adapt Rust MyUrls through Go gateway"
```

---

## 5. 功能开关与 Compose 收敛

### 任务 10：实现功能开关的前端合同

**文件：**
- 修改：`src/runtime/`
- 修改：`src/features/`
- 修改：`src/views/`
- 修改：`public/conf/config.js`
- 创建或修改：`tests/runtime/featureFlags.spec.js`
- 修改：`tests/components/` 下相关测试

- [ ] **步骤 1：写失败测试**

覆盖：

```js
it('hides short-link controls when short links are disabled', () => {})
it('does not load Turnstile when short links are disabled', () => {})
it('hides custom backend controls when custom backend is disabled', () => {})
it('still uses configured API URL when custom backend is disabled', () => {})
```

- [ ] **步骤 2：定义公开运行时配置**

`config.js` 只输出：

```js
window.__SUBWEB_CONFIG__ = {
  apiUrl,
  shortLinksEnabled,
  customBackendEnabled,
  turnstileSiteKey,
}
```

不得输出 secret key、Redis 配置、内部 upstream、CIDR 或镜像信息。

- [ ] **步骤 3：实现条件渲染与请求保护**

- 短链关闭时不加载短链客户端和 Turnstile。
- 自定义后端关闭时不渲染控件，并在请求构造层拒绝伪造参数。
- 能力关闭必须同时反映在 loading、错误、复制和 stale-result 状态。

- [ ] **步骤 4：运行测试并提交**

运行：

```sh
npm test -- tests/runtime tests/components
npm run lint
npm run build
git add src public tests
git commit -m "feat: add runtime business feature flags"
```

预期：测试、lint 和 build 全部通过。若 shell 对前导空格报错，重新执行无前导空格的 commit 命令，不修改文件。

### 任务 11：将 Compose 改为唯一生产合同

本任务固定删除旧 `compose.hardened.yaml` 和 `Dockerfile.simple`，不再保留 simple/hardened 两套正式生产语义；上一版本完整文件由 Git release tag 和 release manifest 回滚。

**文件：**
- 重写：`compose.yaml`
- 创建：`compose.disabled-short-links.yaml` 或使用 Compose profile（两者只选一种；优先使用 profile）
- 重写：`Dockerfile`
- 删除：`Dockerfile.simple`
- 删除：`compose.hardened.yaml`（迁移完成后由 Git 历史和上一 release manifest 提供回滚，不保留第二套正式 Compose 合同）
- 修改：`scripts/validate-compose.sh`
- 修改：`tests/deploy/composeStack.spec.js`
- 修改：`tests/deploy/composeProfiles.spec.js`
- 创建：`tests/deploy/featureFlagCompose.spec.js`

- [ ] **步骤 1：写 Compose 失败测试**

测试必须验证：

- 默认完整拓扑包含 `gateway`、`subconverter`、`myurls`、`redis`。
- 只有 Gateway 发布 `127.0.0.1:${SUBWEB_PORT}:8080`。
- Gateway、SubConverter、MyUrls、Redis 的网络成员符合设计。
- `subconverter-egress` 为 internal。
- MyUrls 数据网络为 internal。
- Gateway 不连接 Redis 网络。
- 短链关闭 profile 只保留 Gateway 和 SubConverter。
- 关闭短链时 Compose 不强制要求 MyUrls、Redis、Turnstile 秘密。
- 所有容器非 root、只读根文件系统、`cap_drop: ALL` 和 `no-new-privileges`。

- [ ] **步骤 2：实现 Go Gateway Dockerfile**

采用三阶段：

```dockerfile
FROM node:24-alpine@<locked-digest> AS frontend
# npm ci && npm run build

FROM golang:1.25-alpine@<locked-digest> AS gateway
# go test ./... && CGO_ENABLED=0 go build ...

FROM gcr.io/distroless/static-debian12:nonroot@<locked-digest>
# copy gateway binary, dist, CA certificates, timezone data
USER nonroot:nonroot
ENTRYPOINT ["/app/gateway"]
```

实际 digest 必须写入 `deploy/versions.lock.json`，不能提交可变引用。

- [ ] **步骤 3：实现 Compose 服务选择**

默认服务：

- `gateway`
- `subconverter`
- `myurls`
- `redis`

短链关闭 profile：

- `gateway`
- `subconverter`

Gateway 负责连接 SubConverter；启用短链时额外连接 MyUrls。Redis 只为启用的 MyUrls 和 Redis 限流提供服务。

- [ ] **步骤 4：更新 Compose 验证器**

验证器必须读取 `docker compose config --format json`，对最终渲染配置检查服务、端口、网络、用户、只读、capability、健康检查、依赖和镜像 digest。不能只检查 YAML 文本。

- [ ] **步骤 5：运行部署测试并提交**

运行：

```sh
npm test -- tests/deploy/composeStack.spec.js tests/deploy/composeProfiles.spec.js tests/deploy/featureFlagCompose.spec.js
./scripts/validate-compose.sh
docker compose config --quiet
```

预期：默认和短链关闭两种配置均通过，其他服务集合、公开端口或网络变体均被拒绝。

```sh
git add compose.yaml Dockerfile scripts/validate-compose.sh tests/deploy
# 只有确认历史文件已不再作为正式合同后，才执行删除/冻结对应操作
git commit -m "feat: make secure Compose the sole production topology"
```

---

## 6. 部署入口、版本锁和运维

### 任务 12：重写配置与部署脚本

**文件：**
- 修改：`scripts/configure.sh`
- 修改：`scripts/docker-deploy.sh`
- 创建：`scripts/subweb.sh`
- 修改：`.env.example`
- 修改：`scripts/lib/config.sh`
- 修改：`tests/deploy/configureScript.spec.js`
- 修改：`tests/deploy/dockerImageDeploy.spec.js`
- 创建：`tests/deploy/featureFlagDeploy.spec.js`

- [ ] **步骤 1：写脚本合同测试**

覆盖：

- 缺 Docker/Compose 时失败。
- 域名重复、非法端口、非法 URL 时失败。
- 短链关闭时不要求 Turnstile、Redis 和 IP hash secret。
- 开启短链时自动生成并稳定保留秘密。
- `.env` 原子更新且权限为 `0600`。
- `subweb install`、`up`、`down`、`status`、`logs`、`verify`、`backup`、`upgrade` 均调用固定 Compose 文件。
- 镜像必须使用 digest 或允许的 immutable sha tag。
- 部署命令使用 `--no-build --pull never`，避免运行时漂移。

- [ ] **步骤 2：实现单一 CLI 入口**

`subweb.sh` 只做参数处理、配置调用、Compose 调用和状态显示。它不实现业务逻辑，不输出秘密，不将用户参数拼接进未校验的 shell 代码。

- [ ] **步骤 3：运行脚本测试**

运行：

```sh
npm test -- tests/deploy/configureScript.spec.js tests/deploy/dockerImageDeploy.spec.js tests/deploy/featureFlagDeploy.spec.js
sh -n scripts/configure.sh scripts/docker-deploy.sh scripts/subweb.sh
```

预期：全部通过。

- [ ] **步骤 4：提交**

```sh
git add scripts .env.example tests/deploy
git commit -m "feat: add single production deployment entrypoint"
```

### 任务 13：更新版本锁和生产 readiness

**文件：**
- 修改：`deploy/versions.lock.json`
- 修改：`scripts/verify-version-locks.mjs`
- 修改：`scripts/verify-production-readiness.mjs`
- 修改：`scripts/verify-release.sh`
- 修改：`.github/workflows/docker-build-release.yml`
- 修改：`tests/deploy/versionLocks.spec.js`
- 修改：`tests/project/releaseGate.spec.js`

- [ ] **步骤 1：写版本锁失败测试**

验证：

- Gateway Go 基础镜像来源、tag、commit、digest 和平台 digest 完整。
- SubConverter、MyUrls、Redis 引用与 Compose 一致。
- MyUrls 使用固定上游仓库和 Rust `v2.x.y` tag。
- MyUrls GHCR 仓库与镜像引用一致。
- `runtime_images` rollback 列表由锁文件生成。
- 镜像 tag 与 digest 不属于不同版本。

- [ ] **步骤 2：实现生产 readiness fail-closed**

`verify-production-readiness.mjs` 必须在以下情况失败：

- `services.myurls` 缺失。
- `services.myurls` 为字符串、数组或其他非对象。
- 启用短链却缺 MyUrls、Redis 或锁定配置。
- Gateway、Request Policy、SubConverter 的必要配置缺失。
- Compose 服务、网络或端口不符合唯一生产合同。

短链关闭的精简 profile 必须通过显式 profile 参数验证，而不是让校验器默认为缺服务合法。

- [ ] **步骤 3：统一 CI 和 release 命令**

GitHub quality job、本地 `verify-release.sh` 和任何发布辅助脚本都调用：

```sh
npm run verify:ci
```

发布脚本必须保留明确终端标记：

```text
release verification=passed
```

- [ ] **步骤 4：运行锁和发布合同测试**

运行：

```sh
npm test -- tests/deploy/versionLocks.spec.js tests/project/releaseGate.spec.js
npm run verify:locks
npm run verify:compose
```

预期：全部通过；锁文件变化必须与 Dockerfile、Compose 和发布脚本同时提交。

- [ ] **步骤 5：提交**

```sh
git add deploy/versions.lock.json scripts/verify-version-locks.mjs scripts/verify-production-readiness.mjs scripts/verify-release.sh .github/workflows/docker-build-release.yml tests
git commit -m "ci: lock unified gateway release contract"
```

### 任务 14：实现备份、恢复和运维验证

**文件：**
- 修改：`scripts/verify-redis-operations.sh`
- 修改：`scripts/operations/`
- 修改：`docs/operations.md`
- 修改：`docs/deployment-docker.md`
- 创建：`tests/operations/unifiedStackRecovery.spec.js`

- [ ] **步骤 1：写恢复测试**

覆盖：

- Redis 备份不包含配置秘密。
- 临时 Redis 恢复后短链仍可解析。
- Redis 重启后 MyUrls 和 Gateway readiness 恢复。
- Gateway 重启后所有启用路由恢复。
- SubConverter 重启后转换恢复。
- 升级失败不删除 Redis named volume。
- 回滚使用完整 release manifest。

- [ ] **步骤 2：实现运维命令**

提供：

```sh
./scripts/subweb.sh backup
./scripts/subweb.sh restore --backup <validated-path>
./scripts/subweb.sh verify
```

恢复命令在写入正式数据卷前必须完成备份路径、文件权限、Redis 响应和短链 smoke test 校验。

- [ ] **步骤 3：运行恢复验证**

运行：

```sh
npm test -- tests/operations/unifiedStackRecovery.spec.js
npm run verify:operations
```

预期：恢复、重启和失败回滚路径全部通过。

- [ ] **步骤 4：提交**

```sh
git add scripts/operations scripts/verify-redis-operations.sh docs/operations.md docs/deployment-docker.md tests/operations
git commit -m "feat: verify unified stack backup and recovery"
```

---

## 7. 删除旧实现并完成集成验证

### 任务 15：移除旧 Gateway/Request Policy 运行路径

**文件：**
- 删除：`services/request-policy/src/`
- 删除：`services/request-policy/package.json`
- 删除：`nginx/templates/` 和 `nginx/snippets/` 中已被 Go 接管的业务路由模板；保留外部反向代理示例文件，并在任务 17 更新引用
- 删除：`Dockerfile.simple`
- 删除：`compose.hardened.yaml`；回滚依赖上一 release manifest，不保留第二套正式 Compose 合同
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`tests/` 中引用旧运行路径的测试

- [ ] **步骤 1：先确认所有调用点**

运行：

```sh
npm test
npm run lint
```

读取失败引用的具体文件。只有确认 Go Gateway 已覆盖对应合同、并且新版集成测试已经通过后，才删除旧实现。

- [ ] **步骤 2：删除旧运行时依赖**

移除 Request Policy 的 Node package 和不再使用的 Docker build 依赖。不要删除仍由本地开发脚本或测试使用的通用 Shell 工具。

- [ ] **步骤 3：运行全量静态检查**

运行：

```sh
npm ci
npm run lint
npm run build
cd services/gateway
go test -race ./...
go vet ./...
go build ./cmd/gateway
```

预期：全部通过，且没有旧服务路径、旧端口或旧 Compose profile 的悬空引用。

- [ ] **步骤 4：提交**

```sh
git add -A
git commit -m "refactor: remove legacy gateway runtime"
```

### 任务 16：完成真实镜像集成测试

**文件：**
- 修改：`scripts/verify-integrated-stack.sh`
- 修改：`scripts/verify-container.sh`
- 修改：`scripts/verify-simple-stack.sh`（重命名或删除，不能继续表达旧 simple 合同）
- 创建：`scripts/verify-unified-stack.sh`
- 修改：`tests/integration/`
- 修改：`tests/deploy/singleHttpDeployment.spec.js`
- 修改：`tests/security/`

- [ ] **步骤 1：扩展集成场景**

真实 Docker 集成必须验证：

- JS、CSS、favicon、PWA、manifest、robots、sitemap 和 MIME。
- APP、API、SHORT Host 路由。
- 转换成功、策略拒绝、响应过大、超时和限流。
- 短链创建、跳转、过期和重启恢复。
- Gateway、SubConverter、MyUrls、Redis 分别重启。
- MyUrls 真实生产镜像，不使用 test-support adapter。
- 短链关闭 profile 的 2 容器拓扑。
- 自定义后端关闭的 UI 和 API 行为。
- 敏感头清理和日志隐私哨兵。

- [ ] **步骤 2：运行统一集成验证**

运行：

```sh
npm run verify:integration
npm run verify:operations
npm run verify:local
```

预期：所有服务健康，所有业务 smoke test 通过，所有重启后的 create/resolve recovery 通过。

- [ ] **步骤 3：提交**

```sh
git add scripts tests
git commit -m "test: verify unified gateway production stack"
```

---

## 8. 文档、发布和最终检查

### 任务 17：更新项目文档

**文件：**
- 修改：`README.md`
- 修改：`docs/architecture.md`
- 修改：`docs/configuration.md`
- 修改：`docs/deployment.md`
- 修改：`docs/deployment-docker.md`
- 修改：`docs/deployment-local.md`
- 修改：`docs/security.md`
- 修改：`docs/maintenance.md`
- 修改：`docs/operations.md`
- 修改：`docs/validation/docker-integration.md`
- 修改：`docs/validation/local-dev.md`
- 修改：`scripts/verify-docs.mjs`
- 修改：`tests/project/documentation.spec.js`

- [ ] **步骤 1：统一文档术语**

全文使用：

- 「统一 Gateway」指 Go 单二进制。
- 「完整生产拓扑」指默认 Compose 合同。
- 「短链关闭 profile」指业务能力精简，不表示关闭安全策略。
- 「单一部署入口」不写成「单容器部署」。
- 「外部反向代理」负责 TLS、证书和 DNS。

删除「默认 simple、不安全输入请另用 hardened」的旧描述，改为唯一生产合同和短链关闭 profile。

- [ ] **步骤 2：更新命令和配置表**

文档中的命令必须对应实际脚本：

```sh
./scripts/subweb.sh install ...
./scripts/subweb.sh up
./scripts/subweb.sh status
./scripts/subweb.sh verify
```

所有功能开关、必填条件、端口、域名和外部 TLS 责任必须与 `compose.yaml` 和 Go 配置一致。

- [ ] **步骤 3：运行文档验证**

运行：

```sh
npm run verify:docs
npm test -- tests/project/documentation.spec.js
git diff --check
```

预期：文档覆盖、链接、命令引用和格式全部通过。

- [ ] **步骤 4：提交**

```sh
git add README.md docs scripts/verify-docs.mjs tests/project/documentation.spec.js
git commit -m "docs: document unified Go gateway deployment"
```

### 任务 18：执行完整发布预检

**文件：**
- 不新增业务文件
- 检查：`package.json`
- 检查：`services/gateway/go.mod`
- 检查：`Dockerfile`
- 检查：`compose.yaml`
- 检查：`deploy/versions.lock.json`
- 检查：`.github/workflows/docker-build-release.yml`

- [ ] **步骤 1：执行前端和 Go 验证**

运行：

```sh
npm ci
npm run verify:ci
cd services/gateway
go test -race ./...
go vet ./...
go build ./cmd/gateway
cd ../..
```

预期：所有命令退出码为 `0`。

- [ ] **步骤 2：执行镜像、Compose 和安全验证**

运行：

```sh
npm run verify:locks
npm run verify:compose
npm run verify:integration
npm run verify:operations
npm run verify:docs
./scripts/verify-release.sh
```

预期：每个阶段通过，最后必须实际观察到：

```text
release verification=passed
```

- [ ] **步骤 3：执行最终差异检查**

运行：

```sh
git diff --check
git status --short
git log --oneline --decorate -20
```

预期：没有格式错误、没有未说明的生成文件、每个任务都有独立提交，且 `.pi/`、`.runtime/` 等用户目录没有被纳入提交。

- [ ] **步骤 4：记录偏离和发布证据**

将实际测试命令、退出码、镜像 digest、Compose service 集合、恢复结果和发布成功标记记录到 release evidence。禁止用截断日志或模型判断替代终端成功标记。

- [ ] **步骤 5：提交最终验证记录**

```sh
git add docs/validation deploy/versions.lock.json
git commit -m "chore: record unified gateway release evidence"
```

只有完整预检通过且成功标记已观察到，才允许进入分支收尾、合并或发布流程。

---

## 规格覆盖检查

| PRD 要求 | 对应任务 |
| --- | --- |
| Vue 3 + Vite 静态 SPA | 任务 8、任务 10、任务 17 |
| Go 1.25 单二进制 Gateway | 任务 1、任务 2、任务 8、任务 11 |
| Request Policy 迁移 | 任务 3、任务 4、任务 5、任务 6、任务 7 |
| SSRF/DNS 与 DNS rebinding 防护 | 任务 3、任务 6、任务 7、任务 16 |
| SubConverter 独立容器 | 任务 7、任务 11、任务 16 |
| MyUrls Rust v2 独立容器 | 任务 9、任务 11、任务 16 |
| Redis DB `0` / `1` 分工 | 任务 5、任务 9、任务 14 |
| `SHORT_LINKS_ENABLED` | 任务 1、任务 10、任务 11、任务 12、任务 16 |
| `CUSTOM_BACKEND_ENABLED` | 任务 1、任务 10、任务 16 |
| 安全控制不可关闭 | 任务 1、任务 4、任务 11、任务 13 |
| APP/API/SHORT 路由 | 任务 2、任务 8、任务 9、任务 16 |
| 统一 problem details | 任务 1、任务 2、任务 7、任务 9 |
| 外置 TLS | 任务 8、任务 12、任务 17 |
| 单一 Compose 部署入口 | 任务 11、任务 12、任务 17 |
| 非 root、只读、capability 和网络隔离 | 任务 11、任务 16 |
| 备份与恢复 | 任务 14、任务 16 |
| 版本锁与不可变镜像 | 任务 11、任务 13、任务 18 |
| CI/release 共用 `verify:ci` | 任务 13、任务 18 |
| 发布成功标记 | 任务 13、任务 18 |
| 文档同步 | 任务 17 |
| 完整发布验收 | 任务 18 |

## 执行依赖

```text
任务 0
  -> 任务 1 -> 任务 2
  -> 任务 3 -> 任务 4 -> 任务 5 -> 任务 6 -> 任务 7
  -> 任务 8 -> 任务 9 -> 任务 10
  -> 任务 11 -> 任务 12 -> 任务 13 -> 任务 14
  -> 任务 15 -> 任务 16 -> 任务 17 -> 任务 18
```

任务 8、任务 9 和任务 10 可以在任务 7 的转换链路稳定后分开执行；任务 11 必须等待 Gateway、转换和短链适配器的合同测试通过。任务 15 是破坏性删除，只能在任务 16 的新旧行为差异检查完成后执行。

## 计划自检结论

- 每个 PRD 章节均有对应任务和退出标准。
- 所有新接口在首次使用前定义。
- 每个实现任务均先写测试，再实现，再运行验证，再提交。
- 每个任务使用精确路径和可执行命令。
- 计划不依赖单容器多进程，也不提供关闭安全边界的路径。
- 旧 Node/Nginx 实现只在迁移验证完成后删除。
- 发布成功以 `release verification=passed` 为唯一终端证据。
