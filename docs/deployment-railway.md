# Railway 部署

## 当前状态

Railway 拓扑已设计但尚非正式支持，当前仓库没有可声称已验证的 Railway 项目定义或部署证据。阻塞项是 MyUrls `redis://` / `rediss://` 能力尚未发布为不可变镜像摘要，且未获得创建计费资源、绑定 DNS、执行持久性/升级/回滚实测的授权。

## 目标拓扑

计划创建四个 Railway Service：唯一公开的 `gateway`、私网 `subconverter`、私网 `myurls` 和托管 `Redis`。Docker Compose 的 `depends_on`、健康顺序和网络名不会自动迁移到 Railway，必须逐项映射：

- gateway 从本仓库 Dockerfile 构建，读取平台 `PORT`。
- SubConverter 和 MyUrls 使用锁定 digest，不使用可变 tag。
- `SUBCONVERTER_UPSTREAM` 与 `MYURLS_UPSTREAM` 使用 `*.railway.internal` 私网地址。
- MyUrls 从 Redis reference variable 获取 TLS connection URL；gateway 不保存 Redis URL。
- MyUrls Token 只生成一次，并由 gateway 与 MyUrls 引用同一个 secret。

## 域名、TLS 与操作边界

先使用 Railway 临时域名验证 `/healthz`，再把 `APP_DOMAIN` 和 `API_DOMAIN` 绑定到同一 gateway。平台负责公网 TLS；三个内部服务不得生成公网域名。

正式文档还必须在真实验证后补齐：账户/计费和 region、逐服务变量、状态日志、暂停删除、Redis 备份责任、部署 ID、创建/转换/跳转、重启持久性、日志哨兵、digest 升级与回滚。没有这些证据前，本页面不是可复制的生产教程。

要解除阻塞，先在独立 MyUrls 仓库发布已通过 `redis://` / `rediss://` 测试的 tag 和多架构 digest，再更新本仓库锁文件；随后需用户明确授权 Railway 项目、计费资源和 DNS 写入，才能执行真实部署。
