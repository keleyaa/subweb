# 架构

Subweb 面向外置 TLS 的自托管部署。项目自己的 Go Gateway 与 Request Policy 已统一为一个 Go 1.27 单二进制；前端是 Vue 3 + Vite 静态 SPA；短链存储内嵌在 Gateway 的 SQLite 数据库中；SubConverter 保持独立容器，镜像及来源由 `deploy/versions.lock.json` 锁定。公网只看到外层 TLS 入口和 Gateway 的 loopback 转发端口。

## 生产服务

短链启用时，`compose.yaml` 运行以下两个服务：

| 服务 | 作用 | 对外发布 |
| --- | --- | --- |
| `gateway` | APP/API/SHORT Host 路由、静态资源、转换策略、限流、内嵌短链与 SQLite 存储、内部 CONNECT egress | 仅 `127.0.0.1:<SUBWEB_PORT>` |
| `subconverter` | 订阅转换执行器 | 无 |

当 `SHORT_LINKS_ENABLED=false` 时选择 `compose.disabled-short-links.yaml`，只部署 `gateway` 和 `subconverter`，即受支持的两服务 profile。这是一个完整的受支持 profile，不是通过删改生产 Compose 服务临时拼出的状态。

启动时 Gateway 先独立就绪，SubConverter 在 Gateway 的健康检查通过后再启动；这是因为 SubConverter 必须通过 Gateway 的内部 HTTPS CONNECT egress 访问外部订阅。

## 请求路径

1. 外部 TLS 代理保留请求 Host，将请求转发到 Gateway。
2. Gateway 验证 Host，依 Host 选择 APP、API 或 SHORT 路由，清理凭据、Origin 和伪造的转发头后重建受信任的客户端身份头。
3. `/sub` 请求先经过 URL、DNS、响应大小、超时、并发和 IP 限流策略，再由 Gateway 访问 SubConverter。
4. SubConverter 的外部订阅访问只通过 Gateway 的内部 `:25502` HTTPS CONNECT listener；授权时解析并验证地址，连接时使用已验证 IP，不允许第二次 hostname 解析。
5. 短链创建由 Gateway 内嵌实现处理：Turnstile siteverify 使用受限 `:25503` CONNECT listener 访问 `EGRESS_ALLOWED_HOSTS` 中列出的 hostname，未列出的目标在 DNS 解析前被拒绝。
6. APP 的 `/short-api/links` 创建请求和 APP、SHORT 的 `/code` 解析都由 Gateway 直接处理；Gateway 不向 SHORT 公开创建或管理接口。创建需要 Turnstile 校验与限流，解析只受速率限制。短链映射写入 Gateway 的 SQLite 数据库，限流状态保存在进程内，二者都不再依赖 Redis。

Gateway 的依赖响应采用完整内存缓冲，不支持流式传输、协议升级或任意 `ResponseWriter` 可选能力；这样 panic recovery 可以在提交响应前保持原子性。依赖边界会清理客户端凭据、Cookie、Origin 和未受信任的转发头，只转发 Gateway 重建的身份信息与有效 request ID。

所有容器日志使用 `Asia/Shanghai`，保留策略为单文件 `10m`、最多 `3` 个文件；敏感 URL、Token、IP 和短码不进入日志。

## 网络与权限

- Gateway 连接默认网络和内部 `subconverter-egress`；它在该网络边界内提供 `:25502` 订阅 egress 与 `:25503` 受限 egress 两个 CONNECT 监听。
- 短链数据库是 Gateway 独占的 `links-data` 命名卷，不挂载到其他服务。
- SubConverter 只连接内部 `subconverter-egress`，不能绕过 Gateway 直接访问公网。
- 所有长驻服务使用只读 root filesystem、丢弃 Linux capabilities 和 `no-new-privileges`。
- SubConverter 需要极小的 root-only volume bootstrap，完成后以非 root 用户运行且 effective capabilities 为零；其他服务直接以非 root 用户运行。
- 数据库备份通过 Gateway 自身的 `--backup-links` 子命令生成一致性快照，避免直接复制正在写入的数据库文件。

## 数据边界

短链映射与到期时间只保存在 Gateway 的 SQLite 数据库（`/data/links.db`，WAL 模式）。限流 key 使用 HMAC-SHA256 处理后的客户端 IP，只存在于进程内计数器中，不记录原始 IP。普通转换 URL、转换结果和 Token 不写入数据库。短链是持有即可访问的数据，应按公开数据处理。
