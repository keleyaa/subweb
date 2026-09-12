# 安全边界

## 部署边界

Subweb 不管理公网 TLS。部署者的外层反向代理负责证书、TLS、HSTS、DNS 和 80/443 端口，并将保留 Host 的请求转发到 Gateway loopback 端口。Gateway 是唯一发布宿主机端口的 Compose 服务；Redis、一个 MyUrls 实例和 SubConverter 不发布端口。

默认生产短链 profile 使用四个服务；外部镜像和运行时版本均由版本锁定合同约束。MYURLS 依赖只通过固定的 APP/SHORT adapter 边界访问。关闭短链时使用显式的两服务 profile。生产部署仅支持多容器 Compose；策略和 egress 由 Go Gateway 统一实现。

## 外部订阅

订阅 URL 是处理过程中的短暂敏感数据，不是可提供“绝对不泄露”保证的数据类型：SubConverter 必须在内存中读取它并访问远端。项目保证的是最小化暴露面：URL 不写入 Gateway 日志、SubConverter 过滤日志、配置文件或 Redis；但主机 root、容器管理员或已取得进程执行权限的攻击者仍可能读取运行时内存或系统调用信息。

因此生产入口必须由部署者在 TLS 反向代理层启用认证或网络准入（Cloudflare Access、VPN、Basic Auth 等）。不要把一个共享访问令牌硬编码到前端：浏览器端令牌对访问者可见，不能解决匿名滥用或订阅保密问题。

`/sub` 请求受到以下 SSRF 和请求策略约束：

- 请求体上限 `16 KiB`，上游响应上限 `8 MiB`。
- 总请求超时 `10 s`，DNS 与 CONNECT 各有独立有限上限。
- 并发上限为 `4`，其中单个客户端最多占用 `2` 个槽位；转换 IP 限流状态使用 Redis DB `1`。
- URL 必须具有合法 host；HTTP 只允许 loopback，公网请求必须使用 HTTPS。
- DNS 只解析一次，并拒绝私网、loopback、link-local、特殊用途、scoped IPv6 和 rebinding 地址。
- CONNECT 只允许 `:443`，授权证据一次性使用，连接直接拨打已验证 IP。订阅 egress 与受限 egress 是两个独立监听：MyUrls 只能通过受限监听访问 `EGRESS_ALLOWED_HOSTS` 中列出的 hostname，SubConverter 才拥有订阅所需的通用 `:443` 通道。
- SubConverter 只在内部 egress 网络中运行，不能直接访问公网。

策略错误必须 fail closed。依赖请求会移除 `Authorization`、`Proxy-Authorization`、`Cookie`、`Origin` 和客户端自带的 `X-Forwarded-*`/`X-Real-IP`，只使用 Gateway 重建的身份头。

## 短链与 MyUrls

APP 与 SHORT 共用一个锁定的 MyUrls Rust v2.0.8 实例：APP 提供创建，APP/SHORT 均保留短码跳转；创建和管理 API 不通过 SHORT Host 暴露。MyUrls 不发布宿主机端口，只接受 Gateway 经内部网络转发的业务请求。`PUBLIC_BASE_URL` 为 SHORT 域名，创建挑战的 `TURNSTILE_HOSTNAME` 为 APP 域名，生产校验同时检查 `create_link` action。解析只有限流，没有解析挑战；合并不关闭安全校验，但创建和解析共享进程故障范围。MyUrls 使用 Redis DB `0`，Gateway 限流使用 DB `1`，两个用途不可混用。

短链目标按 TTL 保存；短链属于持有即可访问的数据。短码、Token、订阅 URL 和完整 IP 不应进入日志、截图或 Issue。MyUrls 的 RFC 9457 problem-details 只在 Gateway adapter 中映射为允许的错误和 challenge/retry 元数据。

MyUrls 只在内部网络中运行，没有直连公网的能力。创建挑战需要的唯一外部依赖是 Cloudflare Turnstile siteverify，它经 Gateway 的受限 `:25503` CONNECT 监听访问 `EGRESS_ALLOWED_HOSTS` 中列出的 hostname；不在列表中的目标会在 DNS 解析前被拒绝。siteverify 不可达时校验 fail closed，返回 `503 dependency_unavailable`，不会放行创建。

高敏感订阅不应启用短链；关闭短链可避免目标地址持久化到 Redis，但不会改变转换器在处理期间必须读取原始订阅 URL 的事实。

## 容器与密钥

多容器生产 profile 的所有服务启用只读 root filesystem、`cap_drop: ALL` 和 `no-new-privileges`；SubConverter 仅在启动 bootstrap 阶段使用 `CHOWN`、`SETUID`、`SETGID`，随后以非 root 用户运行并清除有效 capability。

`REDIS_PASSWORD` 和 `IP_HASH_SECRET` 应由配置脚本生成，长度和格式由脚本验证。Redis 命令使用容器内 `REDISCLI_AUTH`，不把密码放进宿主机 argv。不要执行 `cat .env`、在 CI 日志打印环境变量，或把 Turnstile secret 写入 public runtime config。

## 日志与上游责任

容器日志限制为 `10m`、最多 `3` 个文件，时区为 `Asia/Shanghai`。Gateway 访问日志只记录 `request_id`、host 类别（app/api/short）、方法、路由类别、状态和耗时，不记录 Query、订阅 URL、原始 IP、客户端请求头或完整短码，并跳过 `/healthz`、`/readyz` 健康探测；SubConverter 日志过滤敏感 URL、Query、Token、IP 和短码，并丢弃健康探测行。浏览器从转换结果中得到的 `proxy-providers` URL 由最终客户端直接访问，不经过本服务的 egress；用户必须理解这是客户端边界。
