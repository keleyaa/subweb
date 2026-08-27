# 安全边界

## 请求边界

- APP 的 `/short-api/v1/links` 只接受 POST、JSON、空查询参数和精确 APP Origin。
- Gateway 清除 Authorization、Proxy-Authorization、Cookie 和 Origin 后再转发。
- SHORT 域透明代理 MyUrls，由 MyUrls 自己校验同源请求、JSON schema、URL 和 Turnstile。
- API 域只代理 SubConverter，关闭上传能力并保持 `print_debug_info = false`。

MyUrls 拒绝 loopback、私网和不安全 URL，降低 SSRF 与开放重定向风险。短码和订阅链接都属于
持有即可访问的数据，不应进入日志、分析系统或公开工单。

## 客户端 IP

Gateway 到 MyUrls 使用独立内部网络，MyUrls 默认只信任固定 Gateway 地址。Gateway 覆盖而
不是追加 `X-Forwarded-For` 和 `Forwarded`。外部 `TRUSTED_PROXY_CIDR` 必须是实际
反代来源，禁止 `0.0.0.0/0`。

## 秘密

`REDIS_PASSWORD`、`IP_HASH_SECRET` 和 Turnstile secret key 只存在于权限为 0600 的
`.env` 和容器环境。浏览器运行时配置不包含秘密。不要输出完整环境、Turnstile token、
长 URL、短码或 Redis key/value。

## 生产策略

- MyUrls 生产镜像必须使用 semver + manifest digest，禁止 `latest`。
- `MYURLS_IMAGE` 仅用于经过确认的固定版本回滚。
- MyUrls、Redis、SubConverter 不发布宿主机端口。
- Gateway、MyUrls 和 Redis 使用只读根文件系统、最小 capabilities 与日志轮转。
- 所有服务时区统一为 `Asia/Shanghai`。

SubConverter 的 `verbose` 与调试日志必须保持关闭；验证脚本使用哨兵确认订阅值、挑战
token、Redis 密码和 IP 哈希秘密不会出现在服务日志。

所有服务统一使用 `Asia/Shanghai` 时区。
