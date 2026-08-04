# Subweb 集成日志与时区加固设计

## 目标

让集成栈的日志策略保持一致：短码不可从网关日志恢复、成功健康检查不制造噪音、容器日志有轮转上限，并显式声明中国标准时间。

## 方案

- Nginx 使用 `map` 把单段短码路径归一化为 `/:shortKey`，访问日志记录 ISO 8601 时间、方法、安全路由和状态码，不记录 Query、请求体或请求头。
- Gateway 镜像安装 `tzdata` 并设置 `TZ=Asia/Shanghai`；Compose 为所有服务传入相同 `TZ`。SubConverter 已原生支持该时区；新版 MyUrls 将显式支持该时区。
- Compose 对 Gateway、MyUrls、SubConverter 和 Redis 统一设置 `json-file` 日志轮转：单文件 10 MB，最多 3 个文件。
- 保留所有健康检查。Gateway 继续关闭 `/healthz` 访问日志；MyUrls 的成功健康日志由 MyUrls 仓库源头修复。
- 文档明确记录短码也是敏感凭据、禁止生产 verbose SubConverter 日志，并说明 MyUrls 镜像升级依赖。

## 兼容性边界

- 不改变网页、API、域名、端口、Redis 数据或部署命令。
- Subweb 继续锁定已发布镜像摘要；在 MyUrls 新镜像发布并验证前，不伪造新的锁文件摘要。

## 验证

- Vitest 静态契约验证 Nginx 安全路由、时区和 Compose 轮转。
- 执行完整单元测试、Lint、构建和 Compose 验证。
- 可用 Docker 时构建 Gateway，检查 `/etc/localtime` 与 Nginx 配置。
