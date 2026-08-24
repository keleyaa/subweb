# 三域名拆分实施状态

**更新时间**：2026-08-24
**PRD 文档**：`docs/prd-three-domain-separation.md`
**当前状态**：阶段 0-4 已完成；阶段 5 需要真实 staging 环境

## 实施结论

PRD 要求的 APP/API/SHORT 三域名模式、Legacy 兼容模式、Gateway 路由隔离、CORS 来源校验、TLS 三域名 SAN 校验、MyUrls 域名传播和本机七端口入口均已落地。集成验证脚本现在会显式传播 `DOMAIN_MODE`，direct-tls 预检请求由 Gateway 终止并返回 `204`。

启动脚本使用 POSIX shell 完成 `SHORT_URL` 安全转义，不再依赖最终 Nginx 镜像中不存在的 Python 运行时。Docker 基础镜像和锁文件使用 Nginx 1.30.4、Node 24 的 immutable digest。

## 阶段状态

### ✅ 阶段 0：基线冻结

- `npm test`、`npm run lint`、`npm run build`、文档/证据/锁校验均通过。

### ✅ 阶段 1：配置传播

- `SHORT_DOMAIN` 参数、Legacy 回退、三域名唯一性校验和 `SHORT_URL=https://SHORT_DOMAIN/short-api` 派生已完成。
- Compose 同时向 Gateway 和 MyUrls 传播短链域名，并保留既有秘密和镜像覆盖。

### ✅ 阶段 2：Gateway 三 Host

- APP、API、SHORT 和未知 Host 路由矩阵已覆盖。
- SHORT 路由不含前端 fallback；短码只允许单段 `[A-Za-z0-9_-]{1,64}`。
- CORS 只允许精确 APP origin；允许的 OPTIONS 由 Gateway 返回 `204`，不访问 MyUrls。
- direct-tls 要求证书覆盖 APP/API/SHORT 三个域名，并验证证书私钥匹配。

### ✅ 阶段 3：MyUrls 与前端

- MyUrls `MYURLS_DOMAIN` 使用 `SHORT_DOMAIN`，新短链返回 SHORT origin。
- APP 旧短链入口保留为迁移期兼容能力。
- `start.sh` 渲染公开运行时 URL 时不暴露 Token、Redis 密码或完整订阅 URL。

### ✅ 阶段 4：本机模式与自动验证

- `LOCAL_SHORT_PORT=18083` 已纳入配置生成、启动、状态、停止、端口冲突和持久性验证。
- README、架构、配置、安全、Docker/本机部署文档已同步三域名方案。
- Docker、behind-proxy、direct-tls、Redis 备份恢复和浏览器流程均有可执行验证。

## 自动门禁结果

| 门禁 | 结果 |
| --- | --- |
| `RUN_NGINX_GATEWAY_TESTS=1 RUN_DOCKER_INTEGRATION=1 npm test` | ✅ 44 个测试文件，373/373 通过 |
| `npm run lint` / `npm run build` | ✅ 通过 |
| `npm run verify:locks` / `verify:docs` / `verify:evidence` | ✅ 通过 |
| `npm run verify:compose` | ✅ 通过 |
| `npm run verify:container` | ✅ 通过 |
| `npm run verify:operations` | ✅ Redis 备份、清空、恢复通过 |
| `npm run verify:integration:behind-proxy` | ✅ Legacy 三域相关业务、持久性、日志隐私通过 |
| `npm run verify:integration:direct-tls` | ✅ Legacy、Three-domain、CORS、SAN/密钥/端口拒绝通过 |
| `npm run test:e2e` | ✅ 28/28 通过 |
| `npm audit --audit-level=moderate` | ✅ 0 vulnerabilities |

## 阶段 5：staging 仍需外部验证

仓库内自动门禁已绿，但以下事项必须在真实 staging 执行后才能宣称生产发布完成：

1. 三个真实 DNS 记录和真实证书 SAN。
2. 外层代理保留原始 Host、转发 HTTPS/CORS 响应头且未错误缓存短链创建响应。
3. 完整的转换→SHORT 创建→跳转→Redis 重启→再次跳转流程。
4. 旧 APP 短链、恶意/缺失 Origin、伪造 Authorization 和日志隐私证据。

未完成 staging 前，不应删除 APP 兼容入口或直接切换生产流量。
