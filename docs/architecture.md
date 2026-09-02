# 架构

Subweb 面向外置 TLS 的自托管部署。项目自己的 Go Gateway 与 Request Policy 已统一为一个 Go 1.25 单二进制；前端是 Vue 3 + Vite 静态 SPA；SubConverter、MyUrls Rust v2.0.6 和 Redis 保持独立容器。公网只看到外层 TLS 入口和 Gateway 的 loopback 转发端口。

## 生产服务

短链启用时，`compose.yaml` 运行以下五个服务：

| 服务 | 作用 | 对外发布 |
| --- | --- | --- |
| `gateway` | APP/API/SHORT Host 路由、静态资源、转换策略、限流、MyUrls 适配、内部 CONNECT egress | 仅 `127.0.0.1:<SUBWEB_PORT>` |
| `subconverter` | 订阅转换执行器 | 无 |
| `myurls-app` | APP 域名的短链创建和管理 API | 无 |
| `myurls-short` | SHORT 域名的短码解析和跳转 | 无 |
| `redis` | DB `0` 短链数据、DB `1` Gateway 限流状态 | 无 |

当 `SHORT_LINKS_ENABLED=false` 时选择 `compose.disabled-short-links.yaml`，只部署 `gateway` 和 `subconverter`，即受支持的两服务 profile。这是一个完整的受支持 profile，不是通过删改生产 Compose 服务临时拼出的状态。

## 请求路径

1. 外部 TLS 代理保留请求 Host，将请求转发到 Gateway。
2. Gateway 依 Host 选择 APP、API 或 SHORT 路由，并重建受信任的客户端身份头。
3. `/sub` 请求先经过 URL、DNS、响应大小、超时、并发和 IP 限流策略，再由 Gateway 访问 SubConverter。
4. SubConverter 的外部订阅访问只通过 Gateway 的内部 `:25502` HTTPS CONNECT listener；授权时解析并验证地址，连接时使用已验证 IP，不允许第二次 hostname 解析。
5. 短链创建只到 `myurls-app`，短码解析只到 `myurls-short`。Gateway Redis 限流使用 DB `1`，MyUrls 使用 DB `0`。

Gateway 的依赖响应采用完整内存缓冲，不支持流式传输、协议升级或任意 `ResponseWriter` 可选能力；这样 panic recovery 可以在提交响应前保持原子性。依赖边界会清理客户端凭据、Cookie、Origin 和未受信任的转发头，只转发 Gateway 重建的身份信息与有效 request ID。

所有容器日志使用 `Asia/Shanghai`，保留策略为单文件 `10m`、最多 `3` 个文件；敏感 URL、Token、IP 和短码不进入日志。

## 网络与权限

- Gateway 连接默认网络、`myurls-edge`、`redis-policy` 和内部 `subconverter-egress`。
- Redis 连接 `myurls-data` 与 `redis-policy`；MyUrls 连接 `myurls-data` 与 `myurls-edge`。
- SubConverter 只连接内部 `subconverter-egress`，不能绕过 Gateway 直接访问公网。
- 所有长驻服务使用只读 root filesystem、丢弃 Linux capabilities 和 `no-new-privileges`。
- SubConverter 需要极小的 root-only volume bootstrap，完成后 PID 1 以 UID `101` 运行且 effective capabilities 为零；其他服务直接以非 root 用户运行。
- Redis 密码不进入宿主机命令参数；恢复时通过容器内 `REDISCLI_AUTH` 传递。

## 数据边界

当前锁定的 MyUrls Rust v2.0.6 通过 `/api/links` 兼容合同提供短链映射；短链映射和 TTL 数据只保存在 Redis DB `0`。Gateway 限流 key 使用 HMAC-SHA256 处理后的客户端 IP，存放在 Redis DB `1`，不记录原始 IP。普通转换 URL、转换结果和 Token 不写入 Redis。短链是持有即可访问的数据，应按公开数据处理。
