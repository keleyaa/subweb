# 单一 HTTP Docker 集成验证

## 目的

该验证确认统一生产栈作为用户可访问的 HTTP 服务工作，而不是只确认容器处于 running。入口是：

```sh
npm run verify:integration
```

脚本 [`scripts/verify-integrated-stack.sh`](../../scripts/verify-integrated-stack.sh) 委托 [`scripts/verify-unified-stack.sh`](../../scripts/verify-unified-stack.sh)。恢复演练不在这个脚本中重复实现，由 `npm run verify:operations` 调用独立的 Redis operations verifier。

## 覆盖范围

启用短链的五服务 profile 使用锁定的 MyUrls Rust v2.0.6、SubConverter 和 Redis production 镜像，并检查：

- APP、API、SHORT 三个 Host 的路由隔离；
- `config.js`、favicon、manifest、PWA 图标、robots 和 sitemap 的状态与 MIME；
- `/sub` 的允许输入、inline conversion、私网 URL 拒绝、请求大小、响应大小、超时、并发和限流；
- `/short-api/links` 创建、SHORT 短码解析、TTL 过期、Turnstile challenge/retry 和错误 problem-details；
- Gateway、SubConverter、`myurls-app`、`myurls-short` 和 Redis 的独立重启恢复；
- Authorization、Cookie、Origin、Proxy-Authorization、客户端转发头、订阅 URL、Token 和 IP 的日志/依赖边界隐私；
- `SHORT_LINKS_ENABLED=false` 的两服务 profile：不读取 Redis、MyUrls、SHORT 域名或 Turnstile 私钥，同时普通转换仍可用。

超时、过大响应和依赖 header 清理使用脚本内的 test-only fixture overlay；该 overlay 仅替换 SubConverter，以确定性的本地上游覆盖边界行为，同时保留生产 Gateway、MyUrls、Redis 服务和网络拓扑。它不属于生产 Compose。

## 运行要求

- Docker Engine、Docker Compose v2、curl、awk、Node.js 24 和 npm 11；
- 可访问 Docker Hub/GHCR 的网络；
- 足够的镜像和 volume 空间；
- 运行结束后脚本必须清理其临时 Compose project、volume 和环境文件。

失败时保留终端中最后一个明确失败阶段，并先检查脚本输出和 Docker 状态；不要用旧的 Nginx、Request Policy 或历史 Compose 验证器代替本验证。
