# 安全边界

## 部署边界

Subweb 不管理公网 TLS。部署者的外层反向代理负责证书、TLS、HSTS、DNS 和 80/443 端口，并将保留 Host 的请求转发到 Gateway loopback 端口。Gateway 是唯一发布宿主机端口的 Compose 服务；Redis、两个 MyUrls 实例和 SubConverter 不发布端口。

生产短链 profile 固定为五个服务；外部镜像和运行时版本均由版本锁定合同约束。MYURLS 依赖只通过固定的 APP/SHORT adapter 边界访问。关闭短链时使用显式的两服务 profile。不要引入第二套生产部署拓扑来获得“加固”效果：策略和 egress 已在 Go Gateway 中统一实现。

## 外部订阅

订阅 URL 是处理过程中的短暂敏感数据，不是可提供“绝对不泄露”保证的数据类型：SubConverter 必须在内存中读取它并访问远端。项目保证的是最小化暴露面：URL 不写入 Gateway 日志、SubConverter 过滤日志、配置文件或 Redis；但主机 root、容器管理员或已取得进程执行权限的攻击者仍可能读取运行时内存或系统调用信息。

因此生产入口必须由部署者在 TLS 反向代理层启用认证或网络准入（Cloudflare Access、VPN、Basic Auth 等）。不要把一个共享访问令牌硬编码到前端：浏览器端令牌对访问者可见，不能解决匿名滥用或订阅保密问题。

`/sub` 请求受到以下 SSRF 和请求策略约束：

- 请求体上限 `16 KiB`，上游响应上限 `8 MiB`。
- 总请求超时 `10 s`，DNS 与 CONNECT 各有独立有限上限。
- 并发上限为 `2`，转换 IP 限流状态使用 Redis DB `1`。
- URL 必须具有合法 host；HTTP 只允许 loopback，公网请求必须使用 HTTPS。
- DNS 只解析一次，并拒绝私网、loopback、link-local、特殊用途、scoped IPv6 和 rebinding 地址。
- CONNECT 只允许 `:443`，授权证据一次性使用，连接直接拨打已验证 IP。
- SubConverter 只在内部 egress 网络中运行，不能直接访问公网。

策略错误必须 fail closed。依赖请求会移除 `Authorization`、`Proxy-Authorization`、`Cookie`、`Origin` 和客户端自带的 `X-Forwarded-*`/`X-Real-IP`，只使用 Gateway 重建的身份头。

## 短链与 MyUrls

APP 与 SHORT 使用独立的 MyUrls Rust v2 实例：APP 只处理创建，SHORT 只处理短码跳转。管理 API 不通过 SHORT Host 暴露。MyUrls 使用 Redis DB `0`，Gateway 限流使用 DB `1`，两个用途不可混用。

短链目标按 TTL 保存；短链属于持有即可访问的数据。短码、Token、订阅 URL 和完整 IP 不应进入日志、截图或 Issue。MyUrls 的 RFC 9457 problem-details 只在 Gateway adapter 中映射为允许的错误和 challenge/retry 元数据。

高敏感订阅不应启用短链；关闭短链可避免目标地址持久化到 Redis，但不会改变转换器在处理期间必须读取原始订阅 URL 的事实。

## 容器与密钥

所有服务启用只读 root filesystem、`cap_drop: ALL` 和 `no-new-privileges`。SubConverter 的启动 bootstrap 只暂时授予 `CHOWN`、`SETUID`、`SETGID`，并通过只读 passwd/group 映射降权；运行时 PID 1 必须是 UID `101` 且 `CapEff=0`。

`REDIS_PASSWORD` 和 `IP_HASH_SECRET` 应由配置脚本生成，长度和格式由脚本验证。Redis 命令使用容器内 `REDISCLI_AUTH`，不把密码放进宿主机 argv。不要执行 `cat .env`、在 CI 日志打印环境变量，或把 Turnstile secret 写入 public runtime config。

## 日志与上游责任

容器日志限制为 `10m`、最多 `3` 个文件，时区为 `Asia/Shanghai`。Gateway/SubConverter 日志过滤敏感 URL、Query、Token、IP 和短码。浏览器从转换结果中得到的 `proxy-providers` URL 由最终客户端直接访问，不经过本服务的 egress；用户必须理解这是客户端边界。
