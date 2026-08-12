# 架构说明

## 组件责任

| 组件 | 来源与责任 | 持久数据 |
| --- | --- | --- |
| Subweb 网关与前端 | 本仓库维护 UI、路由、鉴权注入、部署和测试 | 无 |
| SubConverter-Extended | 官方上游提供转换引擎，Compose 跟随 `latest` 并配置公共安全模式；锁文件保留已验证基线 | 可重建运行目录 |
| MyUrls | `keleyaa/MyUrls` 提供短链 API，Compose 跟随 `latest`；锁文件保留已验证基线 | 无，数据在 Redis |
| Redis | 保存短码到长链接的映射；Compose 跟随 `latest` | `redis-data` 是唯一业务持久卷 |
| Nginx | 同一入口承载静态页面和 Host/路径路由 | 无 |

## 请求路径

`APP_DOMAIN` 与 `API_DOMAIN` 必须不同，但指向同一网关。

维护者展示部署的实际域名为 `sub.ml1.one`（应用）和 `api.ml1.one`（API）；部署其他实例时应替换为自己的域名。

| 入口 | 路由 | 目标 |
| --- | --- | --- |
| `https://APP_DOMAIN/` | 静态文件与前端 history fallback | Subconverter Web |
| `https://APP_DOMAIN/short-api/short` | 去掉 `/short-api` 前缀并注入 `Authorization` | MyUrls `/short` |
| `https://APP_DOMAIN/<short-code>` | 保留短码路径 | MyUrls 跳转 |
| `https://API_DOMAIN/sub` | 保留路径和查询 | SubConverter |
| `https://API_DOMAIN/healthz` | 网关健康检查 | 网关 |

短链 Token 只存在于 `.env`、本机私有运行目录或平台秘密变量中。浏览器看到的 `/conf/config.js` 只包含公开 URL 和预设。网关必须先匹配 `/short-api/`，再匹配短码回退，避免创建请求被当成短码。

所有 Docker 服务显式使用 `Asia/Shanghai`，标准输出由 Compose 统一轮转。Gateway 只把
单段短码路由记为 `/:shortKey`，不把真实短码写入访问日志；成功健康检查也不进入访问
日志。SubConverter 通过监督器输出日志：在 Docker 的 `json-file` 或本机日志文件接收文本前，完整 URI 和
请求来源参数会被移除；受控偏好文件同时阻止旧运行卷重新启用 verbose。MyUrls 的内部日志策略由独立的
`keleyaa/MyUrls` 镜像版本负责，Subweb 在锁文件中保留已经发布并验证的镜像摘要作为集成测试与回滚基线。

## 数据流与信任边界

1. 浏览器把订阅 URL 和用户选项组成转换链接。打开转换链接时，SubConverter 及其访问的远程规则会看到订阅地址。
2. 创建短链时，浏览器把完整转换链接发到同源 `/short-api/short`。网关注入 Token 后交给 MyUrls，MyUrls 把映射写入 Redis。
3. 访问短码时，MyUrls 从 Redis 取出长链接并返回跳转。Base64 只是一种编码，不是加密。
4. Redis 密码、MyUrls Token、平台 Redis URL 和 TLS 私钥都不能写入前端配置、日志、文档示例或 Git。

## 部署边界

| 方式 | 公网入口 | TLS 责任 | 内部边界 |
| --- | --- | --- | --- |
| Docker `behind-proxy` | 外层代理 | 宝塔、1Panel、Nginx、OpenResty、Cloudflare 等 | Compose 只把网关绑定到 `127.0.0.1` |
| Docker `direct-tls` | 网关 80/443 | 部署者提供并续期证书 | MyUrls、Redis、SubConverter 仅在 Compose 网络 |
| 本机源码 | 默认 loopback 端口 | 仅开发；公开时由外层代理负责 | 六个本机进程按 PID 所有权管理 |

项目不要求 Caddy，也不会自动申请证书。Redis 卷或平台 Key Value/Redis 是备份、恢复和迁移的核心；其他组件应按 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 重建。
