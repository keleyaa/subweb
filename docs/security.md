# 安全边界

## 请求边界

- APP 的 `/short-api/v1/links` 只接受 POST、JSON、空查询参数和精确的 APP Origin。
- Gateway 清除 Authorization、Proxy-Authorization、Cookie 和 Origin 后再转发请求。
- SHORT 域透明代理 MyUrls，由 MyUrls 自行校验同源请求、JSON Schema、URL 和 Turnstile。
- API 域的 `/sub` 先进入 `Request Policy Service`，执行 URL 协议、主机地址、端口、大小、超时、并发和匿名频率限制，再转发到 SubConverter；上传能力保持关闭，`print_debug_info = false`。

MyUrls 拒绝 loopback、私网和不安全 URL，以降低 SSRF 与开放重定向风险。策略服务对转换请求执行输入级 SSRF 防护，并在 DNS 解析结果上拒绝 loopback、私网、link-local 和保留地址。SubConverter 仅加入内部 `subconverter-egress` 网络，强制通过策略服务的 HTTPS CONNECT egress proxy 访问远程 HTTPS：代理在单一安全边界内解析目标、校验地址并按已验证 IP 建连，避免 DNS rebinding 使二次解析绕过策略。部分转换结果仍会生成由最终客户端继续拉取的 `proxy-providers` URL；这些客户端侧请求不经过本服务。短码和订阅链接都属于持有即可访问的数据，不应进入日志、分析系统或公开工单。

## 客户端 IP

Gateway 到 MyUrls 使用独立的内部网络，MyUrls 默认只信任固定的 Gateway 地址。Gateway 覆盖而不是追加 `X-Forwarded-For` 和 `Forwarded`。Request Policy Service 只在 Compose 内部网络可访问，并使用 Redis DB `1` 保存带 TTL 的匿名限流计数。外部 `TRUSTED_PROXY_CIDR` 必须是实际的反代来源，禁止使用 `0.0.0.0/0`。

## 秘密

`REDIS_PASSWORD`、`IP_HASH_SECRET` 和 Turnstile secret key 只存在于权限为 `0600` 的
`.env` 和容器环境中。浏览器运行时配置不包含秘密。不要输出完整环境、Turnstile token、
长 URL、短码或 Redis key/value。

## 生产策略

- MyUrls 生产镜像使用 semver 标签和 manifest digest；升级镜像时，必须同步更新版本锁文件并重新完成安全验证。
- `MYURLS_IMAGE` 仅用于经过确认的版本回滚。
- MyUrls、Redis、SubConverter 和 Request Policy Service 不发布宿主机端口。
- Gateway、MyUrls、Request Policy Service 和 Redis 使用只读根文件系统、最小 capabilities 和日志轮转。
- 所有服务统一使用 `Asia/Shanghai` 时区。

SubConverter 的 `verbose` 与调试日志必须保持关闭；验证脚本使用哨兵确认订阅值、挑战
token、Redis 密码和 IP 哈希秘密不会出现在服务日志。

镜像发布门禁扫描最终镜像、Redis、SubConverter 和 MyUrls 的高危与严重漏洞。当前 Redis 和
SubConverter 的 OpenSSL 运行时依赖各有一条经过范围限定的 `CVE-2026-14456` 例外，分别记录在
`.trivyignore.redis` 和 `.trivyignore.subconverter` 中。这些例外不适用于其他镜像，且每次升级对应
镜像时都必须重新审查。
